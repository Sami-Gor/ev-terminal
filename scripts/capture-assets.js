#!/usr/bin/env node
'use strict';

/**
 * capture-assets.js — generates the repository's README imagery with Puppeteer.
 *
 * Requires the terminal to be running (npm start) and reachable at BASE_URL.
 * Run it against the quota-free demo mode (no provider keys) so the imagery
 * reflects the current UI with honest SIMULATED/demo provenance.
 *
 * Outputs:
 *   assets/hero-dashboard.png   1920x1080 full-view capture of the terminal
 *   assets/panel-preview.png    focused capture of the Financials panel
 *                               (Income Statement view: six tabs + the
 *                               QUARTERLY | ANNUAL control visible)
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

    // Financials panel: capture at a narrower viewport so the full-width card
    // (and its six tabs / QUARTERLY | ANNUAL control) stays legible when the
    // README scales the image down. Then switch to the Income Statement view.
    await page.setViewport({ width: 900, height: 1080, deviceScaleFactor: 1 });
    await new Promise(r => setTimeout(r, 400));   // reflow at the new width
    const incomeTab = await page.$('#fin-tabs [data-tab="is"]');
    if (incomeTab) await incomeTab.click();
    await page.waitForSelector('#fin-body [data-inc="q"]', { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(
      () => /TOTAL REVENUE/.test((document.getElementById('fin-body') || {}).textContent || ''),
      { timeout: 10000 },
    ).catch(() => {});
    await new Promise(r => setTimeout(r, 500));   // settle the tab render

    const panel = await page.$('#p-fin');
    if (panel) {
      const panelPath = path.join(OUT_DIR, 'panel-preview.png');
      await panel.screenshot({ path: panelPath });
      console.log(`captured assets/panel-preview.png`);
    } else {
      console.warn('financials card not found — panel preview skipped');
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
