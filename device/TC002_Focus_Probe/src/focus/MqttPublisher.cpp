#include "focus/MqttPublisher.h"
#include "focus/FocusConfig.h"

#include <arpa/inet.h>
#include <base/log.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
#include <fstream>
#include <string>
#include <vector>

namespace {

void appendString(std::vector<uint8_t>& bytes, const std::string& value) {
	bytes.push_back(static_cast<uint8_t>((value.size() >> 8) & 0xff));
	bytes.push_back(static_cast<uint8_t>(value.size() & 0xff));
	bytes.insert(bytes.end(), value.begin(), value.end());
}

void appendRemainingLength(std::vector<uint8_t>& bytes, size_t length) {
	do {
		uint8_t digit = static_cast<uint8_t>(length % 128);
		length /= 128;
		if (length > 0) digit |= 0x80;
		bytes.push_back(digit);
	} while (length > 0);
}

bool sendAll(int fd, const std::vector<uint8_t>& bytes) {
	size_t offset = 0;
	while (offset < bytes.size()) {
		ssize_t sent = send(fd, &bytes[offset], bytes.size() - offset, MSG_NOSIGNAL);
		if (sent < 0 && errno == EINTR) continue;
		if (sent <= 0) return false;
		offset += static_cast<size_t>(sent);
	}
	return true;
}

std::string trim(const std::string& input) {
	size_t first = input.find_first_not_of(" \t\r\n");
	if (first == std::string::npos) return {};
	size_t last = input.find_last_not_of(" \t\r\n");
	return input.substr(first, last - first + 1);
}

bool validTopic(const std::string& topic) {
	if (topic.empty() || topic.size() > 256) return false;
	for (char value : topic) {
		if (value == '#' || value == '+' || value == '\0' || value == '\n' || value == '\r') return false;
	}
	return true;
}

bool parsePort(const std::string& value, uint16_t& port) {
	if (value.empty()) return false;
	unsigned long parsed = 0;
	for (char digit : value) {
		if (digit < '0' || digit > '9') return false;
		parsed = parsed * 10 + static_cast<unsigned long>(digit - '0');
		if (parsed > 65535) return false;
	}
	if (parsed == 0) return false;
	port = static_cast<uint16_t>(parsed);
	return true;
}

bool parseSeconds(const std::string& value, int64_t& seconds) {
	if (value.empty()) return false;
	int64_t parsed = 0;
	for (char digit : value) {
		if (digit < '0' || digit > '9') return false;
		parsed = parsed * 10 + static_cast<int64_t>(digit - '0');
		if (parsed > 14400) return false;
	}
	if (parsed < 60) return false;
	seconds = parsed;
	return true;
}

bool validIpv4(const std::string& host) {
	in_addr address = {};
	return inet_pton(AF_INET, host.c_str(), &address) == 1;
}

} // namespace

MqttPublisher::RuntimeConfig MqttPublisher::loadConfig() const {
	RuntimeConfig config = {
		focus_config::kBrokerHost,
		focus_config::kBrokerPort,
		focus_config::kEventTopic,
		focus_config::kFocusSeconds,
		focus_config::kRestSeconds
	};
	const char* paths[] = {
		"/mnt/extsd/focus-app/device.conf",
		"/tmp/ui/device.conf"
	};
	for (const char* path : paths) {
		std::ifstream input(path);
		if (!input.is_open()) continue;
		std::string line;
		while (std::getline(input, line)) {
			line = trim(line);
			if (line.empty() || line[0] == '#') continue;
			size_t separator = line.find('=');
			if (separator == std::string::npos) continue;
			std::string key = trim(line.substr(0, separator));
			std::string value = trim(line.substr(separator + 1));
			if (key == "broker_host" && validIpv4(value)) config.host = value;
			else if (key == "broker_port") {
				uint16_t port = 0;
				if (parsePort(value, port)) config.port = port;
			} else if (key == "event_topic" && validTopic(value)) config.topic = value;
			else if (key == "focus_seconds") {
				int64_t seconds = 0;
				if (parseSeconds(value, seconds)) config.focusSeconds = seconds;
			} else if (key == "rest_seconds") {
				int64_t seconds = 0;
				if (parseSeconds(value, seconds)) config.restSeconds = seconds;
			}
		}
		break;
	}
	return config;
}

int MqttPublisher::connectBroker(const RuntimeConfig& config) const {
	int fd = socket(AF_INET, SOCK_STREAM, 0);
	if (fd < 0) return -1;

	int flags = fcntl(fd, F_GETFL, 0);
	if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0) {
		close(fd);
		return -1;
	}

	sockaddr_in address = {};
	address.sin_family = AF_INET;
	address.sin_port = htons(config.port);
	if (inet_pton(AF_INET, config.host.c_str(), &address.sin_addr) != 1) {
		close(fd);
		return -1;
	}

	int result = connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address));
	if (result < 0 && errno != EINPROGRESS) {
		close(fd);
		return -1;
	}
	if (result < 0) {
		fd_set writes;
		FD_ZERO(&writes);
		FD_SET(fd, &writes);
		timeval timeout = { 2, 0 };
		result = select(fd + 1, nullptr, &writes, nullptr, &timeout);
		int socketError = 0;
		socklen_t errorSize = sizeof(socketError);
		if (result <= 0 || getsockopt(fd, SOL_SOCKET, SO_ERROR, &socketError, &errorSize) < 0 || socketError != 0) {
			close(fd);
			return -1;
		}
	}

	if (fcntl(fd, F_SETFL, flags) < 0) {
		close(fd);
		return -1;
	}
	timeval ioTimeout = { 2, 0 };
	setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &ioTimeout, sizeof(ioTimeout));
	setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &ioTimeout, sizeof(ioTimeout));
	return fd;
}

bool MqttPublisher::sendConnect(int fd) const {
	std::vector<uint8_t> body;
	appendString(body, "MQTT");
	body.push_back(4);     // MQTT 3.1.1
	body.push_back(2);     // clean session
	body.push_back(0);     // keepalive disabled: this is a one-shot connection
	body.push_back(0);
	appendString(body, "tc002-focus-probe");

	std::vector<uint8_t> packet;
	packet.push_back(0x10);
	appendRemainingLength(packet, body.size());
	packet.insert(packet.end(), body.begin(), body.end());
	if (!sendAll(fd, packet)) return false;

	uint8_t response[4] = {};
	size_t received = 0;
	while (received < sizeof(response)) {
		ssize_t count = recv(fd, response + received, sizeof(response) - received, 0);
		if (count < 0 && errno == EINTR) continue;
		if (count <= 0) return false;
		received += static_cast<size_t>(count);
	}
	return response[0] == 0x20 && response[1] == 0x02 && response[3] == 0x00;
}

bool MqttPublisher::sendPublish(int fd, const std::string& topic, const std::string& payload) const {
	std::vector<uint8_t> body;
	appendString(body, topic);
	body.insert(body.end(), payload.begin(), payload.end());

	std::vector<uint8_t> packet;
	packet.push_back(0x30); // QoS 0 PUBLISH
	appendRemainingLength(packet, body.size());
	packet.insert(packet.end(), body.begin(), body.end());
	return sendAll(fd, packet);
}

bool MqttPublisher::publish(const std::string& payload) const {
	const RuntimeConfig config = loadConfig();
	int fd = connectBroker(config);
	if (fd < 0) {
		LOGW_TRACE("FocusProbe: MQTT broker unavailable");
		return false;
	}
	bool ok = sendConnect(fd) && sendPublish(fd, config.topic, payload);
	if (ok) {
		const std::vector<uint8_t> disconnect(2, 0);
		std::vector<uint8_t> packet = disconnect;
		packet[0] = 0xe0;
		sendAll(fd, packet);
	}
	close(fd);
	LOGI_TRACE("FocusProbe: MQTT publish %s", ok ? "ok" : "failed");
	return ok;
}
