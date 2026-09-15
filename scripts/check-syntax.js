#!/usr/bin/env node
'use strict';

/**
 * check-syntax.js — `node --check` over the project's JavaScript and MJS
 * (backend, frontend, scripts, tests). Dependency/build directories are
 * skipped. Uses Node built-ins only; exits non-zero on the first failure.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const ROOTS = [
  'server.js',
  'src/backend',
  'src/frontend',
  'scripts',
  'tests',
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.cache']);

function collect(target, out) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return;
  if (fs.statSync(full).isFile()) {
    if (target.endsWith('.js') || target.endsWith('.mjs')) out.push(target);
    return;
  }
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(path.join(target, entry.name), out);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      out.push(path.join(target, entry.name));
    }
  }
}

function main() {
  const files = [];
  ROOTS.forEach(root => collect(root, files));
  files.sort();

  let failed = 0;
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' });
    } catch (e) {
      failed++;
      console.error(`SYNTAX ERROR: ${file}`);
      const detail = (e.stderr && e.stderr.toString()) || e.message;
      console.error(detail.trim());
    }
  }

  console.log(`syntax check: ${files.length} files checked, ${failed} failed`);
  if (failed) process.exit(1);
  console.log('syntax check: OK');
}

main();
