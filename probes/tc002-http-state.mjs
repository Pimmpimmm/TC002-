#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProbeError, exitOnError, required, validateIpOrHost } from './lib/safety.mjs';

const LIVE_FIELD = /(?:current|state|page|phase|running|remaining|countdown|started|startTime|deadline|active)/i;

export function findLiveCandidatePaths(value, prefix = '') {
  if (!value || typeof value !== 'object') return [];
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const current = prefix ? `${prefix}.${key}` : key;
    if (LIVE_FIELD.test(key)) paths.push(current);
    paths.push(...findLiveCandidatePaths(child, current));
  }
  return paths;
}

async function studioDeviceIp() {
  const dataPath = path.join(homedir(), 'Library/Application Support/Ulanzi/UClock/config/data.json');
  const data = JSON.parse(await readFile(dataPath, 'utf8'));
  const ip = data.devices?.[0]?.settingsData?.aboutData?.ip;
  if (!ip) throw new ProbeError('ALARM Studio data contains no TC002 IP');
  return validateIpOrHost(ip);
}

async function fetchJson(ip, route) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`http://${ip}/${route}`, { signal: controller.signal });
    if (!response.ok) throw new ProbeError(`ALARM ${route} returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const fromStudio = process.env.TC002_FROM_STUDIO === 'YES';
  if (process.env.TC002_FROM_STUDIO && !fromStudio) throw new ProbeError('ALARM TC002_FROM_STUDIO, when set, must equal YES');
  const ip = fromStudio ? await studioDeviceIp() : validateIpOrHost(required('TC002_DEVICE_IP'));
  const [base, tools] = await Promise.all([fetchJson(ip, 'getBase'), fetchJson(ip, 'getToolsConfig')]);
  const busy = tools?.toolsInfos?.busy;
  console.log(JSON.stringify({
    mutates_device: false,
    emits_raw_values: false,
    routes: {
      getBase: {
        fields: Object.keys(base).sort(),
        live_candidate_paths: findLiveCandidatePaths(base),
        payload_sha256: createHash('sha256').update(JSON.stringify(base)).digest('hex')
      },
      getToolsConfig: {
        top_level_fields: Object.keys(tools).sort(),
        tool_names: Object.keys(tools?.toolsInfos || {}).sort(),
        busy_config_fields: busy && typeof busy === 'object' ? Object.keys(busy).sort() : [],
        live_candidate_paths: findLiveCandidatePaths(tools),
        payload_sha256: createHash('sha256').update(JSON.stringify(tools)).digest('hex')
      }
    }
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(exitOnError);
