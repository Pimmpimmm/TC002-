#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { exitOnError, maskHost, ProbeError } from './lib/safety.mjs';

const defaultData = join(homedir(), 'Library/Application Support/Ulanzi/UClock/config/data.json');
const defaultVersion = join(homedir(), 'Library/Application Support/Ulanzi/UlanziDeck/version.txt');

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizedMac(value) {
  return String(value || '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

try {
  const dataPath = process.env.ULANZI_UCLOCK_DATA?.trim() || defaultData;
  const versionPath = process.env.ULANZI_STUDIO_VERSION_FILE?.trim() || defaultVersion;
  let data;
  try { data = JSON.parse(await readFile(dataPath, 'utf8')); }
  catch { throw new ProbeError(`ALARM cannot parse Studio device data: ${dataPath}`); }
  const devices = Array.isArray(data.devices) ? data.devices : [];
  if (!devices.length) throw new ProbeError('ALARM Studio data contains no saved UClock device');

  let studioVersion = 'unverified';
  try {
    const rawVersion = await readFile(versionPath, 'utf8');
    studioVersion = rawVersion.match(/(?:^|\n)version=([^\r\n]+)/)?.[1]?.trim() || 'unverified';
  } catch { /* version remains explicitly unverified */ }

  let arp = '';
  try { arp = execFileSync('/usr/sbin/arp', ['-an'], { encoding: 'utf8' }); }
  catch { /* neighbor correlation remains false */ }

  const sanitizedDevices = devices.map(device => {
    const about = device?.settingsData?.aboutData || {};
    const storedIp = nonEmpty(about.ip) ? about.ip.trim() : '';
    const mac = normalizedMac(about.mac);
    const neighborLine = storedIp ? arp.split('\n').find(line => line.includes(`(${storedIp})`)) || '' : '';
    const neighborMac = normalizedMac(neighborLine.match(/ at ([0-9a-f:]+)/i)?.[1]);
    const toolApps = Array.isArray(device?.appData?.toolApps) ? device.appData.toolApps : [];
    const diyApps = Array.isArray(device?.appData?.diyApps) ? device.appData.diyApps : [];
    const mqtt = diyApps.filter(app => app && (Object.hasOwn(app, 'addr') || Object.hasOwn(app, 'prefix')));
    return {
      firmware: nonEmpty(about.appVer) ? about.appVer.trim() : 'unverified',
      mcu_version: nonEmpty(about.mcuVer) ? about.mcuVer.trim() : 'unverified',
      stored_ip: storedIp ? maskHost(storedIp) : '[absent]',
      mac_oui: mac.length >= 6 ? `${mac.slice(0, 6)}******` : '[absent]',
      stored_ip_in_neighbor_cache: Boolean(neighborLine),
      stored_mac_matches_neighbor: Boolean(mac && neighborMac && mac === neighborMac),
      clock_tools: toolApps
        .filter(app => [304, 305].includes(Number(app?.type)))
        .map(app => ({ type: Number(app.type), enabled: app.enabled === true, busy_minutes: Number(app.busyDuration), rest_minutes: Number(app.restDuration) })),
      mqtt: {
        entries: mqtt.length,
        broker_configured: mqtt.some(app => nonEmpty(app.addr)),
        prefix_present: mqtt.some(app => nonEmpty(app.prefix)),
        username_present: mqtt.some(app => nonEmpty(app.user)),
        password_present: mqtt.some(app => nonEmpty(app.password))
      }
    };
  });

  console.log(JSON.stringify({
    mutates_studio_or_device: false,
    secret_values_emitted: false,
    studio_version: studioVersion,
    saved_device_count: sanitizedDevices.length,
    devices: sanitizedDevices
  }, null, 2));
} catch (error) {
  exitOnError(error);
}
