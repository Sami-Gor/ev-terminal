'use strict';

/**
 * Shared route helpers: symbol validation and sanitized error creation.
 * Public messages are generic; internal details are logged server-side only.
 */
const SYMBOL_RE = /^[A-Za-z0-9.\-^]{1,10}$/;

function okSymbol(sym) {
  return SYMBOL_RE.test(sym);
}

function createError(status, publicMessage, internalDetail) {
  if (internalDetail) console.error(`[api] ${publicMessage} — detail: ${internalDetail}`);
  const err = new Error(publicMessage);
  err.status = status;
  err.publicMessage = publicMessage;
  return err;
}

module.exports = { SYMBOL_RE, okSymbol, createError };
