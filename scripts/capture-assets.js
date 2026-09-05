#!/usr/bin/env node
'use strict';

/**
 * capture-assets.js — generates the repository's README imagery with Puppeteer.
 *
 * Requires the terminal to be running (npm start) and reachable at BASE_URL.
 * Outputs:
 *   assets/hero-dashboard.png   1920x1080 full-view capture of the terminal
 *   assets/panel-preview.png    focused capture of the ticker table card
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.CAPTURE_URL || 'http://localhost:3000';
const OUT_DIR = path.join(__dirname, '..', 'assets');
const WAIT_MS = Number(process.env.CAPTURE_WAIT_MS) || 4000; // WS connect + panel population

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`launching headless Chrome (${BASE_URL}, 1920x1080)…`);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--hide-scrollbars'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log(`waiting ${WAIT_MS} ms for the WebSocket feed and panels…`);
    await new Promise(r => setTimeout(r, WAIT_MS));

    const heroPath = path.join(OUT_DIR, 'hero-dashboard.png');
    await page.screenshot({ path: heroPath });
    console.log(`captured assets/hero-dashboard.png`);

    const panel = await page.$('#p-tick');
    if (panel) {
      const panelPath = path.join(OUT_DIR, 'panel-preview.png');
      await panel.screenshot({ path: panelPath });
      console.log(`captured assets/panel-preview.png`);
    } else {
      console.warn('ticker table card not found — panel preview skipped');
    }

    for (const f of ['hero-dashboard.png', 'panel-preview.png']) {
      const p = path.join(OUT_DIR, f);
      if (fs.existsSync(p)) console.log(`  ${f}: ${(fs.statSync(p).size / 1024).toFixed(0)} KB`);
    }
    console.log('asset capture complete');
  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error('capture failed:', e.message);
  process.exit(1);
});
