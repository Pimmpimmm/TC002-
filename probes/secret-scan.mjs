import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_FILES = ['BLOCKED.md', 'PROGRESS.md', 'package.json', 'package-lock.json'];
const ROOT_DIRS = ['bridge', 'device', 'probes', 'research'];
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const RULES = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~-]{20,}\b/g],
  ['credential-assignment', /\b(?:app_secret|client_secret|access_token|refresh_token|password)\s*[:=]\s*["'](?!\[REDACTED\])[^"'\s]{16,}["']/gi],
  ['lark-app-id', /\bcli_[a-z0-9]{16,}\b/gi]
];

export function findSecretFindings(text, file = '<memory>') {
  const findings = [];
  for (const [rule, expression] of RULES) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      const line = text.slice(0, match.index).split('\n').length;
      findings.push({ file, line, rule });
    }
  }
  return findings;
}

async function collectFiles(target) {
  let info;
  try { info = await stat(target); }
  catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (info.isFile()) return [target];
  if (!info.isDirectory() || SKIP_DIRS.has(path.basename(target))) return [];
  const entries = await readdir(target, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => collectFiles(path.join(target, entry.name))));
  return nested.flat();
}

export async function scanWorkspace(root = process.cwd()) {
  const targets = [...ROOT_FILES, ...ROOT_DIRS].map(item => path.join(root, item));
  const files = (await Promise.all(targets.map(collectFiles))).flat();
  const findings = [];
  for (const file of files) {
    const bytes = await readFile(file);
    if (bytes.includes(0)) continue;
    findings.push(...findSecretFindings(bytes.toString('utf8'), path.relative(root, file)));
  }
  return { filesScanned: files.length, findings };
}

async function main() {
  const result = await scanWorkspace();
  if (result.findings.length) {
    for (const finding of result.findings) {
      console.error(`ALARM secret-shaped value: ${finding.file}:${finding.line} (${finding.rule})`);
    }
    process.exitCode = 2;
    return;
  }
  console.log(`PASS no secret-shaped values in ${result.filesScanned} deliverable files`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`ALARM secret scan failed: ${error.message}`);
    process.exitCode = 1;
  });
}
