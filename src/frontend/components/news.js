/**
 * news.js — demo news wire with expandable headlines and ticker chips.
 * All headlines are illustrative fixtures, clearly labeled as such.
 */
import { BYSYM } from '../services/store.js';
import { bus } from '../services/store.js';
import { $, fpct, ARROW } from '../utils/format.js';

const NEWS = [
  ['16:00:02', 'EV', 'Closing bell: EV cohort outperforms as battery names lead tape into the weekend — DEMO WIRE', 'Broad finish for the demo EV universe: advancers lead decliners while cell makers top the most-active board.', 'TSLA,RIVN'],
  ['15:42:11', 'EV', 'Momentum EV names extend gains; late-day rotation into pure-play makers — DEMO WIRE', 'XPeng and NIO ADRs firm into the close, outpacing legacy automakers on the demo tape.', 'XPEV,NIO'],
  ['15:05:48', 'BATT', 'Lithium carbonate spot firms on restocking chatter; spodumune quotes follow — DEMO WIRE', 'Demo desk marks battery-grade lithium higher for a third session; converters cite steady cathode orders.', 'ALB,300750.SZ'],
  ['14:02:07', 'BATT', 'Solid-state watch: pilot-line yields improve per supply-chain checks — DEMO WIRE', 'Demo note flags incremental progress at pre-commercial lines; next-gen chemistry names bid.', 'PCRFY'],
  ['12:15:44', 'EV', 'Midday: EV sector breadth improves; lagging ADR complex turns positive — DEMO WIRE', 'Halfway mark on the demo tape: pure-play cohort recovers early losses.', 'NIO,LI'],
  ['11:52:19', 'BATT', 'Cathode order leads stretch into Q4; LFP cell quotes edge higher — DEMO WIRE', 'Demo supply-chain tracker shows continued LFP momentum across passenger EV programs.', '300750.SZ,3931.HK'],
  ['08:55:23', 'EV', 'Asia session review: NEV wholesale estimates revised higher for the month — DEMO WIRE', 'Demo Asia desk: China NEV run-rate lifts sentiment across the ADR complex.', 'XPEV,LI,NIO'],
  ['07:31:05', 'BATT', 'Overnight digest: separator and electrolyte pricing stable per checks — DEMO WIRE', 'Demo supply chain: input costs ex-lithium remain well-behaved.', 'PCRFY,373220.KS'],
  ['06:15:09', 'EV', 'Asia close: EV platform cohort outperforms; delivery-day catalysts ahead — DEMO WIRE', 'Demo Asia close: platform-economy strength spills into NEV names.', 'NIO,XPEV'],
];

const TAG_COLORS = { EV: '#00C176', BATT: '#58A6FF' };

function chipPct(sym) {
  return BYSYM[sym] ? ARROW(BYSYM[sym].pct) + ' ' + fpct(BYSYM[sym].pct) : '';
}

export function initNews() {
  $('news').innerHTML = NEWS.map(n => `<div class="nw unread">
    <div class="l1"><span class="dot"></span><span class="tm">${n[0]}</span><span class="tag" style="background:${TAG_COLORS[n[1]]}">${n[1]}</span><span class="hd">${n[2]}</span></div>
    <div class="body">${n[3]}<div class="ticks">${n[4].split(',').map(s => `<span class="chip" data-sym="${s}">${s} ${chipPct(s)}</span>`).join('')}</div></div>
  </div>`).join('');
  $('nw-count').textContent = NEWS.length + ' items · ' + NEWS.length + ' unread';
  $('news').querySelectorAll('.nw').forEach(el => el.addEventListener('click', e => {
    if (e.target.classList.contains('chip')) {
      e.stopPropagation();
      bus.emit('focus', e.target.dataset.sym);
      return;
    }
    el.classList.toggle('open');
    el.classList.remove('unread');
    const unread = $('news').querySelectorAll('.unread').length;
    $('nw-count').textContent = NEWS.length + ' items · ' + unread + ' unread';
  }));
}
