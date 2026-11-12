'use strict';

const VERSION = '1.1';
const DAYS = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag'];
const SHORT = ['Man', 'Tir', 'Ons', 'Tor', 'Fre'];
const TYPES = ['Arbejde', 'Syg', 'Ferie', 'Fri', 'Helligdag'];
const WORK = 'Arbejde';
const MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
const MON3 = ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'];
const TIME_RE = /^(\d{1,2})(?:[:.,](\d{2}))?\s*(?:-|–|—|til)\s*(\d{1,2})(?:[:.,](\d{2}))?$/i;

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ lager (kun på denne telefon)

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
};
const DEFAULTS = { name: '', boss: '', format: 'PDF', pauseMT: 60, pauseFri: 30 };
function settings() { return Object.assign({}, DEFAULTS, store.get('settings', {})); }

// ------------------------------------------------------------------ dato/uge

function mondayOf(d) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  m.setDate(m.getDate() - (m.getDay() + 6) % 7);
  return m;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isoWeek(monday) {
  const thu = addDays(monday, 3);
  const week1 = mondayOf(new Date(thu.getFullYear(), 0, 4, 12));
  return 1 + Math.round((monday - week1) / (7 * 864e5));
}
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const sameDay = (a, b) => ymd(a) === ymd(b);

let monday = mondayOf(new Date());
let days = [];

const day = (i) => addDays(monday, i);
const weekNo = () => isoWeek(monday);
const weekYear = () => day(3).getFullYear();
const weekKey = () => 'week_' + ymd(monday);
const isCurrentWeek = () => ymd(monday) === ymd(mondayOf(new Date()));

function period() {
  const a = day(0), b = day(4);
  if (a.getFullYear() !== b.getFullYear())
    return `${a.getDate()}. ${MON3[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()}. ${MON3[b.getMonth()]} ${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth())
    return `${a.getDate()}. ${MON3[a.getMonth()]} – ${b.getDate()}. ${MON3[b.getMonth()]} ${b.getFullYear()}`;
  return `${a.getDate()}.–${b.getDate()}. ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
}

// ------------------------------------------------------------------ beregning

function parseTime(s) {
  const m = TIME_RE.exec((s || '').trim());
  if (!m) return null;
  const sh = +m[1], sm = m[2] ? +m[2] : 0, eh = +m[3], em = m[4] ? +m[4] : 0;
  if (sh > 24 || eh > 24 || sm > 59 || em > 59) return null;
  const a = sh * 60 + sm, b = eh * 60 + em;
  if (b <= a || b > 1440) return null;
  return [a, b];
}
const isWork = (i) => days[i].type === WORK;
function pause(i) { const s = settings(); return i === 4 ? s.pauseFri : s.pauseMT; }
const MAX_PLACES = 4;
/** De steder der tæller: første linje altid, ekstra linjer kun hvis der står noget i dem. */
const places = (i) => days[i].entries.filter((e, k) => k === 0 || e.time.trim() || e.city.trim());
/** Samlet tid på stederne i minutter, 'bad' hvis en tid er ugyldig, 'overlap' hvis tider overlapper. */
function spanMin(i) {
  const r = [];
  for (const e of places(i)) { const p = parseTime(e.time); if (!p) return 'bad'; r.push(p); }
  r.sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < r.length; k++) if (r[k][0] < r[k - 1][1]) return 'overlap';
  return r.reduce((s, p) => s + p[1] - p[0], 0);
}
function workedMin(i) {
  const s = spanMin(i);
  return typeof s === 'number' ? Math.max(0, s - pause(i)) : -1;
}
const complete = (i) => !isWork(i) || (workedMin(i) >= 0 && places(i).every((e) => e.city.trim() !== ''));
function totalMin() { let t = 0; for (let i = 0; i < 5; i++) if (isWork(i)) t += Math.max(0, workedMin(i)); return t; }
function fmtH(min) {
  if (min % 60 === 0) return String(min / 60);
  return (min / 60).toFixed(2).replace(/0+$/, '').replace('.', ',');
}
function clock(min) { const h = Math.floor(min / 60), m = min % 60; return m ? `${h}:${pad2(m)}` : String(h); }
function range(s) { const p = parseTime(s); return p ? `${clock(p[0])}-${clock(p[1])}` : s.trim(); }
const placesText = (i) => places(i).map((e) => `${range(e.time)} ${e.city.trim()}`).join(', ');

// ------------------------------------------------------------------ data

function loadWeek() {
  const saved = store.get(weekKey(), []);
  days = [];
  for (let i = 0; i < 5; i++) {
    const o = saved[i] || {};
    const entries = Array.isArray(o.entries) && o.entries.length
      ? o.entries.map((e) => ({ time: (e && e.time) || '', city: (e && e.city) || '' }))
      : [{ time: o.time || '', city: o.city || '' }];          // gammelt format: én tid + én by
    days.push({ type: TYPES.includes(o.type) ? o.type : WORK, note: o.note || '', entries });
  }
  store.set('lastCurrent', ymd(mondayOf(new Date())));
  render();
}
function save() { store.set(weekKey(), days); }

function allCities() {
  const set = new Map();
  for (let k = 0; k < localStorage.length; k++) {
    const key = localStorage.key(k);
    if (!key || !key.startsWith('week_')) continue;
    for (const d of store.get(key, [])) {
      if (!d) continue;
      for (const e of [d, ...(Array.isArray(d.entries) ? d.entries : [])]) {
        const c = (e && e.city || '').trim();
        if (c && !set.has(c.toLowerCase())) set.set(c.toLowerCase(), c);
      }
    }
  }
  return [...set.values()].sort((a, b) => a.localeCompare(b, 'da'));
}

// ------------------------------------------------------------------ UI

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'list') e.setAttribute(k, v);          // skrivebeskyttet egenskab
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

function render() {
  $('weekTitle').textContent = 'Uge ' + weekNo();
  $('weekSub').textContent = period() + (isCurrentWeek() ? '' : '  ·  tryk for denne uge');
  const dl = el('datalist', { id: 'cities' }, ...allCities().map((c) => el('option', { value: c })));
  const box = $('days');
  box.replaceChildren(dl);
  for (let i = 0; i < 5; i++) box.append(card(i));
  updateTotals();
}

function card(i) {
  const d = day(i), today = sameDay(d, new Date()), D = days[i];
  const hours = el('span', { class: 'hours', id: 'h' + i });
  const head = el('div', { class: 'head' },
    el('span', { class: 'dname' }, DAYS[i]),
    el('span', { class: 'ddate' }, `${d.getDate()}. ${MONTHS[d.getMonth()]}` + (today ? '  · i dag' : '')),
    hours);

  const sel = el('select', { 'aria-label': DAYS[i] + ' type' }, ...TYPES.map((t) => el('option', { value: t, selected: t === D.type }, t)));
  sel.addEventListener('change', () => { D.type = sel.value; save(); rebuild(i); });
  const typerow = el('div', { class: 'typerow' }, sel);
  if (i > 0 && isWork(i)) {
    typerow.append(el('button', {
      class: 'copy', type: 'button', onclick: () => {
        const p = days[i - 1];
        if (p.type !== WORK || !p.entries.some((e) => e.time.trim() || e.city.trim()))
          return toast(DAYS[i - 1] + ' har ingen arbejdstid at kopiere');
        D.entries = p.entries.map((e) => ({ time: e.time, city: e.city })); save(); rebuild(i);
      },
    }, '↓ Som i går'));
  }

  const c = el('div', { class: 'card' + (today ? ' today' : ''), id: 'card' + i }, head, typerow);
  if (isWork(i)) {
    D.entries.forEach((E, k) => {
      const t = el('input', { type: 'text', class: 't', placeholder: k ? '12 - 16' : '7 - 16', value: E.time, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, enterKeyHint: 'next', 'aria-label': `${DAYS[i]} tid ${k + 1}` });
      t.addEventListener('input', () => { E.time = t.value; save(); updateTotals(); });
      const ci = el('input', { type: 'text', class: 'c', placeholder: k ? 'By / sted' : 'By', value: E.city, list: 'cities', autocomplete: 'off', autocapitalize: 'words', enterKeyHint: 'done', 'aria-label': `${DAYS[i]} by ${k + 1}` });
      ci.addEventListener('input', () => { E.city = ci.value; save(); updateTotals(); });
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter') ci.focus(); });
      ci.addEventListener('keydown', (e) => { if (e.key === 'Enter') ci.blur(); });
      const row = el('div', { class: 'fields' + (k ? ' extra' : '') }, t, ci);
      if (k > 0) row.append(el('button', {
        class: 'rm', type: 'button', 'aria-label': 'Fjern sted', onclick: () => { D.entries.splice(k, 1); save(); rebuild(i); },
      }, '✕'));
      c.append(row);
    });
    if (D.entries.length < MAX_PLACES) c.append(el('button', {
      class: 'add', type: 'button', onclick: () => {
        D.entries.push({ time: '', city: '' }); save(); rebuild(i);
        const rows = $('card' + i).querySelectorAll('.fields'); rows[rows.length - 1].querySelector('input').focus();
      },
    }, '+ Tilføj sted'));
  } else {
    const n = el('input', { type: 'text', placeholder: D.type === 'Syg' ? 'Årsag' : 'Bemærkning (valgfri)', value: D.note, autocapitalize: 'sentences', enterKeyHint: 'done', 'aria-label': DAYS[i] + ' bemærkning' });
    n.addEventListener('input', () => { D.note = n.value; save(); });
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter') n.blur(); });
    c.append(n);
  }
  return c;
}

function rebuild(i) { $('card' + i).replaceWith(card(i)); updateTotals(); }

function updateTotals() {
  const missing = [];
  for (let i = 0; i < 5; i++) {
    const h = $('h' + i);
    if (isWork(i)) {
      const s = spanMin(i), any = places(i).some((e) => e.time.trim());
      if (typeof s === 'number') { h.textContent = fmtH(workedMin(i)) + ' t'; h.className = 'hours'; }
      else if (s === 'overlap') { h.textContent = 'Tider overlapper'; h.className = 'hours bad'; }
      else if (any) { h.textContent = 'Ugyldig tid'; h.className = 'hours bad'; }
      else { h.textContent = ''; h.className = 'hours'; }
    } else {
      h.textContent = days[i].type;
      h.className = 'hours ' + (days[i].type === 'Syg' ? 'sick' : 'off');
    }
    if (!complete(i)) missing.push(SHORT[i]);
  }
  $('total').textContent = fmtH(totalMin()) + ' t';
  const ok = missing.length === 0;
  $('approve').disabled = !ok;
  $('missing').textContent = ok ? 'Alle dage er udfyldt – klar til godkendelse' : 'Mangler: ' + missing.join(', ');
  $('missing').className = 'missing' + (ok ? ' ok' : '');
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function openModal(...content) {
  $('sheet').replaceChildren(...content);
  $('modal').hidden = false;
}
function closeModal() { $('modal').hidden = true; }
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

// ------------------------------------------------------------------ indstillinger

function showSettings() {
  const s = settings();
  const name = el('input', { type: 'text', value: s.name, placeholder: 'F.eks. Tim', autocapitalize: 'words' });
  const boss = el('input', { type: 'tel', value: s.boss, placeholder: 'F.eks. 12345678' });
  const fmts = [['PDF', 'PDF'], ['TXT', 'TXT (ren tekst)'], ['CSV', 'CSV (kan åbnes i Excel)']];
  const radios = fmts.map(([v, label]) => {
    const r = el('input', { type: 'radio', name: 'fmt', value: v, checked: s.format === v });
    return { v, r, row: el('label', { class: 'radio' }, r, label) };
  });
  const pMT = el('input', { type: 'number', inputMode: 'numeric', value: s.pauseMT, min: 0, max: 600 });
  const pF = el('input', { type: 'number', inputMode: 'numeric', value: s.pauseFri, min: 0, max: 600 });
  const num = (inp, d) => { const n = parseInt(inp.value, 10); return isNaN(n) ? d : Math.max(0, Math.min(600, n)); };

  openModal(
    el('h2', null, 'Indstillinger'),
    el('label', { class: 'lbl' }, 'Dit navn (vises i SMS og fil)'), name,
    el('label', { class: 'lbl' }, 'Chefens mobilnummer'), boss,
    el('label', { class: 'lbl' }, 'Filformat'), ...radios.map((x) => x.row),
    el('label', { class: 'lbl' }, 'Pause der trækkes fra (minutter)'),
    el('div', { class: 'pauses' }, 'Man–tor', pMT, 'Fredag', pF),
    el('label', { class: 'lbl' }, 'Påmindelse fredag kl. 9:00'),
    el('a', { class: 'linkbtn', href: 'paamindelse.ics', target: '_blank', rel: 'noopener' }, '📅 Tilføj påmindelse til kalenderen'),
    el('p', { class: 'note' }, 'Lægger "HUSK AT SENDE TIMER" i telefonens kalender hver fredag kl. 9:00 med alarm. Skal kun gøres én gang.'),
    el('p', { class: 'note' }, 'Dine timer gemmes kun på denne telefon. Version ' + VERSION + '.'),
    el('div', { class: 'btns' },
      el('button', { type: 'button', onclick: closeModal }, 'Annullér'),
      el('button', {
        type: 'button', class: 'primary', onclick: () => {
          store.set('settings', {
            name: name.value.trim(), boss: boss.value.trim(),
            format: (radios.find((x) => x.r.checked) || radios[0]).v,
            pauseMT: num(pMT, 60), pauseFri: num(pF, 30),
          });
          closeModal(); updateTotals(); toast('Indstillinger gemt');
        },
      }, 'Gem')),
  );
}

// ------------------------------------------------------------------ godkend / output

function approve() {
  const f = settings().format;
  const act = (label, fn) => el('button', { class: 'act', type: 'button', onclick: async () => {
    closeModal();
    try { await fn(); } catch (e) { if (e && e.name !== 'AbortError') toast('Fejl: ' + (e.message || e)); }
  } }, label);
  openModal(
    el('h2', null, `Uge ${weekNo()} – ${fmtH(totalMin())} timer`),
    act(`Gem fil (${f})`, () => saveFile(makeFile(f))),
    act(`Del fil (${f})…`, () => shareFile(makeFile(f))),
    act('Send SMS til chef', sendSms),
    act('Kopiér som tekst', copyText),
    el('div', { class: 'btns' }, el('button', { type: 'button', onclick: closeModal }, 'Luk')),
  );
}

const fileBase = () => `Timeseddel_uge${weekNo()}_${weekYear()}`;
function stamp() { const n = new Date(); return `${pad2(n.getDate())}.${pad2(n.getMonth() + 1)}.${n.getFullYear()} kl. ${pad2(n.getHours())}:${pad2(n.getMinutes())}`; }
function pauseNote() { const s = settings(); return `Pause fratrukket: ${s.pauseMT} min man–tor, ${s.pauseFri} min fredag`; }

function makeFile(fmt) {
  if (fmt === 'PDF') return new File([pdf()], fileBase() + '.pdf', { type: 'application/pdf' });
  if (fmt === 'CSV') return new File(['﻿' + csv()], fileBase() + '.csv', { type: 'text/csv' });
  return new File([txt()], fileBase() + '.txt', { type: 'text/plain' });
}

function saveFile(file) {
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast('Gemt: ' + file.name);
}

async function shareFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Timeseddel uge ' + weekNo() });
  } else {
    toast('Deling virker ikke i denne browser – filen gemmes i stedet');
    saveFile(file);
  }
}

function sendSms() {
  const nr = settings().boss.replace(/\s/g, '');
  location.href = 'sms:' + encodeURIComponent(nr) + '?&body=' + encodeURIComponent(smsText());
  if (!nr) setTimeout(() => toast('Tip: skriv chefens nummer under ⋮ Indstillinger', 4000), 800);
}

async function copyText() {
  try { await navigator.clipboard.writeText(smsText()); }
  catch (e) {
    const ta = el('textarea', { value: smsText() });
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Kopieret');
}

// ------------------------------------------------------------------ formater

function smsText() {
  const name = settings().name;
  const lines = [`Timer uge ${weekNo()}` + (name ? ' – ' + name : '')];
  for (let i = 0; i < 5; i++) {
    const d = day(i), D = days[i];
    lines.push(`${SHORT[i]} ${d.getDate()}/${d.getMonth() + 1}: ` + (isWork(i)
      ? placesText(i)
      : D.type + (D.note.trim() ? ' – ' + D.note.trim() : '')));
  }
  lines.push(`I alt: ${fmtH(totalMin())} t`);
  return lines.join('\n');
}

function txt() {
  const name = settings().name, P = (s, n) => String(s).padEnd(n);
  const out = [`TIMESEDDEL – UGE ${weekNo()}, ${weekYear()}`, period()];
  if (name) out.push('Navn: ' + name);
  out.push('', P('Dag', 10) + P('Dato', 8) + P('Tid', 13) + P('By / bemærkning', 24) + 'Timer', '-'.repeat(60));
  for (let i = 0; i < 5; i++) {
    const d = day(i), D = days[i];
    const lead = P(DAYS[i], 10) + P(`${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`, 8);
    if (isWork(i)) {
      places(i).forEach((e, k) => out.push(((k ? P('', 18) : lead) + P(range(e.time), 13) + P(e.city.trim(), 24)
        + (k ? '' : fmtH(Math.max(0, workedMin(i))) + ' t')).trimEnd()));
    } else {
      out.push(lead + P(D.type, 13) + P(D.note.trim(), 24) + '–');
    }
  }
  out.push('-'.repeat(60), P('I alt', 55) + fmtH(totalMin()) + ' t', '', pauseNote(), 'Godkendt ' + stamp(), '');
  return out.join('\r\n');
}

function csv() {
  const q = (s) => /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  const rows = ['Dag;Dato;Type;Mødetid;Fyraften;By;Bemærkning;Pause (min);Timer'];
  for (let i = 0; i < 5; i++) {
    const d = day(i), D = days[i], date = `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
    if (!isWork(i)) { rows.push([DAYS[i], date, D.type, '', '', '', q(D.note.trim()), '', '0'].join(';')); continue; }
    // Én række pr. sted; pause og dagens timer står på dagens første række.
    places(i).forEach((e, k) => {
      const p = parseTime(e.time);
      rows.push([DAYS[i], date, D.type, p ? clock(p[0]) : '', p ? clock(p[1]) : '', q(e.city.trim()), '',
        k ? '' : pause(i), k ? '' : fmtH(Math.max(0, workedMin(i)))].join(';'));
    });
  }
  rows.push('I alt;;;;;;;;' + fmtH(totalMin()));
  return rows.join('\r\n') + '\r\n';
}

// ---------- PDF: tegnes på et lærred (A4) og pakkes som PDF uden eksterne biblioteker

const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function drawPage(ctx) {
  const C = { primary: '#1E3A5F', text: '#1F2933', muted: '#6B7785', sick: '#C62828', alt: '#F1F4F8' };
  const f = (size, bold) => { ctx.font = `${bold ? '700 ' : ''}${size}px ${FONT}`; };
  const t = (s, x, y, align = 'left') => { ctx.textAlign = align; ctx.fillText(s, x, y); };
  const fit = (s, w) => { if (ctx.measureText(s).width <= w) return s; while (s && ctx.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; };

  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 595, 842);
  const x0 = 40, x1 = 555; let y = 64;
  ctx.fillStyle = C.primary; f(26, true); t('Timeseddel', x0, y);
  f(18, true); t(`Uge ${weekNo()}, ${weekYear()}`, x1, y, 'right');
  ctx.fillStyle = C.text; f(12); y += 22; t(period(), x0, y);
  const name = settings().name;
  if (name) { y += 17; t('Navn: ' + name, x0, y); }
  y += 26;

  const cx = [x0 + 8, 118, 172, 252, 452];
  ctx.fillStyle = C.primary; ctx.fillRect(x0, y, x1 - x0, 24);
  ctx.fillStyle = '#fff'; f(11, true);
  ['Dag', 'Dato', 'Tid', 'By / bemærkning', 'Pause'].forEach((h, k) => t(h, cx[k], y + 16));
  t('Timer', x1 - 8, y + 16, 'right');
  y += 24;

  for (let i = 0; i < 5; i++) {
    const D = days[i], ty = y + 18, d = day(i);
    const pl = isWork(i) ? places(i) : [], rh = 28 + 16 * Math.max(0, pl.length - 1);
    if (i % 2) { ctx.fillStyle = C.alt; ctx.fillRect(x0, y, x1 - x0, rh); }
    ctx.fillStyle = C.text; f(12, true); t(DAYS[i], cx[0], ty);
    f(12); t(`${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`, cx[1], ty);
    if (isWork(i)) {
      pl.forEach((e, k) => {
        t(range(e.time), cx[2], ty + 16 * k);
        t(fit(e.city.trim(), cx[4] - cx[3] - 10), cx[3], ty + 16 * k);
      });
      t(pause(i) + ' min', cx[4], ty);
      f(12, true); t(fmtH(Math.max(0, workedMin(i))) + ' t', x1 - 8, ty, 'right');
    } else {
      ctx.fillStyle = D.type === 'Syg' ? C.sick : C.muted; f(12, true); t(D.type, cx[2], ty);
      ctx.fillStyle = C.text; f(12); t(fit(D.note.trim(), cx[4] - cx[3] - 10), cx[3], ty);
      ctx.fillStyle = C.muted; t('–', cx[4], ty); t('–', x1 - 8, ty, 'right');
    }
    y += rh;
  }
  ctx.fillStyle = C.primary; ctx.fillRect(x0, y, x1 - x0, 1.5);
  y += 24;
  ctx.fillStyle = C.text; f(14, true); t('Timer i alt', cx[0], y); t(fmtH(totalMin()) + ' t', x1 - 8, y, 'right');
  y += 40;
  ctx.fillStyle = C.muted; f(10); t(pauseNote() + '.', x0, y);
  y += 15; t('Godkendt ' + stamp(), x0, y);
}

function pdf() {
  const S = 2.5, W = Math.round(595 * S), H = Math.round(842 * S);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.scale(S, S);
  drawPage(ctx);
  const b64 = cv.toDataURL('image/jpeg', 0.92).split(',')[1];
  const jpg = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

  const enc = new TextEncoder(), parts = [], off = [];
  let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { off[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>');
  off[4] = len;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
  push(jpg);
  push('\nendstream\nendobj\n');
  const content = 'q 595 0 0 842 0 0 cm /Im1 Do Q';
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  push('xref\n0 6\n0000000000 65535 f \n' + [1, 2, 3, 4, 5].map((n) => String(off[n]).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

// ------------------------------------------------------------------ installation / opstart

function setupInstallHint() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || store.get('hideInstall', false)) return;
  const box = $('install');
  const show = (html, extra) => {
    const p = el('p'); p.innerHTML = html;
    box.replaceChildren(p, ...(extra || []), el('button', { type: 'button', onclick: () => { box.hidden = true; store.set('hideInstall', true); } }, '✕'));
    box.hidden = false;
  };
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) {
    show('<b>Installér appen:</b> Tryk på Del-knappen <b>⬆︎</b> nederst i Safari og vælg <b>"Føj til hjemmeskærm"</b>. Brug derefter altid ikonet på hjemmeskærmen.');
  } else {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      show('<b>Installér appen</b> på din hjemmeskærm.', [el('button', { type: 'button', onclick: async () => { e.prompt(); await e.userChoice; box.hidden = true; } }, 'Installér')]);
    });
  }
}

$('prev').addEventListener('click', () => { monday = addDays(monday, -7); loadWeek(); });
$('next').addEventListener('click', () => { monday = addDays(monday, 7); loadWeek(); });
$('weekBtn').addEventListener('click', () => { monday = mondayOf(new Date()); loadWeek(); });
$('menu').addEventListener('click', showSettings);
$('approve').addEventListener('click', approve);

// Skjul bundbjælken mens man skriver, så den ikke dækker felterne over tastaturet.
document.addEventListener('focusin', (e) => { if (e.target.matches('main input')) document.body.classList.add('typing'); });
document.addEventListener('focusout', () => setTimeout(() => {
  if (!document.activeElement || !document.activeElement.matches('main input')) document.body.classList.remove('typing');
}, 50));

// Gå automatisk til den nye uge, hvis appen har ligget åben hen over weekenden.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const cur = ymd(mondayOf(new Date()));
  if (store.get('lastCurrent', '') !== cur) { monday = mondayOf(new Date()); loadWeek(); }
});

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });

setupInstallHint();
loadWeek();
