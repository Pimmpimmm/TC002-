#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { exitOnError, ProbeError, required } from './lib/safety.mjs';

async function text(path) {
  try { return await readFile(path, 'utf8'); }
  catch { throw new ProbeError(`ALARM cannot read required source: ${path}`); }
}

async function matchingSourceFiles(root, pattern) {
  const matches = [];
  const sourceExtensions = new Set(['.c', '.cc', '.cpp', '.h', '.hpp', '.js', '.mjs', '.ts']);
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { throw new ProbeError(`ALARM cannot enumerate required source: ${directory}`); }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && sourceExtensions.has(extname(entry.name).toLowerCase())) {
        const body = await text(path);
        if (pattern.test(body)) matches.push(relative(root, path));
      }
    }
  }
  await walk(root);
  return matches;
}

try {
  const sdk = required('ULANZI_PLUGIN_SDK_DIR');
  const commonNode = required('ULANZI_COMMON_NODE_DIR');
  const tc002 = required('ULANZI_TC002_SOURCE_DIR');
  const studioManifest = process.env.ULANZI_STUDIO_TC002_MANIFEST?.trim()
    || '/Applications/Ulanzi Studio.app/Contents/Resources/Ulanzi/UlanziDeck/System/Plugins/com.ulanzi.tc002.ulanziPlugin/manifest.json';

  const [manifestGuide, sdkReadme, types, tc002Readme, installedRaw, stockAppMatches] = await Promise.all([
    text(join(sdk, 'manifest.md')),
    text(join(sdk, 'README.zh.md')),
    text(join(commonNode, 'apiTypes.d.ts')),
    text(join(tc002, 'README.md')),
    text(studioManifest),
    matchingSourceFiles(tc002, /(?:BUSY\s*Clock|BUSY时钟|busy_clock|pomodoro|番茄钟)/i)
  ]);
  let installed;
  try { installed = JSON.parse(installedRaw); }
  catch { throw new ProbeError(`ALARM invalid JSON: ${studioManifest}`); }

  const supportedLine = manifestGuide.match(/Supported device models:[^\n]+/)?.[0] || null;
  const publicEvents = [...types.matchAll(/type Cmd = ([^;]+);/g)].map(match => match[1]).join(' ');
  console.log(JSON.stringify({
    mutates_device_or_studio: false,
    public_sdk: {
      supported_line: supportedLine,
      tc002_named_as_supported_model: /Supported device models:[^\n]*TC002/i.test(manifestGuide),
      action_assignment_model: /Each action represents a configurable function that can be assigned to a device key\./.test(manifestGuide),
      action_local_context_documented: /context.*唯一标识每个实例/.test(sdkReadme),
      event_names: ['run', 'setactive', 'keydown', 'keyup', 'dialdown', 'dialup', 'dialrotate']
        .filter(name => publicEvents.includes(`\"${name}\"`))
    },
    tc002_source_repo: {
      compile_and_flash_scope: /编译、烧录到 TC002/.test(tc002Readme),
      audited_source_extensions: ['.c', '.cc', '.cpp', '.h', '.hpp', '.js', '.mjs', '.ts'],
      stock_busy_or_pomodoro_source_matches: stockAppMatches
    },
    installed_studio_tc002_plugin: {
      private_api: installed.PrivateAPI === true,
      description: installed.Description,
      actions: (installed.Actions || []).map(action => ({ name: action.Name, uuid: action.UUID, devices: action.Devices })),
      direction: /via D200\/D200H\/D100H\/D200X.*control/i.test(installed.Description || '')
        ? 'Deck models -> TC002 remote control'
        : 'unresolved'
    },
    verdict: 'No audited public interface exposes stock TC002 Busy/Pomodoro lifecycle events to a Mac plugin. Absence is a gate, not a claim about undocumented firmware behavior.'
  }, null, 2));
} catch (error) {
  exitOnError(error);
}
