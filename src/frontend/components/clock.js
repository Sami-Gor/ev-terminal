/**
 * clock.js — header clock, global session clock panel and the local-time
 * cells of the index map (single 1s interval drives all three).
 */
import { $, fnum } from '../utils/format.js';

const EXCHANGES = [
  { sym: 'SSE', tz: 'Asia/Shanghai', sess: [[570, 690], [780, 900]] },
  { sym: 'HKEX', tz: 'Asia/Hong_Kong', sess: [[570, 720], [780, 960]] },
  { sym: 'TSE', tz: 'Asia/Tokyo', sess: [[540, 690], [750, 930]] },
  { sym: 'LSE', tz: 'Europe/London', sess: [[480, 990]] },
  { sym: 'NYSE', tz: 'America/New_York', sess: [[570, 960]] },
];

function tzParts(tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const x of f.formatToParts(new Date())) p[x.type] = x.value;
  return p;
}

function tzOffsetMin(tz) {
  const now = new Date();
  const loc = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return Math.round((loc - now) / 60000);
}

const NY_OFFSET = tzOffsetMin('America/New_York');

function fmtMs(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}

function nextEvent(ex, p) {
  const sessionStart = ex.sess[0][0];
  const lastEnd = Math.max(...ex.sess.map(s => s[1]));
  const nowMin = (+p.hour) * 60 + (+p.minute) + (+p.second) / 60;
  const weekend = ['Sat', 'Sun'].includes(p.weekday);
  const inSession = ex.sess.some(s => nowMin >= s[0] && nowMin < s[1]);
  let addDays = 0;
  if (weekend) {
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    addDays = ((1 - dow + 7) % 7) || 7;
  } else if (inSession) {
    return { state: 'OPEN', next: 'closes → CLOSE', in: fmtMs((lastEnd - nowMin) * 60000) };
  } else if (nowMin >= sessionStart) {
    addDays = (p.weekday === 'Fri') ? 3 : 1;
  }
  const guess = new Date(Date.UTC(+(p.year), +(p.month) - 1, +(p.day) + addDays, Math.floor(sessionStart / 60), sessionStart % 60));
  const asTz = new Date(guess.toLocaleString('en-US', { timeZone: ex.tz }));
  const adjusted = new Date(guess.getTime() + (guess - asTz));
  return {
    state: weekend ? 'CLOSED/WKND' : (nowMin < sessionStart ? 'PRE' : 'CLOSED'),
    next: 'opens → OPEN',
    in: fmtMs(adjusted - new Date()),
  };
}

function renderClock() {
  const ny = tzParts('America/New_York');
  $('clock').textContent = ny.hour + ':' + ny.minute + ':' + ny.second;
  $('clock-sub').textContent = ' ' + ny.weekday + ', ' + ny.year + '-' + ny.month + '-' + ny.day +
    ' · America/New_York · UTC' + (NY_OFFSET >= 0 ? '+' : '−') + fnum(Math.abs(NY_OFFSET) / 60, 0).replace('.0', '');

  const tbody = $('ck-table').querySelector('tbody');
  let rows = '';
  const dyn = [];
  for (const ex of EXCHANGES) {
    const p = tzParts(ex.tz);
    const ev = nextEvent(ex, p);
    const sessStr = ex.sess.map(s =>
      String(Math.floor(s[0] / 60)).padStart(2, '0') + ':' + String(s[0] % 60).padStart(2, '0') + '–' +
      String(Math.floor(s[1] / 60)).padStart(2, '0') + ':' + String(s[1] % 60).padStart(2, '0')).join(' / ');
    rows += `<tr><td><b>${ex.sym}</b></td><td class="loc">${p.hour}:${p.minute}</td><td>${sessStr}</td>` +
      `<td><span class="stateb ${ev.state === 'OPEN' ? 'open' : ev.state === 'PRE' ? 'pre' : ''}">${ev.state}</span></td>` +
      `<td>${ev.next}</td><td class="cnt">${ev.in}</td></tr>`;
    dyn.push({ ex, p });
  }
  tbody.innerHTML = rows;

  const W = 720, rowH = 20, top = 8, margin = 34;
  let s = '';
  for (const hour of [0, 6, 12, 18, 24]) {
    const x = hour / 24 * (W - margin) + margin * 0.35;
    s += `<line x1="${x}" x2="${x}" y1="${top}" y2="${top + rowH * EXCHANGES.length + 6}" stroke="#1a1c1e"/>`;
    s += `<text x="${x}" y="${top + rowH * EXCHANGES.length + 16}" fill="#3d444d" font-size="8.5" text-anchor="middle" font-family="inherit">${String(hour).padStart(2, '0')}</text>`;
  }
  const nyMin = (+ny.hour) * 60 + (+ny.minute) + (+ny.second) / 60;
  dyn.forEach((d, rowIndex) => {
    const y = top + rowIndex * rowH;
    const diffMin = tzOffsetMin(d.ex.tz) - NY_OFFSET;
    s += `<text x="4" y="${y + 11}" fill="#6E7681" font-size="9" font-family="inherit">${d.ex.sym}</text>`;
    for (const seg of d.ex.sess) {
      const a = ((seg[0] + diffMin) % 1440 + 1440) % 1440;
      const x1 = a / 1440 * (W - margin) + margin * 0.35;
      const width = (seg[1] - seg[0]) / 1440 * (W - margin);
      s += `<rect x="${x1.toFixed(1)}" y="${y + 3}" width="${width.toFixed(1)}" height="10" fill="#3a2c14" stroke="#5a4210" stroke-width="0.5"/>`;
    }
  });
  const nowX = nyMin / 1440 * (W - margin) + margin * 0.35;
  s += `<line x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="${top - 2}" y2="${top + rowH * EXCHANGES.length + 6}" stroke="#F28C00" stroke-width="1.4"/>`;
  s += `<text x="${Math.min(nowX + 3, W - 30).toFixed(1)}" y="${top - 3}" fill="#F28C00" font-size="8.5" font-family="inherit">NOW</text>`;
  $('clk-svg').innerHTML = s;

  // live local-time cells of the index map
  document.querySelectorAll('#map [data-tz]').forEach(td => {
    const p = tzParts(td.dataset.tz);
    td.textContent = p.hour + ':' + p.minute;
  });
}

export function initClock() {
  renderClock();
  setInterval(renderClock, 1000);
}
