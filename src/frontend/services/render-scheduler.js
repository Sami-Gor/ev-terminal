/**
 * render-scheduler.js — frame-buffered render loop.
 *
 * WebSocket handlers never touch the DOM: they call bufferTick(symbol) which
 * fills a lightweight tickBuffer map. A single requestAnimationFrame loop
 * drains the buffer once per display frame:
 *   - light handlers  → in-place text/attribute patches (every frame)
 *   - heavy handler   → full panel re-renders, gated to once per HEAVY_MS
 * The loop auto-stops when the buffer is idle and restarts on the next tick.
 */

const tickBuffer = new Map();
const HEAVY_INTERVAL_MS = 500;

let running = false;
let lastHeavy = 0;
let lightHandler = null;
let heavyHandler = null;
/** Coalesced diagnostics: a persistently failing handler logs at most once
 *  per 5 s (or immediately when the message changes) — visible without spam. */
let lastErrorLog = { msg: null, at: 0 };

export function bufferTick(sym) {
  tickBuffer.set(sym, true);
  ensureRunning();
}

export function setRenderHandlers({ light, heavy }) {
  lightHandler = light;
  heavyHandler = heavy;
}

function ensureRunning() {
  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }
}

function frame(ts) {
  if (!tickBuffer.size) {          // idle → stop the loop until the next tick
    running = false;
    return;
  }
  const symbols = [...tickBuffer.keys()];
  tickBuffer.clear();
  // A panel handler throwing must never kill the frame loop: reschedule
  // unconditionally and log so the failure is visible instead of a silent freeze.
  try {
    if (lightHandler) lightHandler(symbols);
    if (heavyHandler && ts - lastHeavy >= HEAVY_INTERVAL_MS) {
      lastHeavy = ts;
      heavyHandler(symbols);
    }
  } catch (e) {
    const msg = e && e.message;
    const now = Date.now();
    if (msg !== lastErrorLog.msg || now - lastErrorLog.at > 5000) {
      lastErrorLog = { msg, at: now };
      console.error('[render-scheduler] render handler failed:', msg);
    }
  } finally {
    requestAnimationFrame(frame);
  }
}
