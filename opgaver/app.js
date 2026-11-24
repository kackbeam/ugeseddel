// Opgaver – opgavestyring til chef og medarbejdere. Data deles via Firebase.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, updateProfile, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, setDoc, updateDoc, onSnapshot, query, orderBy, limit, getDocs,
  writeBatch, arrayUnion, arrayRemove, increment, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject, connectStorageEmulator,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { firebaseConfig } from './firebase-config.js';

const VERSION = '1.0';
const STATUS = { ny: 'Ny', igang: 'I gang', afsluttet: 'Afsluttet' };
const ROLES = ['afventer', 'medarbejder', 'chef', 'deaktiveret'];
const ROLE_L = { afventer: 'Afventer godkendelse', medarbejder: 'Medarbejder', chef: 'Chef', deaktiveret: 'Deaktiveret' };
const CAT_L = { tegning: 'Tegning', ler: 'LER', billede: 'Billede', dokument: 'Dokument' };
const DAYS3 = ['søn.', 'man.', 'tir.', 'ons.', 'tor.', 'fre.', 'lør.'];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const S = {
  user: null, profile: null, users: {}, tasks: [], tasksLoaded: false, started: false, unsubs: [],
  view: 'list', viewId: null, tab: null, search: '', log: [], detailUnsub: null, compose: [],
  formReady: false, formFiles: [], removeFiles: [], queue: [], pendingName: '',
};

// ------------------------------------------------------------------ formatering

const ymdOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function fmtDT(ms) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date(), y = new Date(); y.setDate(y.getDate() - 1);
  const t = `kl. ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (ymdOf(d) === ymdOf(now)) return 'i dag ' + t;
  if (ymdOf(d) === ymdOf(y)) return 'i går ' + t;
  return `${d.getDate()}/${d.getMonth() + 1}${d.getFullYear() !== now.getFullYear() ? '/' + d.getFullYear() : ''} ${t}`;
}
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtDay(s) {
  if (!s) return '';
  const d = parseYmd(s);
  return `${DAYS3[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}${d.getFullYear() !== new Date().getFullYear() ? '/' + d.getFullYear() : ''}`;
}
function daysUntil(s) { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((parseYmd(s) - t) / 864e5); }
function fmtDur(ms) { const min = Math.round(ms / 60000), h = Math.floor(min / 60); return h ? `${h} t ${pad2(min % 60)} min` : `${min} min`; }
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
const isImg = (f) => /^image\//.test(f.type || '');

function lerState(t) {
  const v = t.ler && t.ler.validUntil;
  if (!v) return null;
  const n = daysUntil(v);
  if (n < 0) return { cls: 'bad', text: `LER er udløbet (${fmtDay(v)})` };
  if (n <= 5) return { cls: 'warn', text: n === 0 ? 'LER udløber i dag' : `LER udløber om ${n} dag${n === 1 ? '' : 'e'} (${fmtDay(v)})` };
  return { cls: 'ok', text: `LER gyldig til ${fmtDay(v)}` };
}

// ------------------------------------------------------------------ små UI-hjælpere

function toast(msg, ms = 2800) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
let sheetClose = null;
function openSheet(html, onClose) {
  $('sheet').innerHTML = html; $('modal').hidden = false; sheetClose = onClose || null; return $('sheet');
}
function closeSheet() {
  $('modal').hidden = true; $('sheet').innerHTML = '';
  const f = sheetClose; sheetClose = null; if (f) f();
}
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeSheet(); });
function ask(text, okLabel = 'OK', danger = false) {
  return new Promise((res) => {
    const s = openSheet(`<p class="ask">${esc(text)}</p><div class="btnrow"><button class="btn" data-a="0">Annullér</button>` +
      `<button class="btn ${danger ? 'danger' : 'primary'}" data-a="1">${esc(okLabel)}</button></div>`, () => res(false));
    s.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => { sheetClose = null; closeSheet(); res(b.dataset.a === '1'); }; });
  });
}
function setHeader(title, back) {
  $('title').textContent = title;
  $('back').hidden = !back;
  $('back').onclick = () => { location.hash = back; };
}
function errLog(e) { console.error(e); toast('Fejl: ' + (e.code || e.message)); }
// Skrivninger ventes ikke på – uden net gemmes de lokalt og sendes senere.
function bg(p, msg = 'Kunne ikke gemme') { return p.catch((e) => { console.error(e); toast(msg + ': ' + (e.code || e.message), 5000); }); }

const me = () => S.user.uid;
const myName = () => (S.profile && S.profile.name) || S.user.displayName || S.user.email;
const isChef = () => !!S.profile && S.profile.role === 'chef';
const approved = () => !!S.profile && (S.profile.role === 'chef' || S.profile.role === 'medarbejder');
const uname = (uid) => (S.users[uid] && S.users[uid].name) || 'Ukendt';
const approvedUsers = () => Object.values(S.users).filter((u) => u.role === 'chef' || u.role === 'medarbejder')
  .sort((a, b) => a.name.localeCompare(b.name, 'da'));
const pendingCount = () => Object.values(S.users).filter((u) => u.role === 'afventer').length;
const curTask = () => S.tasks.find((t) => t.id === S.viewId);

function seenMap() { try { return JSON.parse(localStorage.getItem('opg_seen') || '{}'); } catch (e) { return {}; } }
function markSeen(id) { try { const m = seenMap(); m[id] = Date.now(); localStorage.setItem('opg_seen', JSON.stringify(m)); } catch (e) { } }

// ------------------------------------------------------------------ Firebase

const configured = !!(firebaseConfig && firebaseConfig.apiKey && !/INDS/.test(firebaseConfig.apiKey) && firebaseConfig.projectId);
let auth, db, storage;

if (!configured) {
  renderNotConfigured();
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  auth.languageCode = 'da';
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  storage = getStorage(app);
  // Kun til test på egen computer: http://localhost:xxxx/?emulator
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]emulator/.test(location.search)) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
  }
  onAuthStateChanged(auth, onAuth);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}

function updateNet() { $('net').hidden = navigator.onLine; updateQueueBar(); }
window.addEventListener('online', () => { updateNet(); processQueue(); });
window.addEventListener('offline', updateNet);
updateNet();

// ------------------------------------------------------------------ login

let profUnsub = null;
function stopAll() {
  S.unsubs.forEach((f) => f()); S.unsubs = []; stopDetail(); S.started = false; S.tasksLoaded = false;
}
function onAuth(u) {
  if (profUnsub) { profUnsub(); profUnsub = null; }
  stopAll();
  S.user = u; S.profile = null; S.users = {}; S.tasks = [];
  if (!u) { renderLogin('login'); return; }
  $('view').innerHTML = '<div class="empty">Henter…</div>';
  profUnsub = onSnapshot(doc(db, 'users', u.uid), (snap) => {
    if (!snap.exists()) {
      if (!snap.metadata.fromCache) {
        bg(setDoc(doc(db, 'users', u.uid), {
          name: S.pendingName || u.displayName || u.email.split('@')[0], email: u.email, role: 'afventer', createdAt: Date.now(),
        }), 'Kunne ikke oprette bruger');
      }
      return;
    }
    S.profile = snap.data();
    if (approved()) startApp(); else { stopAll(); renderPending(); }
  }, errLog);
}

const AUTH_ERR = {
  'auth/invalid-credential': 'Forkert e-mail eller adgangskode.',
  'auth/wrong-password': 'Forkert adgangskode.',
  'auth/user-not-found': 'Der findes ingen bruger med den e-mail.',
  'auth/email-already-in-use': 'Der findes allerede en bruger med den e-mail. Log ind i stedet.',
  'auth/weak-password': 'Adgangskoden skal være mindst 6 tegn.',
  'auth/invalid-email': 'E-mailen ser forkert ud.',
  'auth/too-many-requests': 'For mange forsøg. Vent lidt og prøv igen.',
  'auth/network-request-failed': 'Ingen forbindelse til internettet.',
};

function renderLogin(mode) {
  setHeader('Opgaver', null);
  const labels = { login: 'Log ind', signup: 'Opret bruger', reset: 'Send link til ny adgangskode' };
  $('view').innerHTML = `<section class="card auth">
    <div class="logo">📋</div>
    <h2>${mode === 'signup' ? 'Opret bruger' : mode === 'reset' ? 'Glemt adgangskode' : 'Log ind'}</h2>
    ${mode === 'signup' ? '<p class="muted">Chefen skal godkende dig, før du kan se opgaverne.</p>' : ''}
    ${mode === 'reset' ? '<p class="muted">Du får en mail med et link, hvor du kan vælge en ny adgangskode.</p>' : ''}
    <form id="af" class="form">
      ${mode === 'signup' ? '<label>Dit navn<input name="name" required autocomplete="name"></label>' : ''}
      <label>E-mail<input name="email" type="email" required autocomplete="email" inputmode="email"></label>
      ${mode !== 'reset' ? `<label>Adgangskode<input name="pw" type="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>` : ''}
      <div id="aerr" class="err" hidden></div>
      <button class="btn primary big" type="submit">${labels[mode]}</button>
    </form>
    <div class="authlinks">${mode === 'login'
    ? '<button data-m="signup">Ny bruger? Opret dig her</button><button data-m="reset">Glemt adgangskode?</button>'
    : '<button data-m="login">Tilbage til log ind</button>'}</div>
  </section>`;
  $('view').querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => renderLogin(b.dataset.m); });
  $('af').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), email = String(fd.get('email')).trim(), pw = String(fd.get('pw') || '');
    const btn = e.target.querySelector('button[type=submit]'), errEl = $('aerr');
    btn.disabled = true; errEl.hidden = true;
    try {
      if (mode === 'login') await signInWithEmailAndPassword(auth, email, pw);
      else if (mode === 'signup') {
        S.pendingName = String(fd.get('name')).trim();
        const cred = await createUserWithEmailAndPassword(auth, email, pw);
        updateProfile(cred.user, { displayName: S.pendingName }).catch(() => { });
      } else {
        await sendPasswordResetEmail(auth, email);
        renderLogin('login'); toast('Mail sendt – tjek din indbakke (og spam)', 5000); return;
      }
    } catch (err) {
      errEl.textContent = AUTH_ERR[err.code] || ('Fejl: ' + (err.code || err.message));
      errEl.hidden = false; btn.disabled = false;
    }
  };
}

function renderPending() {
  setHeader('Opgaver', null);
  const off = S.profile && S.profile.role === 'deaktiveret';
  $('view').innerHTML = `<section class="card auth">
    <div class="logo">${off ? '⛔' : '⏳'}</div>
    <h2>${off ? 'Din bruger er deaktiveret' : 'Venter på godkendelse'}</h2>
    <p class="muted">${off ? 'Kontakt chefen, hvis det er en fejl.'
    : `Hej ${esc(myName())}. Din bruger er oprettet, men chefen skal godkende den, før du kan se opgaverne. Siden opdaterer selv, når du er godkendt.`}</p>
    <button class="btn" id="pOut">Log ud</button>
  </section>`;
  $('pOut').onclick = () => signOut(auth);
}

function renderNotConfigured() {
  setHeader('Opgaver', null);
  $('menuBtn').hidden = true;
  $('view').innerHTML = `<section class="card auth">
    <div class="logo">⚙️</div>
    <h2>Appen er ikke sat op endnu</h2>
    <p class="muted">Firebase-oplysningerne mangler i filen <b>opgaver/firebase-config.js</b>.
    Følg guiden <b>OPSAETNING.md</b> i opgaver-mappen – det tager ca. 15 minutter.</p>
  </section>`;
}

// ------------------------------------------------------------------ app start + router

function startApp() {
  updateMenuBadge();
  if (S.started) { refresh(); return; }
  S.started = true;
  S.unsubs.push(onSnapshot(collection(db, 'users'), (snap) => {
    S.users = {}; snap.forEach((d) => { S.users[d.id] = { id: d.id, ...d.data() }; });
    refresh();
  }, errLog));
  S.unsubs.push(onSnapshot(query(collection(db, 'tasks'), orderBy('createdAt', 'desc'), limit(500)), (snap) => {
    S.tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    S.tasksLoaded = true;
    refresh();
  }, errLog));
  route();
  processQueue();
}

window.addEventListener('hashchange', () => { if (S.started) route(); });

function route() {
  stopDetail();
  if (!$('modal').hidden) closeSheet();
  const [p, id] = location.hash.replace(/^#\/?/, '').split('/');
  S.view = p || 'list'; S.viewId = id || null; S.formReady = false;
  window.scrollTo(0, 0);
  if (p === 'opgave' && id) return viewDetail(id);
  if (p === 'ny' && isChef()) return viewForm(null);
  if (p === 'ret' && id && isChef()) return viewForm(id);
  if (p === 'brugere' && isChef()) return viewUsers();
  S.view = 'list';
  viewList();
}

function refresh() {
  if (!S.started) return;
  updateMenuBadge();
  if (S.view === 'list') renderListResults();
  else if (S.view === 'opgave') renderDetailTop();
  else if (S.view === 'brugere') renderUsers();
  else if ((S.view === 'ret' || S.view === 'ny') && !S.formReady) viewForm(S.viewId);
}

function updateMenuBadge() { $('menuDot').hidden = !(isChef() && pendingCount() > 0); }

// ------------------------------------------------------------------ menu

$('menuBtn').onclick = () => {
  if (!S.user) return;
  const n = pendingCount();
  const s = openSheet(`<div class="who"><b>${esc(myName())}</b><small>${esc(S.user.email)}${S.profile ? ' · ' + ROLE_L[S.profile.role] : ''}</small></div>
    ${isChef() ? `<a class="mi" href="#/brugere">👥 Brugere${n ? ` <span class="badge">${n} venter</span>` : ''}</a>` : ''}
    ${approved() ? '<button class="mi" id="mName">✏️ Skift mit navn</button>' : ''}
    <button class="mi" id="mReload">🔄 Opdatér appen</button>
    <button class="mi" id="mOut">🚪 Log ud</button>
    <div class="ver">Opgaver v${VERSION}</div>`);
  s.querySelectorAll('a.mi').forEach((a) => { a.onclick = () => closeSheet(); });
  if ($('mName')) $('mName').onclick = () => {
    const s2 = openSheet(`<h3>Dit navn</h3><form id="nf" class="form"><input name="n" value="${esc(myName())}" required>
      <div class="btnrow"><button type="button" class="btn" id="nC">Annullér</button><button class="btn primary">Gem</button></div></form>`);
    s2.querySelector('#nC').onclick = closeSheet;
    s2.querySelector('#nf').onsubmit = (e) => {
      e.preventDefault();
      const v = String(new FormData(e.target).get('n')).trim();
      if (v) bg(updateDoc(doc(db, 'users', me()), { name: v }));
      closeSheet();
    };
  };
  $('mReload').onclick = () => location.reload();
  $('mOut').onclick = async () => {
    const q = await qAll().catch(() => []);
    if (q.length && !(await ask(`${q.length} fil(er) er ikke uploadet endnu. De bliver liggende på telefonen og sendes, næste gang du logger ind. Log ud alligevel?`, 'Log ud'))) return;
    closeSheet(); location.hash = ''; signOut(auth);
  };
};

// ------------------------------------------------------------------ liste

function viewList() {
  setHeader('Opgaver', null);
  if (!S.tab) S.tab = isChef() ? 'aktive' : 'mine';
  const tabs = [['mine', 'Mine'], ['aktive', 'Alle aktive'], ['afsluttede', 'Afsluttede']];
  $('view').innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="searchwrap"><input id="search" type="search" placeholder="Søg i titel, adresse, kunde…" value="${esc(S.search)}"></div>
    <div id="list"></div>
    ${isChef() ? '<a class="fab" href="#/ny" aria-label="Ny opgave">＋ Ny opgave</a>' : ''}`;
  $('view').querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => {
      S.tab = b.dataset.tab;
      $('view').querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      renderListResults();
    };
  });
  $('search').oninput = (e) => { S.search = e.target.value; renderListResults(); };
  renderListResults();
}

function renderListResults() {
  const el = $('list');
  if (!el) return;
  if (!S.tasksLoaded) { el.innerHTML = '<div class="empty">Henter opgaver…</div>'; return; }
  const uid = me(), q = S.search.trim().toLowerCase();
  let arr = S.tasks.filter((t) => {
    if (S.tab === 'afsluttede') return t.status === 'afsluttet';
    if (t.status === 'afsluttet') return false;
    if (S.tab === 'mine') return (t.assignees || []).includes(uid) || !!(t.active && t.active[uid]);
    return true;
  });
  if (q) arr = arr.filter((t) => [t.title, t.address, t.customer, t.description, t.ler && t.ler.number].join(' ').toLowerCase().includes(q));
  const rank = (t) => (t.status === 'igang' ? 0 : 1);
  if (S.tab === 'afsluttede') arr.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  else arr.sort((a, b) => rank(a) - rank(b) || (a.plannedDate || '9999').localeCompare(b.plannedDate || '9999') || (b.createdAt || 0) - (a.createdAt || 0));
  const emptyTxt = q ? 'Ingen opgaver matcher søgningen.'
    : S.tab === 'mine' ? 'Du har ingen aktive opgaver lige nu.' : S.tab === 'aktive' ? 'Der er ingen aktive opgaver.' : 'Ingen afsluttede opgaver endnu.';
  el.innerHTML = arr.length ? arr.map(card).join('') : `<div class="empty">${emptyTxt}</div>`;
}

function card(t) {
  const ler = lerState(t), names = (t.assignees || []).map(uname).join(', ');
  const unseen = (t.updatedAt || 0) > (seenMap()[t.id] || 0) && t.lastBy !== me();
  const activeN = Object.keys(t.active || {}).length;
  return `<a class="card task st-${t.status}" href="#/opgave/${t.id}">
    <div class="trow"><span class="chip st-${t.status}">${STATUS[t.status] || ''}</span>
      ${activeN ? `<span class="chip live">● ${activeN} på opgaven</span>` : ''}
      ${t.plannedDate ? `<span class="when">📅 ${fmtDay(t.plannedDate)}</span>` : ''}
      ${unseen ? '<span class="newdot" title="Nyt siden sidst"></span>' : ''}</div>
    <h3>${esc(t.title || 'Uden titel')}</h3>
    ${t.address ? `<div class="sub">📍 ${esc(t.address)}</div>` : ''}
    ${t.customer ? `<div class="sub">🏠 ${esc(t.customer)}</div>` : ''}
    <div class="sub">👷 ${names ? esc(names) : '<i>Ikke tildelt</i>'}</div>
    ${ler && t.status !== 'afsluttet' && ler.cls !== 'ok' ? `<div class="ler ${ler.cls}">⚠️ ${ler.text}</div>` : ''}
    ${t.status === 'afsluttet' ? `<div class="sub">✔ Afsluttet ${fmtDT(t.finishedAt)}</div>` : ''}
  </a>`;
}

// ------------------------------------------------------------------ opgave-detaljer

function stopDetail() { if (S.detailUnsub) { S.detailUnsub(); S.detailUnsub = null; } clearInterval(S.tick); }

function viewDetail(id) {
  setHeader('Opgave', '#/');
  S.log = []; S.logLoaded = false; S.compose = [];
  $('view').innerHTML = `<div id="dTop"><div class="empty">Henter…</div></div>
    <section class="card" id="logCard" hidden><h2>Noter og billeder</h2>
      <div id="dLog"><div class="empty small">Henter…</div></div>
      <div class="composer">
        <textarea id="note" rows="3" placeholder="Skriv en note…"></textarea>
        <div id="cThumbs" class="grid"></div>
        <div class="crow">
          <button class="btn" id="cCam">📷 Tag billede</button>
          <button class="btn" id="cGal">🖼 Vælg filer</button>
          <button class="btn primary" id="cSend">Gem</button>
        </div>
        <input type="file" id="fCam" accept="image/*" capture="environment" hidden>
        <input type="file" id="fGal" accept="image/*,application/pdf" multiple hidden>
      </div>
    </section>`;
  $('cCam').onclick = () => $('fCam').click();
  $('cGal').onclick = () => $('fGal').click();
  $('fCam').onchange = (e) => { addCompose(e.target.files); e.target.value = ''; };
  $('fGal').onchange = (e) => { addCompose(e.target.files); e.target.value = ''; };
  $('cSend').onclick = sendNote;
  S.detailUnsub = onSnapshot(query(collection(db, 'tasks', id, 'log'), orderBy('at', 'asc')), (snap) => {
    S.log = snap.docs.map((d) => ({ id: d.id, ...d.data() })); S.logLoaded = true;
    renderLog(); renderDetailTop();
  }, errLog);
  S.tick = setInterval(() => { const t = curTask(); if (t && Object.keys(t.active || {}).length) renderDetailTop(); }, 60000);
  renderDetailTop();
}

function hoursBy(t) {
  const open = {}, tot = {};
  for (const e of S.log) {
    const who = e.who || e.by;
    if (e.type === 'start') open[who] = e.at;
    else if (e.type === 'stop' && open[who]) { tot[who] = (tot[who] || 0) + (e.at - open[who]); delete open[who]; }
  }
  for (const who of Object.keys(open)) if (t.active && t.active[who]) tot[who] = (tot[who] || 0) + (Date.now() - open[who]);
  return tot;
}

function fileBlock(files, pendingTxt, wide = false) {
  if (!files.length && !pendingTxt) return '';
  const imgs = files.filter(isImg), other = files.filter((f) => !isImg(f));
  return (imgs.length ? `<div class="grid${wide ? ' wide' : ''}">${imgs.map((f) =>
    `<button class="thumb" data-img="${esc(f.url)}" aria-label="${esc(f.name)}"><img src="${esc(f.url)}" loading="lazy" alt=""></button>`).join('')}</div>` : '') +
    other.map((f) => `<a class="filerow" href="${esc(f.url)}" target="_blank" rel="noopener">📄 <span>${esc(f.name)}</span><small>${fmtSize(f.size || 0)}</small></a>`).join('') +
    (pendingTxt ? `<div class="pend">⏳ ${pendingTxt}</div>` : '');
}

function wireFiles(root) {
  root.querySelectorAll('[data-img]').forEach((b) => {
    b.onclick = () => {
      const all = [...b.closest('.grid').querySelectorAll('[data-img]')];
      openLightbox(all.map((x) => x.dataset.img), all.indexOf(b));
    };
  });
}

function infoRow(icon, label, value, extra = '') {
  return `<div class="info"><span class="ii">${icon}</span><div class="iv"><small>${label}</small><b>${value}</b></div>${extra}</div>`;
}

function renderDetailTop() {
  const el = $('dTop');
  if (!el) return;
  const t = curTask();
  if (!t) {
    el.innerHTML = `<div class="empty">${S.tasksLoaded ? 'Opgaven findes ikke (den er måske slettet).' : 'Henter…'}</div>`;
    $('logCard').hidden = true;
    return;
  }
  $('logCard').hidden = false;
  markSeen(t.id);
  setHeader(t.title || 'Opgave', '#/');
  const uid = me(), iActive = !!(t.active && t.active[uid]), ler = lerState(t), files = t.files || [];
  const byCat = (c) => files.filter((f) => f.category === c);
  const qn = (c) => S.queue.filter((q) => q.taskId === t.id && !q.logId && q.category === c).length;
  const qTxt = (c) => (qn(c) ? `${qn(c)} fil(er) venter på upload` : '');

  let actions;
  if (t.status === 'ny') actions = '<button class="btn big go" data-act="start">▶ Start opgaven</button>';
  else if (t.status === 'igang') {
    actions = (iActive ? '<button class="btn big pause" data-act="stop">⏸ Stop for i dag</button>'
      : '<button class="btn big go" data-act="resume">▶ Start arbejde</button>') +
      '<button class="btn big done" data-act="finish">✔ Afslut opgaven</button>';
  } else {
    actions = `<div class="donebox">✔ Afsluttet ${fmtDT(t.finishedAt)}${t.finishedByName ? ' af ' + esc(t.finishedByName) : ''}</div>` +
      (isChef() ? '<button class="btn" data-act="reopen">↺ Genåbn opgaven</button>' : '');
  }
  const activeNames = Object.keys(t.active || {}).map((u) => `${esc(uname(u))} (fra ${fmtDT(t.active[u])})`);
  const hours = hoursBy(t), hourKeys = Object.keys(hours);
  const total = hourKeys.reduce((a, k) => a + hours[k], 0);
  const phone = (t.contactPhone || '').replace(/[^\d+]/g, '');
  const names = (t.assignees || []).map(uname).join(', ');

  const sec = (title, body) => `<section class="card"><h2>${title}</h2>${body}</section>`;
  el.innerHTML = `
  <section class="card head">
    <div class="trow"><span class="chip st-${t.status}">${STATUS[t.status] || ''}</span>
      ${t.plannedDate ? `<span class="when">📅 ${fmtDay(t.plannedDate)}</span>` : ''}</div>
    <h1 class="ttl">${esc(t.title)}</h1>
    ${activeNames.length ? `<div class="livebox">● På opgaven nu: ${activeNames.join(', ')}</div>` : ''}
    <div class="actions">${actions}</div>
  </section>
  <section class="card">
    ${t.address ? infoRow('📍', 'Adresse', esc(t.address),
    `<a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(t.address)}">🧭 Navigér</a>`) : ''}
    ${t.customer ? infoRow('🏠', 'Kunde', esc(t.customer)) : ''}
    ${t.contactName || phone ? infoRow('👤', 'Kontakt', esc([t.contactName, t.contactPhone].filter(Boolean).join(' · ')),
    phone ? `<a class="btn small" href="tel:${esc(phone)}">📞 Ring</a>` : '') : ''}
    ${infoRow('👷', 'Udføres af', names ? esc(names) : '<i>Ikke tildelt</i>')}
  </section>
  ${t.description ? sec('Beskrivelse', `<div class="desc">${esc(t.description)}</div>`) : ''}
  ${(t.ler && (t.ler.number || t.ler.validUntil)) || byCat('ler').length || qn('ler') ? sec('LER-oplysninger',
    (t.ler && t.ler.number ? `<div class="kv"><span>LER-nr.</span><b>${esc(t.ler.number)}</b></div>` : '') +
    (ler ? `<div class="ler ${ler.cls}">${ler.cls === 'ok' ? '✅' : '⚠️'} ${ler.text}</div>` : '') +
    fileBlock(byCat('ler'), qTxt('ler'), true)) : ''}
  ${byCat('tegning').length || qn('tegning') ? sec('Tegninger', fileBlock(byCat('tegning'), qTxt('tegning'), true)) : ''}
  ${byCat('billede').length || qn('billede') ? sec('Billeder fra chefen', fileBlock(byCat('billede'), qTxt('billede'))) : ''}
  ${byCat('dokument').length || qn('dokument') ? sec('Dokumenter', fileBlock(byCat('dokument'), qTxt('dokument'))) : ''}
  ${sec('Tid', `<div class="tl">
      <div>📝 Oprettet ${fmtDT(t.createdAt)}${t.createdByName ? ' af ' + esc(t.createdByName) : ''}</div>
      ${t.startedAt ? `<div>▶ Startet ${fmtDT(t.startedAt)}${t.startedByName ? ' af ' + esc(t.startedByName) : ''}</div>` : ''}
      ${t.finishedAt ? `<div>✔ Afsluttet ${fmtDT(t.finishedAt)}${t.finishedByName ? ' af ' + esc(t.finishedByName) : ''}</div>` : ''}
    </div>
    ${hourKeys.length ? `<div class="hours">${hourKeys.map((k) => `<div class="kv"><span>${esc(uname(k))}</span><b>${fmtDur(hours[k])}</b></div>`).join('')}
      ${hourKeys.length > 1 ? `<div class="kv tot"><span>I alt</span><b>${fmtDur(total)}</b></div>` : ''}</div>` : ''}`)}
  ${isChef() ? `<div class="chefrow"><a class="btn" href="#/ret/${t.id}">✏️ Ret opgave</a><button class="btn danger" data-act="delete">🗑 Slet opgave</button></div>` : ''}`;
  el.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => doAction(b.dataset.act, t); });
  wireFiles(el);
}

function renderLog() {
  const el = $('dLog');
  if (!el) return;
  const uid = me();
  if (!S.log.length) { el.innerHTML = '<div class="empty small">Ingen noter endnu.</div>'; return; }
  el.innerHTML = S.log.map((e) => {
    if (e.type === 'note') {
      const canDel = e.by === uid || isChef();
      const p = e.pending > 0 ? `${e.pending} fil${e.pending === 1 ? '' : 'er'} venter på upload` : '';
      return `<div class="note${e.by === uid ? ' mine' : ''}">
        <div class="nh"><b>${esc(e.byName)}</b><span>${fmtDT(e.at)}</span>${canDel ? `<button class="x" data-del="${e.id}" aria-label="Slet note">×</button>` : ''}</div>
        ${e.text ? `<div class="nt">${esc(e.text)}</div>` : ''}
        ${fileBlock(e.files || [], p)}
      </div>`;
    }
    let txt;
    if (e.type === 'start') txt = `▶ <b>${esc(e.byName)}</b> startede`;
    else if (e.type === 'stop') txt = e.who && e.who !== e.by ? `⏸ <b>${esc(e.whoName)}</b> blev stoppet, da opgaven blev afsluttet` : `⏸ <b>${esc(e.byName)}</b> stoppede`;
    else if (e.type === 'afslut') txt = `✔ <b>${esc(e.byName)}</b> afsluttede opgaven`;
    else if (e.type === 'genaabn') txt = `↺ <b>${esc(e.byName)}</b> genåbnede opgaven`;
    else txt = esc(e.type);
    return `<div class="ev"><div>${txt} <span>· ${fmtDT(e.at)}</span></div>${e.text ? `<div class="nt">${esc(e.text)}</div>` : ''}</div>`;
  }).join('');
  el.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const e = S.log.find((x) => x.id === b.dataset.del);
      if (!e || !(await ask('Slet denne note og dens billeder?', 'Slet', true))) return;
      const batch = writeBatch(db);
      batch.delete(doc(db, 'tasks', S.viewId, 'log', e.id));
      bg(batch.commit());
      (e.files || []).forEach((f) => deleteObject(ref(storage, f.path)).catch(() => { }));
    };
  });
  wireFiles(el);
}

function addCompose(list) {
  for (const f of list) S.compose.push({ file: f, url: isImg(f) ? URL.createObjectURL(f) : null });
  renderCompose();
}
function renderCompose() {
  const el = $('cThumbs');
  el.innerHTML = S.compose.map((c, i) => `<div class="thumb">${c.url ? `<img src="${c.url}" alt="">` : `<span class="fname">📄 ${esc(c.file.name)}</span>`}
    <button class="x" data-rm="${i}" aria-label="Fjern">×</button></div>`).join('');
  el.querySelectorAll('[data-rm]').forEach((b) => {
    b.onclick = () => { const c = S.compose.splice(Number(b.dataset.rm), 1)[0]; if (c.url) URL.revokeObjectURL(c.url); renderCompose(); };
  });
}

async function sendNote() {
  const t = curTask();
  if (!t) return;
  const text = $('note').value.trim(), files = S.compose.map((c) => c.file);
  if (!text && !files.length) { toast('Skriv en note eller vælg et billede'); return; }
  const btn = $('cSend'); btn.disabled = true; btn.textContent = 'Gemmer…';
  const now = Date.now(), r = doc(collection(db, 'tasks', t.id, 'log'));
  bg(setDoc(r, { type: 'note', text, by: me(), byName: myName(), at: now, files: [], pending: files.length }));
  bg(updateDoc(doc(db, 'tasks', t.id), { updatedAt: now, lastBy: me() }));
  try {
    for (const f of files) await enqueue({ taskId: t.id, logId: r.id, file: f, category: 'billede' });
  } catch (e) { errLog(e); }
  S.compose.forEach((c) => c.url && URL.revokeObjectURL(c.url));
  S.compose = []; renderCompose();
  $('note').value = '';
  btn.disabled = false; btn.textContent = 'Gem';
  processQueue();
}

function askFinish(t) {
  const others = Object.keys(t.active || {}).filter((u) => u !== me()).map(uname);
  return new Promise((res) => {
    const s = openSheet(`<h3>Afslut opgaven?</h3>
      ${others.length ? `<p class="muted">${esc(others.join(' og '))} er også på opgaven og bliver stoppet.</p>` : ''}
      <label class="form">Afsluttende bemærkning (valgfri)<textarea id="fNote" rows="3" placeholder="Fx alt færdigt, mangler kun asfalt"></textarea></label>
      <div class="btnrow"><button class="btn" id="fC">Annullér</button><button class="btn done" id="fOk">✔ Afslut</button></div>`, () => res(null));
    s.querySelector('#fC').onclick = () => closeSheet();
    s.querySelector('#fOk').onclick = () => { const v = s.querySelector('#fNote').value.trim(); sheetClose = null; closeSheet(); res(v); };
  });
}

async function doAction(act, t) {
  const uid = me(), name = myName(), now = Date.now();
  const tref = doc(db, 'tasks', t.id);
  const logRef = () => doc(collection(db, 'tasks', t.id, 'log'));
  const ev = (type, extra = {}) => ({ type, text: '', by: uid, byName: name, at: now, ...extra });
  const b = writeBatch(db);
  if (act === 'start') {
    b.update(tref, { status: 'igang', startedAt: now, startedBy: uid, startedByName: name, [`active.${uid}`]: now, updatedAt: now, lastBy: uid });
    b.set(logRef(), ev('start'));
    toast('Opgaven er startet');
  } else if (act === 'resume') {
    b.update(tref, { [`active.${uid}`]: now, updatedAt: now, lastBy: uid });
    b.set(logRef(), ev('start'));
  } else if (act === 'stop') {
    b.update(tref, { [`active.${uid}`]: deleteField(), updatedAt: now, lastBy: uid });
    b.set(logRef(), ev('stop'));
  } else if (act === 'finish') {
    const note = await askFinish(t);
    if (note === null) return;
    b.update(tref, { status: 'afsluttet', finishedAt: now, finishedBy: uid, finishedByName: name, active: {}, updatedAt: now, lastBy: uid });
    for (const u of Object.keys(t.active || {})) b.set(logRef(), ev('stop', { who: u, whoName: uname(u) }));
    b.set(logRef(), ev('afslut', { text: note, at: now + 1 }));
    toast('Opgaven er afsluttet');
  } else if (act === 'reopen') {
    if (!(await ask('Genåbn opgaven, så der kan arbejdes videre på den?', 'Genåbn'))) return;
    b.update(tref, { status: 'igang', finishedAt: null, finishedBy: null, finishedByName: null, updatedAt: now, lastBy: uid });
    b.set(logRef(), ev('genaabn'));
  } else if (act === 'delete') {
    deleteTask(t);
    return;
  }
  bg(b.commit());
}

async function deleteTask(t) {
  if (!(await ask(`Slet opgaven "${t.title}" med alle noter og billeder? Det kan ikke fortrydes.`, 'Slet', true))) return;
  try {
    const logs = await getDocs(collection(db, 'tasks', t.id, 'log'));
    const paths = (t.files || []).map((f) => f.path);
    const b = writeBatch(db);
    logs.forEach((d) => { b.delete(d.ref); (d.data().files || []).forEach((f) => paths.push(f.path)); });
    b.delete(doc(db, 'tasks', t.id));
    bg(b.commit(), 'Kunne ikke slette');
    paths.forEach((p) => deleteObject(ref(storage, p)).catch(() => { }));
    toast('Opgaven er slettet');
    location.hash = '#/';
  } catch (e) { errLog(e); }
}

// ------------------------------------------------------------------ opret / ret opgave (chef)

function viewForm(id) {
  const t = id ? curTask() : null;
  setHeader(id ? 'Ret opgave' : 'Ny opgave', id ? `#/opgave/${id}` : '#/');
  if (id && !t) {
    $('view').innerHTML = `<div class="empty">${S.tasksLoaded ? 'Opgaven findes ikke.' : 'Henter…'}</div>`;
    return;
  }
  S.formReady = true; S.formFiles = []; S.removeFiles = [];
  const asg = new Set((t && t.assignees) || []), v = (k) => esc(t && t[k]);
  const users = approvedUsers();
  $('view').innerHTML = `<form id="tf" class="form" novalidate>
    <section class="card">
      <label>Titel *<input name="title" value="${v('title')}" placeholder="Fx Ny stikledning til hus"></label>
      <label>Beskrivelse<textarea name="description" rows="5" placeholder="Hvad skal laves?">${v('description')}</textarea></label>
      <label>Planlagt dato<input type="date" name="plannedDate" value="${v('plannedDate')}"></label>
    </section>
    <section class="card"><h2>Sted og kunde</h2>
      <label>Adresse<input name="address" value="${v('address')}" placeholder="Vejnavn 1, 1234 By" autocomplete="off"></label>
      <label>Kunde<input name="customer" value="${v('customer')}"></label>
      <div class="two">
        <label>Kontaktperson<input name="contactName" value="${v('contactName')}"></label>
        <label>Telefon<input name="contactPhone" type="tel" value="${v('contactPhone')}"></label>
      </div>
    </section>
    <section class="card"><h2>Hvem skal udføre opgaven?</h2>
      <div class="checks">${users.map((u) => `<label class="check"><input type="checkbox" name="asg" value="${u.id}" ${asg.has(u.id) ? 'checked' : ''}><span>${esc(u.name)}</span></label>`).join('')
    || '<div class="empty small">Ingen godkendte brugere endnu.</div>'}</div>
    </section>
    <section class="card"><h2>LER</h2>
      <div class="two">
        <label>LER-nummer<input name="lerNumber" value="${esc(t && t.ler && t.ler.number)}" inputmode="numeric"></label>
        <label>Gyldig til<input type="date" name="lerValid" value="${esc(t && t.ler && t.ler.validUntil)}"></label>
      </div>
      <button type="button" class="btn" data-pick="ler">📎 Vedhæft LER-filer</button>
      <div class="fl" id="fl-ler"></div>
    </section>
    <section class="card"><h2>Tegninger, billeder og dokumenter</h2>
      <div class="pickrow">
        <button type="button" class="btn" data-pick="tegning">📐 Tegninger</button>
        <button type="button" class="btn" data-pick="billede">📷 Billeder</button>
        <button type="button" class="btn" data-pick="dokument">📄 Dokumenter</button>
      </div>
      <div class="fl" id="fl-other"></div>
    </section>
    <div class="formbtns">
      <a class="btn" href="${id ? `#/opgave/${id}` : '#/'}">Annullér</a>
      <button class="btn primary" type="submit" id="tfSave">${id ? 'Gem ændringer' : 'Opret opgave'}</button>
    </div>
  </form>
  <input type="file" id="fPick" multiple hidden>`;

  let pickCat = 'billede';
  $('view').querySelectorAll('[data-pick]').forEach((b) => {
    b.onclick = () => {
      pickCat = b.dataset.pick;
      $('fPick').accept = pickCat === 'billede' ? 'image/*' : pickCat === 'dokument' ? '' : 'image/*,application/pdf';
      $('fPick').click();
    };
  });
  $('fPick').onchange = (e) => {
    for (const f of e.target.files) S.formFiles.push({ key: rid(), file: f, category: pickCat });
    e.target.value = '';
    renderFormFiles(t);
  };
  renderFormFiles(t);
  $('tf').onsubmit = (e) => { e.preventDefault(); saveTask(e.target, t); };
}

function renderFormFiles(t) {
  const existing = ((t && t.files) || []).filter((f) => !S.removeFiles.includes(f.id));
  const row = (name, cat, attr) => `<div class="frow"><span class="tag">${CAT_L[cat] || cat}</span><span class="fn">${esc(name)}</span>
    <button type="button" class="x" ${attr} aria-label="Fjern">×</button></div>`;
  const rows = (isLer) => existing.filter((f) => (f.category === 'ler') === isLer).map((f) => row(f.name, f.category, `data-rmold="${f.id}"`)).join('') +
    S.formFiles.filter((f) => (f.category === 'ler') === isLer).map((f) => row(f.file.name, f.category, `data-rmnew="${f.key}"`) + '').join('');
  $('fl-ler').innerHTML = rows(true);
  $('fl-other').innerHTML = rows(false);
  $('view').querySelectorAll('[data-rmold]').forEach((b) => { b.onclick = () => { S.removeFiles.push(b.dataset.rmold); renderFormFiles(t); }; });
  $('view').querySelectorAll('[data-rmnew]').forEach((b) => { b.onclick = () => { S.formFiles = S.formFiles.filter((f) => f.key !== b.dataset.rmnew); renderFormFiles(t); }; });
}

async function saveTask(form, t) {
  const fd = new FormData(form), g = (k) => String(fd.get(k) || '').trim();
  const title = g('title');
  if (!title) { toast('Skriv en titel'); form.title.focus(); return; }
  const btn = $('tfSave'); btn.disabled = true; btn.textContent = 'Gemmer…';
  const now = Date.now(), uid = me();
  const data = {
    title, description: g('description'), plannedDate: g('plannedDate'),
    address: g('address'), customer: g('customer'), contactName: g('contactName'), contactPhone: g('contactPhone'),
    assignees: fd.getAll('asg').map(String), ler: { number: g('lerNumber'), validUntil: g('lerValid') },
    updatedAt: now, lastBy: uid,
  };
  let tid;
  if (!t) {
    const r = doc(collection(db, 'tasks')); tid = r.id;
    bg(setDoc(r, { ...data, status: 'ny', files: [], active: {}, createdAt: now, createdBy: uid, createdByName: myName() }));
  } else {
    tid = t.id;
    const rem = (t.files || []).filter((f) => S.removeFiles.includes(f.id));
    if (rem.length) data.files = arrayRemove(...rem);
    bg(updateDoc(doc(db, 'tasks', tid), data));
    rem.forEach((f) => deleteObject(ref(storage, f.path)).catch(() => { }));
  }
  try {
    for (const nf of S.formFiles) await enqueue({ taskId: tid, file: nf.file, category: nf.category });
  } catch (e) { errLog(e); }
  S.formFiles = [];
  processQueue();
  toast(t ? 'Ændringerne er gemt' : 'Opgaven er oprettet');
  location.hash = `#/opgave/${tid}`;
}

// ------------------------------------------------------------------ brugere (chef)

function viewUsers() {
  setHeader('Brugere', '#/');
  $('view').innerHTML = `<div id="ulist"></div>
    <p class="hint">Nye medarbejdere åbner appen og trykker <b>"Ny bruger? Opret dig her"</b>. Derefter dukker de op her, og du godkender dem.
    Sæt en bruger til <b>Deaktiveret</b>, hvis vedkommende stopper.</p>`;
  renderUsers();
}

function renderUsers() {
  const el = $('ulist');
  if (!el) return;
  const all = Object.values(S.users).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'da'));
  const urow = (u) => `<div class="urow"><div class="un"><b>${esc(u.name)}${u.id === me() ? ' (dig)' : ''}</b><small>${esc(u.email)}</small></div>
    ${u.role === 'afventer'
    ? `<div class="ub"><button class="btn small done" data-ok="${u.id}">Godkend</button><button class="btn small" data-no="${u.id}">Afvis</button></div>`
    : `<select data-uid="${u.id}">${ROLES.filter((r) => r !== 'afventer').map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_L[r]}</option>`).join('')}</select>`}
  </div>`;
  const grp = (title, list) => (list.length ? `<section class="card"><h2>${title}</h2>${list.map(urow).join('')}</section>` : '');
  el.innerHTML = grp('Venter på godkendelse', all.filter((u) => u.role === 'afventer')) +
    grp('Aktive brugere', all.filter((u) => u.role === 'chef' || u.role === 'medarbejder')) +
    grp('Deaktiverede', all.filter((u) => u.role === 'deaktiveret'));
  const setRole = (uid, role) => bg(updateDoc(doc(db, 'users', uid), { role }));
  el.querySelectorAll('[data-ok]').forEach((b) => { b.onclick = () => { setRole(b.dataset.ok, 'medarbejder'); toast('Godkendt'); }; });
  el.querySelectorAll('[data-no]').forEach((b) => { b.onclick = () => setRole(b.dataset.no, 'deaktiveret'); });
  el.querySelectorAll('select[data-uid]').forEach((s) => {
    s.onchange = async () => {
      if (s.dataset.uid === me() && s.value !== 'chef' && !(await ask('Du fjerner dine egne chef-rettigheder. Er du sikker?', 'Ja', true))) {
        s.value = 'chef'; return;
      }
      setRole(s.dataset.uid, s.value);
    };
  });
}

// ------------------------------------------------------------------ billedvisning

function openLightbox(urls, i) {
  S.lb = { urls, i };
  drawLb();
  $('lightbox').hidden = false;
  history.pushState({ lb: 1 }, '');
}
function drawLb() {
  const { urls, i } = S.lb, lb = $('lightbox');
  lb.innerHTML = `<img src="${esc(urls[i])}" alt="">
    <div class="lbbar">
      <button data-lb="prev" ${i === 0 ? 'disabled' : ''}>‹</button>
      <span>${i + 1} / ${urls.length}</span>
      <a href="${esc(urls[i])}" target="_blank" rel="noopener">Åbn stort</a>
      <button data-lb="next" ${i === urls.length - 1 ? 'disabled' : ''}>›</button>
      <button data-lb="close">✕</button>
    </div>`;
  lb.querySelectorAll('[data-lb]').forEach((b) => { b.onclick = () => lbAct(b.dataset.lb); });
}
function lbAct(a) {
  if (a === 'close') { closeLb(false); return; }
  const n = S.lb.i + (a === 'next' ? 1 : -1);
  if (n >= 0 && n < S.lb.urls.length) { S.lb.i = n; drawLb(); }
}
function closeLb(fromPop) { $('lightbox').hidden = true; $('lightbox').innerHTML = ''; if (!fromPop) history.back(); }
window.addEventListener('popstate', () => { if (!$('lightbox').hidden) closeLb(true); });
let lbX = null;
$('lightbox').addEventListener('touchstart', (e) => { lbX = e.touches[0].clientX; }, { passive: true });
$('lightbox').addEventListener('touchend', (e) => {
  if (lbX === null) return;
  const dx = e.changedTouches[0].clientX - lbX; lbX = null;
  if (Math.abs(dx) > 60) lbAct(dx < 0 ? 'next' : 'prev');
});

// ------------------------------------------------------------------ upload-kø (virker også uden net)

const mem = new Map();
let idbP = null;
function idb() {
  if (!idbP) {
    idbP = new Promise((res, rej) => {
      const r = indexedDB.open('opgaver-upload', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('q', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch(() => null);
  }
  return idbP;
}
async function qTx(mode, fn) {
  const d = await idb();
  if (!d) return fn(null);
  return new Promise((res, rej) => {
    const tx = d.transaction('q', mode), st = tx.objectStore('q');
    const r = fn(st);
    tx.oncomplete = () => res(r && r.result);
    tx.onerror = () => rej(tx.error);
  });
}
const qPut = (it) => qTx('readwrite', (st) => (st ? st.put(it) : mem.set(it.id, it)));
const qDel = (id) => qTx('readwrite', (st) => (st ? st.delete(id) : mem.delete(id)));
const qAll = () => qTx('readonly', (st) => (st ? st.getAll() : [...mem.values()]))
  .then((a) => (a || []).filter((x) => !S.user || x.by === S.user.uid).sort((x, y) => x.at - y.at));

function safeName(n) { return (n || 'fil').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80); }

function loadImg(file) {
  return new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file);
  });
}
async function compress(file, max) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return file;
  try {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = await loadImg(file); }
    const w = src.width, h = src.height, s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || (s === 1 && blob.size >= file.size)) return file;
    return new File([blob], (file.name || 'billede').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (e) { return file; }
}

async function enqueue({ taskId, logId = null, file, category }) {
  const blob = await compress(file, category === 'tegning' || category === 'ler' ? 2600 : 1600);
  await qPut({
    id: rid(), taskId, logId, blob, name: blob.name || file.name || 'fil', type: blob.type || file.type || 'application/octet-stream',
    size: blob.size, category, by: me(), byName: myName(), at: Date.now(),
  });
  await refreshQueue();
}

async function refreshQueue() {
  const items = await qAll().catch(() => []);
  S.queue = items.map(({ blob, ...rest }) => rest);
  updateQueueBar();
}
function updateQueueBar() {
  const n = (S.queue || []).length, el = $('queue');
  el.hidden = !n || !S.started;
  if (n) el.textContent = navigator.onLine ? `⏳ Uploader ${n} fil${n === 1 ? '' : 'er'}…` : `⏳ ${n} fil${n === 1 ? '' : 'er'} venter på internet`;
}

let qBusy = false;
async function processQueue() {
  if (!S.started) return;
  await refreshQueue();
  if (qBusy || !navigator.onLine) return;
  qBusy = true;
  try {
    for (const it of await qAll()) {
      try {
        const path = `tasks/${it.taskId}/${it.id}-${safeName(it.name)}`, r = ref(storage, path);
        await uploadBytes(r, it.blob, { contentType: it.type });
        const url = await getDownloadURL(r);
        const meta = { id: it.id, name: it.name, type: it.type, size: it.size, url, path, category: it.category, by: it.by, byName: it.byName, at: it.at };
        // Firestore gemmer selv ændringen, indtil den er sendt – derfor ventes der ikke.
        if (it.logId) bg(updateDoc(doc(db, 'tasks', it.taskId, 'log', it.logId), { files: arrayUnion(meta), pending: increment(-1) }), 'Kunne ikke gemme billede');
        else bg(updateDoc(doc(db, 'tasks', it.taskId), { files: arrayUnion(meta), updatedAt: Date.now(), lastBy: it.by }), 'Kunne ikke gemme fil');
        await qDel(it.id);
        await refreshQueue();
        if (S.view === 'opgave') renderDetailTop();
      } catch (e) {
        console.warn('upload fejlede', e);
        if (e.code === 'storage/unauthorized') toast('Upload afvist – har du adgang? Kontakt chefen.', 5000);
        break; // prøv igen senere
      }
    }
  } finally {
    qBusy = false;
    await refreshQueue();
  }
}
setInterval(processQueue, 60000);
