#!/usr/bin/env node
import { copyFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitOnError } from './lib/safety.mjs';

const probesDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(probesDir);
const runtimeDir = path.join(probesDir, '.runtime');

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`ALARM ${command} failed with ${signal ? `signal ${signal}` : `exit ${code}`}`));
    });
  });
}

try {
  await mkdir(runtimeDir, { recursive: true });
  await Promise.all([
    copyFile(path.join(projectDir, 'package.json'), path.join(runtimeDir, 'package.json')),
    copyFile(path.join(projectDir, 'package-lock.json'), path.join(runtimeDir, 'package-lock.json'))
  ]);
  await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: runtimeDir });
  console.log('PASS broker runtime installed from project lockfile under probes/.runtime');
} catch (error) {
  exitOnError(error);
}
