#pragma once

#include <stdint.h>
#include <string>

class MqttPublisher {
public:
	bool publish(const std::string& payload) const;

private:
	struct BrokerConfig {
		std::string host;
		uint16_t port;
		std::string topic;
	};

	BrokerConfig loadConfig() const;
	int connectBroker(const BrokerConfig& config) const;
	bool sendConnect(int fd) const;
	bool sendPublish(int fd, const std::string& topic, const std::string& payload) const;
};
