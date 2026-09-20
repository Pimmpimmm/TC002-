#pragma once

#include <stdint.h>
#include <string>

class MqttPublisher {
public:
	struct RuntimeConfig {
		std::string host;
		uint16_t port;
		std::string topic;
		int64_t focusSeconds;
		int64_t restSeconds;
	};

	bool publish(const std::string& payload) const;
	// Reads the non-secret runtime configuration from device.conf. Invalid or
	// missing timer values safely fall back to the compiled defaults.
	RuntimeConfig loadConfig() const;

private:
	int connectBroker(const RuntimeConfig& config) const;
	bool sendConnect(int fd) const;
	bool sendPublish(int fd, const std::string& topic, const std::string& payload) const;
};
