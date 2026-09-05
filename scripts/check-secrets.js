#!/usr/bin/env node
'use strict';

/**
 * check-secrets.js — scans source files for accidental API keys / credentials
 * before they are committed. Exits 1 when a likely secret is found.
 *
 * Usage: node scripts/check-secrets.js [paths…]   (default: git-tracked files,
 * or the whole tree when git is unavailable)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const ALLOWLISTED_FILES = new Set([
  'package.json', 'package-lock.json',
  '.env.example',
  'LICENSE',
  path.join('scripts', 'check-secrets.js'),   // the detector contains its own patterns
]);

const SECRET_PATTERNS = [
  { name: 'Polygon API key assignment', re: /POLYGON_API_KEY\s*[=:]\s*['"]?([A-Za-z0-9_\-]{10,})['"]?/i },
  { name: 'FMP API key assignment', re: /FMP_API_KEY\s*[=:]\s*['"]?([A-Za-z0-9_\-]{10,})['"]?/i },
  { name: 'long hex token', re: /\b[0-9a-f]{32,64}\b/ },
  { name: 'base64-ish opaque token', re: /\b[A-Za-z0-9+/]{40,}={0,2}\b/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'cloud/API credential prefix', re: /\b(?:sk_live|sk_test|rk_live|ghp_|gho_|github_pat_|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{20,})\b/ },
  { name: 'generic apikey/secret/token assignment', re: /\b(?:api[_-]?key|apikey|secret|passwd|password|token)\b\s*[:=]\s*['"][^'"]{8,}['"]/i },
];

const PLACEHOLDER_VALUES = new Set([
  'your_polygon_api_key', 'your_fmp_api_key', 'your_key_here', 'changeme',
  'change_me', 'placeholder', 'example', 'test', 'xxx', 'xxx_key', 'todo',
]);

function isPlaceholder(value) {
  const v = value.toLowerCase();
  if (PLACEHOLDER_VALUES.has(v)) return true;
  if (/^(your|my|the)?[_-]?(api[_-]?)?key/.test(v)) return true;
  if (/^<.*>$/.test(value)) return true;          // <paste-your-key>
  if (/^\$\{.*\}$/.test(value)) return true;      // ${VAR} indirection
  if (/^(0+|1+|x+|a+)$/.test(v)) return true;     // trivial filler
  return false;
}

function isBinary(buf) {
  for (let i = 0; i < Math.min(buf.length, 8000); i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function listFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', 'coverage', '.cache'].includes(entry.name)) continue;
      listFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function trackedFiles() {
  try {
    const out = require('child_process')
      .execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
    const files = out.split('\n').filter(Boolean).map(f => path.join(ROOT, f));
    return files.filter(f => fs.existsSync(f) && fs.statSync(f).isFile());
  } catch (e) {
    return listFiles(ROOT, [])
      .filter(f => !f.includes(`${path.sep}node_modules${path.sep}`))
      .filter(f => !/\.env(\.|$)/.test(path.basename(f)) || f.endsWith('.example'));
  }
}

function scan() {
  const files = process.argv.length > 2
    ? process.argv.slice(2).map(f => path.resolve(f))
    : trackedFiles();

  const findings = [];
  let scanned = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    if (ALLOWLISTED_FILES.has(rel)) continue;
    if (/(^|[\\/])\.env($|\.)/.test(rel) && !rel.endsWith('.example')) {
      findings.push({ file: rel, line: 0, name: 'environment file committed', value: '' });
      continue;
    }
    let buf;
    try { buf = fs.readFileSync(file); } catch (e) { continue; }
    if (isBinary(buf)) continue;
    scanned++;
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    lines.forEach((line, idx) => {
      const isUrlLine = /https?:|\bwss?:/i.test(line);
      for (const { name, re } of SECRET_PATTERNS) {
        if (name === 'base64-ish opaque token' && isUrlLine) continue;  // URLs legitimately contain long runs
        const m = line.match(re);
        if (!m) continue;
        const value = m[1] || m[0];
        if (isPlaceholder(value)) continue;
        // an env *name* followed by an empty/template value is fine
        if (/^[A-Z_]+_KEY\s*=\s*$/i.test(line.trim()) && value === line.trim().split('=')[1]) continue;
        findings.push({ file: rel, line: idx + 1, name, value: value.slice(0, 12) + '…' });
      }
    });
  }

  console.log(`secret scan: ${scanned} files scanned`);
  if (findings.length) {
    console.error('\nPOSSIBLE SECRETS FOUND:');
    for (const f of findings) console.error(`  ${f.file}:${f.line} — ${f.name} (${f.value})`);
    console.error('\nMove the value into .env (git-ignored) and reference it via process.env.');
    process.exit(1);
  }
  console.log('no secrets detected — OK');
}

scan();
