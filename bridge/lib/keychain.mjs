import { execFileSync } from 'node:child_process';
import { BridgeError } from './state.mjs';

// Secrets never live in env files, logs or the repo: only in the macOS Keychain.
export function readKeychainSecret({ service, account }) {
  try {
    return execFileSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    throw new BridgeError(`ALARM keychain item not found: service=${service} account=${account}`, 500);
  }
}

export function readKeychainSecretOptional({ service, account }) {
  try {
    return readKeychainSecret({ service, account });
  } catch {
    return null;
  }
}

export function writeKeychainSecret({ service, account, value }) {
  if (typeof value !== 'string' || !value) {
    throw new BridgeError(`ALARM refusing to write empty keychain item: service=${service} account=${account}`, 500);
  }
  try {
    execFileSync('/usr/bin/security', ['add-generic-password', '-U', '-s', service, '-a', account, '-w', value], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore']
    });
  } catch {
    throw new BridgeError(`ALARM failed to write keychain item: service=${service} account=${account}`, 500);
  }
}
