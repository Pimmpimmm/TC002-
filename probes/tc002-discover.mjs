#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { maskHost, parseBroker, required, validateIpOrHost, validatePrefix, exitOnError, ProbeError } from './lib/safety.mjs';

try {
  let device = process.env.TC002_DEVICE_IP?.trim();
  let method = 'environment';
  if (!device) {
    let arp;
    try {
      arp = execFileSync('/usr/sbin/arp', ['-an'], { encoding: 'utf8' });
    } catch (cause) {
      throw new ProbeError(`ALARM neighbor-cache discovery unavailable on this host (/usr/sbin/arp: ${cause.code || cause.message}); set TC002_DEVICE_IP explicitly (no blind LAN scan performed)`);
    }
    const lines = arp.split('\n');
    const namedLine = lines.find(item => /tc002|ulanzi/i.test(item));
    const ouiCandidate = lines.find(item => /\bat cc:c4:b2:/i.test(item));
    const line = namedLine || ouiCandidate;
    const match = line?.match(/\(([^)]+)\)/);
    if (!match) throw new ProbeError('ALARM TC002 not identifiable in neighbor cache; set TC002_DEVICE_IP (no blind LAN scan performed)');
    device = match[1];
    method = namedLine ? 'ARP hostname match' : 'ARP OUI candidate cc:c4:b2 (unverified; official guide example only)';
  }
  const broker = parseBroker(required('MQTT_BROKER'));
  const prefix = validatePrefix(required('MQTT_PREFIX'));
  const identityStatus = method === 'environment'
    ? 'user_supplied_unverified'
    : method === 'ARP hostname match' ? 'hostname_match_unverified' : 'oui_candidate_unverified';
  console.log(JSON.stringify({ parameters_ready: true, device: maskHost(validateIpOrHost(device)), broker: `${maskHost(broker.host)}:${broker.port}`, prefix: '[PREFIX-REDACTED]', method, identity_status: identityStatus }));
} catch (error) { exitOnError(error); }
