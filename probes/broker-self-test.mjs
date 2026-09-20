#!/usr/bin/env node
import { MqttClient } from './lib/mqtt.mjs';
import { ProbeError, exitOnError, parseBroker, required, validatePrefix } from './lib/safety.mjs';

let mqtt;
try {
  const broker = parseBroker(required('MQTT_BROKER'));
  const prefix = validatePrefix(required('MQTT_PREFIX'));
  mqtt = new MqttClient({ ...broker, clientId: `broker-self-test-${process.pid}` });
  const expected = Buffer.from('{"probe":true}');
  await mqtt.connect(3000);
  await mqtt.subscribe(`${prefix}/#`, 3000);
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProbeError('ALARM broker self-test publish was not delivered')), 3000);
    mqtt.onPublish(({ topic, payload }) => {
      if (topic === `${prefix}/self-test` && payload.equals(expected)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  mqtt.publish(`${prefix}/self-test`, expected);
  await received;
  mqtt.close();
  console.log('PASS broker CONNECT/SUBSCRIBE/PUBLISH loopback; payload was synthetic and content-free');
} catch (error) {
  mqtt?.close();
  exitOnError(new ProbeError(`ALARM broker self-test failed: ${error.message}`));
}
