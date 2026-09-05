/**
 * news.js — demo news wire with expandable headlines and ticker chips.
 * All headlines are illustrative fixtures, clearly labeled as such.
 */
import { MACRO, BYSYM } from '../services/store.js';
import { bus } from '../services/store.js';
import { $, fpct, ARROW } from '../utils/format.js';

const NEWS = [
  ['16:00:02', 'EV', 'Closing bell: EV cohort outperforms as battery names lead tape into the weekend — DEMO WIRE', 'Broad finish for the demo EV universe: advancers lead decliners while cell makers top the most-active board.', 'TSLA,RIVN'],
  ['15:42:11', 'EV', 'Momentum EV names extend gains; late-day rotation into pure-play makers — DEMO WIRE', 'XPeng and NIO ADRs firm into the close, outpacing legacy automakers on the demo tape.', 'XPEV,NIO'],
  ['15:05:48', 'BATT', 'Lithium carbonate spot firms on restocking chatter; spodumune quotes follow — DEMO WIRE', 'Demo metals desk marks battery-grade lithium higher for a third session; converters cite steady cathode orders.', 'ALB,300750.SZ'],
  ['14:31:20', 'MACRO', 'Fed officials signal patience; rate futures steady — supportive for long-duration growth cohorts — DEMO WIRE', 'Demo macro feed: policy path unchanged into autumn per rate futures strip.', 'SPX,IXIC'],
  ['14:02:07', 'BATT', 'Solid-state watch: pilot-line yields improve per supply-chain checks — DEMO WIRE', 'Demo note flags incremental progress at pre-commercial lines; next-gen chemistry names bid.', 'PCRFY'],
  ['13:36:55', 'METALS', 'Cobalt eases as warehouse stocks build; nickel holds overnight gain — DEMO WIRE', 'LME-tracked demo refs: cobalt offered, nickel supported by stainless-plus-alloy demand.', 'COBT,NICK'],
  ['12:15:44', 'EV', 'Midday: EV sector breadth improves; lagging ADR complex turns positive — DEMO WIRE', 'Halfway mark on the demo tape: pure-play cohort recovers early losses.', 'NIO,LI'],
  ['11:52:19', 'BATT', 'Cathode order leads stretch into Q4; LFP cell quotes edge higher — DEMO WIRE', 'Demo supply-chain tracker shows continued LFP momentum across passenger EV programs.', '300750.SZ,3931.HK'],
  ['11:20:36', 'MACRO', 'US durable goods orders top consensus; core capex firmer — DEMO WIRE', 'Demo macro: equipment spend resilient, a read-through for factory automation and robotics.', 'SPX'],
  ['10:58:02', 'METALS', 'Copper holds overnight gain as dollar softens — DEMO WIRE', 'Red metal keeps EV harness/wiring demand narrative intact on the demo desk.', 'COPR'],
  ['09:30:01', 'MACRO', 'US cash open: EV names little changed after mixed overnight session — DEMO WIRE', 'Demo open: flat start for the EV universe; battery names pre-market leaders.', 'TSLA,ALB'],
  ['08:55:23', 'EV', 'Asia session review: NEV wholesale estimates revised higher for the month — DEMO WIRE', 'Demo Asia desk: China NEV run-rate lifts sentiment across the ADR complex.', 'XPEV,LI,NIO'],
  ['08:20:40', 'METALS', 'Nickel supported by Indonesian supply chatter; copper rangebound — DEMO WIRE', 'Demo metals: mixed battery-metal complex overnight.', 'NICK,COPR'],
  ['07:31:05', 'BATT', 'Overnight digest: separator and electrolyte pricing stable per checks — DEMO WIRE', 'Demo supply chain: input costs ex-lithium remain well-behaved.', 'PCRFY,373220.KS'],
  ['07:02:44', 'MACRO', 'Week in review: EV tape climbs wall of worry into month-end — DEMO WIRE', 'Demo weekly: EV universe outpaces broad benchmarks on the demo sample.', 'SPX,TSLA'],
  ['06:44:30', 'METALS', 'Lithium auction clears firm; hydroxide spread stable — DEMO WIRE', 'Demo auction result supports carbonate floor talk.', 'ALB'],
  ['06:15:09', 'EV', 'Asia close: EV platform cohort outperforms; delivery-day catalysts ahead — DEMO WIRE', 'Demo Asia close: platform-economy strength spills into NEV names.', 'NIO,XPEV'],
  ['06:00:00', 'MACRO', 'Desk note: today\'s calendar — EU EV registrations, lithium auction, one Fed speaker — DEMO WIRE', 'Demo daybook: three potential tape catalysts flagged for the session.', 'SPX'],
];

const TAG_COLORS = { EV: '#00C176', BATT: '#58A6FF', MACRO: '#E3B341', METALS: '#a8dadc' };

function chipPct(sym) {
  if (BYSYM[sym]) return ARROW(BYSYM[sym].pct) + ' ' + fpct(BYSYM[sym].pct);
  const m = MACRO.find(x => x.sym === sym);
  return m ? fpct(m.pct) : '';
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
