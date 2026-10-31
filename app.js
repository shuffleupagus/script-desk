/* Jack's Script Desk: a mastery-path study app for learning a role.
   All script text comes from the actor's own PDF, parsed on this device. */
(() => {
'use strict';

// ======================= storage =======================
const KEY_STATE = 'jsd-state-v1';
const KEY_SCRIPT = 'jsd-script-v1';
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Could not save progress on this device.'); } };

const defaultState = () => ({
  name: '', role: '', xp: 0, streak: { count: 0, last: null, best: 0 }, days: {},
  lessons: {}, challenges: {}, items: {}, badges: [],
  settings: { speakCues: true, rate: 1, sound: true, unlockAll: false, includeGroup: false, mic: true, goal: 60, theme: 'auto' },
});
let S = Object.assign(defaultState(), load(KEY_STATE, {}));
S.settings = Object.assign(defaultState().settings, S.settings || {});
let SCRIPT = load(KEY_SCRIPT, null); // {title, entries, importedAt}
const persist = () => save(KEY_STATE, S);

// ======================= utils =======================
const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const todayStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayDiff = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
const words = t => t.split(/\s+/).filter(Boolean);
const titleCase = s => s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/\bJr\b/g, 'JR');
const prettyWho = w => titleCase(w || '');
function normWord(w) {
  let o = w.toLowerCase().replace(/[’']/g, "'");
  const gDrop = /in'$/.test(o.replace(/[^a-z']/g, ''));
  o = o.replace(/[^a-z0-9]/g, '');
  if (gDrop) o += 'g';
  const map = { em: 'them', ya: 'you', yer: 'your', cuz: 'because', cause: 'because', til: 'till', until: 'till', ok: 'okay' };
  return map[o] || o;
}
const STOP = new Set('a an the and or but of to in on at is it i you me my we us he she they them his her its be am are was were do did does for with that this so as if not no yes oh hey up out all just got get'.split(' '));
function firstLetters(t) {
  return words(t).map(w => {
    const m = w.match(/^([^A-Za-z0-9]*)([A-Za-z0-9])[A-Za-z0-9'’-]*([^A-Za-z0-9]*)$/);
    return m ? m[1] + m[2] + m[3] : w;
  }).join(' ');
}
function lcsMatch(target, heard) {
  const T = words(target).map(normWord).filter(Boolean), H = words(heard).map(normWord).filter(Boolean);
  const dp = Array.from({ length: T.length + 1 }, () => new Array(H.length + 1).fill(0));
  for (let i = 1; i <= T.length; i++) for (let j = 1; j <= H.length; j++) dp[i][j] = T[i - 1] === H[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const hit = new Array(T.length).fill(false);
  let i = T.length, j = H.length;
  while (i > 0 && j > 0) { if (T[i - 1] === H[j - 1]) { hit[i - 1] = true; i--; j--; } else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--; }
  return { score: T.length ? dp[T.length][H.length] / T.length : 0, hit };
}
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}

// ======================= sound & speech =======================
let actx = null;
function tone(freqs, dur = 0.12, type = 'sine', vol = 0.12) {
  if (!S.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    let t = actx.currentTime;
    freqs.forEach(f => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur); t += dur * 0.8;
    });
  } catch (e) { /* audio unavailable */ }
}
const sfx = {
  ok: () => tone([660, 880], 0.1, 'triangle'),
  bad: () => tone([220, 180], 0.14, 'sawtooth', 0.06),
  tap: () => tone([520], 0.04, 'triangle', 0.05),
  win: () => tone([523, 659, 784, 1047], 0.14, 'triangle', 0.14),
};
const synth = window.speechSynthesis;
let voices = [];
function loadVoices() { voices = synth ? synth.getVoices().filter(v => /^en/i.test(v.lang)) : []; }
if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function speak(text, who, onend) {
  if (!synth) { onend && onend(); return; }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\.\.\./g, ', '));
  const h = hash(who || 'x');
  if (voices.length) u.voice = voices[h % voices.length];
  u.pitch = who && S.role && who.includes(S.role) ? 1 : 0.85 + (h % 7) * 0.08;
  u.rate = S.settings.rate * (who && /ALL|NEWSIES|GROUP/.test(who) ? 1.05 : 1);
  let done = false;
  const fin = () => { if (!done) { done = true; onend && onend(); } };
  u.onend = fin; u.onerror = fin;
  synth.speak(u);
  // Safety net: some mobile browsers never fire onend.
  setTimeout(fin, 1500 + text.length * 90 / S.settings.rate);
}
const stopSpeech = () => { if (synth) synth.cancel(); };

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const micAvailable = () => !!SR && S.settings.mic;
function listen(onInterim) {
  return new Promise((resolve) => {
    const r = new SR();
    r.lang = 'en-US'; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
    let finalText = '', interim = '', silence = null, ended = false;
    const finish = () => { if (ended) return; ended = true; try { r.stop(); } catch (e) {} resolve((finalText + ' ' + interim).trim()); };
    r.onresult = ev => {
      interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalText += ' ' + ev.results[i][0].transcript; else interim += ev.results[i][0].transcript;
      }
      onInterim && onInterim((finalText + ' ' + interim).trim());
      clearTimeout(silence); silence = setTimeout(finish, 1800);
    };
    r.onerror = () => finish();
    r.onend = () => finish();
    listen.stop = finish;
    try { r.start(); } catch (e) { finish(); }
    setTimeout(finish, 30000);
  });
}

// ======================= script model =======================
let MODEL = null; // {units, sections, items, byId}
function roleIn(who) {
  if (!who || !S.role) return false;
  const parts = who.split(/\s*,\s*/);
  if (parts.includes(S.role)) return true;
  if (S.settings.includeGroup && parts.some(p => /^(ALL|ALL NEWSIES|NEWSIES|EVERYONE|COMPANY|FULL COMPANY)$/.test(p))) return true;
  return false;
}
function splitLong(text) {
  const ws = words(text);
  if (ws.length <= 30) return [text];
  const sents = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
  const out = []; let cur = '';
  for (const s of sents) {
    if (cur && words(cur + ' ' + s).length > 24) { out.push(cur.trim()); cur = s; } else cur += ' ' + s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function buildModel() {
  if (!SCRIPT) { MODEL = null; return; }
  const units = []; let scene = 'Opening', song = null, unit = null;
  const newUnit = () => { unit = { id: 'u' + units.length, scene, song, title: song || scene, kind: song ? 'song' : 'scene', entries: [], items: [], lessons: [] }; units.push(unit); };
  newUnit();
  for (const e of SCRIPT.entries) {
    if (e.t === 'scene') { scene = titleCase(e.title); song = null; newUnit(); continue; }
    if (e.t === 'song') { song = e.title; newUnit(); continue; }
    if (e.t === 'endsong') { song = null; newUnit(); continue; }
    unit.entries.push(e);
  }
  const all = units.filter(u => u.entries.some(e => e.t === 'line'));
  // Items: every line of the role, with the line before it as the cue.
  const items = []; let prevLine = null, prevDir = null, lastScene = null;
  for (const u of all) {
    if (u.scene !== lastScene) { prevLine = null; prevDir = null; lastScene = u.scene; }
    u.entries.forEach((e, ei) => {
      if (e.t === 'dir') { prevDir = e.text; return; }
      if (e.t !== 'line') return;
      if (roleIn(e.who)) {
        const parts = e.sung ? [e.text] : splitLong(e.text);
        parts.forEach((p, k) => {
          const it = {
            id: `${u.id}-${ei}-${k}`, unitId: u.id, entryIndex: ei, part: k, parts: parts.length,
            text: p, who: e.who, sung: !!e.sung, paren: k === 0 ? e.paren : '', page: e.page,
            cue: k === 0 ? (prevLine ? { who: prevLine.who, text: prevLine.text, mine: roleIn(prevLine.who), sung: prevLine.sung } : null) : { who: e.who, text: parts[k - 1], mine: true, cont: true },
            dir: k === 0 ? prevDir : null, shared: e.who !== S.role,
          };
          u.items.push(it); items.push(it);
        });
      }
      prevLine = e; prevDir = null;
    });
  }
  // Lessons: bite-sized groups of lines.
  for (const u of all) {
    let cur = [], wc = 0;
    const max = u.kind === 'song' ? 7 : 5;
    u.items.forEach(it => {
      const n = words(it.text).length;
      if (cur.length && (cur.length >= max || wc + n > 85)) { u.lessons.push(cur); cur = []; wc = 0; }
      cur.push(it); wc += n;
    });
    if (cur.length) u.lessons.push(cur);
    u.lessons = u.lessons.map((its, k) => ({ id: `${u.id}-L${k}`, unitId: u.id, n: k, items: its }));
  }
  // Sections by scene for the path.
  const sections = [];
  for (const u of all) {
    let s = sections[sections.length - 1];
    if (!s || s.scene !== u.scene) { s = { scene: u.scene, units: [] }; sections.push(s); }
    s.units.push(u);
  }
  const byId = {}; items.forEach(i => { byId[i.id] = i; });
  MODEL = { units: all, sections, items, byId, unitById: Object.fromEntries(all.map(u => [u.id, u])) };
}

// Ordered list of path nodes (lessons + one scene-run challenge per unit).
function pathNodes() {
  const nodes = [];
  MODEL.units.forEach(u => {
    if (!u.lessons.length) return;
    u.lessons.forEach(l => nodes.push({ type: 'lesson', id: l.id, unit: u, lesson: l }));
    nodes.push({ type: 'challenge', id: u.id + '-C', unit: u });
  });
  return nodes;
}
const nodeDone = n => n.type === 'lesson' ? (S.lessons[n.id] && S.lessons[n.id].stars > 0) : (S.challenges[n.unit.id] && S.challenges[n.unit.id].passed);
function nodeStatus(nodes) {
  let foundCurrent = false;
  return nodes.map(n => {
    const done = nodeDone(n);
    let st;
    if (done) st = 'done';
    else if (!foundCurrent) { st = 'current'; foundCurrent = true; }
    else st = S.settings.unlockAll ? 'open' : 'locked';
    return st;
  });
}

// ======================= progress =======================
function addXP(n) {
  n = Math.max(0, Math.round(n));
  S.xp += n;
  const t = todayStr();
  S.days[t] = (S.days[t] || 0) + n;
  if (S.streak.last !== t) {
    const gap = S.streak.last ? dayDiff(S.streak.last, t) : 99;
    S.streak.count = gap === 1 ? S.streak.count + 1 : 1;
    S.streak.last = t;
    S.streak.best = Math.max(S.streak.best || 0, S.streak.count);
  }
  persist();
}
function streakAlive() { return S.streak.last && dayDiff(S.streak.last, todayStr()) <= 1 ? S.streak.count : 0; }
const INTERVALS = [0, 1, 2, 4, 7, 14, 30];
function gradeItem(id, g) { // g: 0 missed, 1 almost, 2 nailed
  const r = S.items[id] || { box: 0, due: todayStr(), reps: 0, lapses: 0 };
  if (g === 2) r.box = Math.min(6, r.box + 1); else if (g === 0) { r.box = 0; r.lapses++; } else r.box = Math.max(1, r.box);
  r.reps++; r.last = todayStr();
  const d = new Date(); d.setDate(d.getDate() + (g === 0 ? 0 : INTERVALS[r.box]));
  r.due = todayStr(d);
  S.items[id] = r;
}
function dueItems() {
  const t = todayStr();
  return MODEL.items.filter(it => S.items[it.id] && S.items[it.id].due <= t);
}
const mastered = () => MODEL.items.filter(it => S.items[it.id] && S.items[it.id].box >= 3).length;
const RANKS = [[0, 'Newsie'], [250, 'Pape Hawker'], [700, 'Bundle Boss'], [1500, 'Strike Leader'], [3000, 'Headliner'], [6000, 'King of New York']];
const rankOf = xp => { let r = RANKS[0]; RANKS.forEach(x => { if (xp >= x[0]) r = x; }); const nx = RANKS[RANKS.indexOf(r) + 1]; return { name: r[1], next: nx }; };
const BADGES = [
  { id: 'first', ico: '📰', name: 'First Edition', desc: 'Finish your first lesson', test: () => Object.keys(S.lessons).length >= 1 },
  { id: 'perfect', ico: '⭐', name: 'Front Page', desc: 'Three stars on a lesson', test: () => Object.values(S.lessons).some(l => l.stars === 3) },
  { id: 'run', ico: '🎭', name: 'Scene Stealer', desc: 'Pass a Scene Run', test: () => Object.values(S.challenges).some(c => c.passed) },
  { id: 'song', ico: '🎵', name: 'Carrying the Banner', desc: 'Pass a song\'s Scene Run', test: () => Object.entries(S.challenges).some(([u, c]) => c.passed && MODEL.unitById[u] && MODEL.unitById[u].kind === 'song') },
  { id: 'ten', ico: '🧢', name: 'Strike!', desc: 'Finish 10 lessons', test: () => Object.values(S.lessons).filter(l => l.stars).length >= 10 },
  { id: 'streak3', ico: '🔥', name: 'Seize the Day', desc: '3-day streak', test: () => (S.streak.best || 0) >= 3 },
  { id: 'streak7', ico: '🗓️', name: 'Watch What Happens', desc: '7-day streak', test: () => (S.streak.best || 0) >= 7 },
  { id: 'lines50', ico: '🧠', name: 'Steel Trap', desc: 'Master 50 lines', test: () => mastered() >= 50 },
  { id: 'half', ico: '🌄', name: 'Santa Fe Bound', desc: 'Half the path complete', test: () => { const n = pathNodes(); return n.filter(nodeDone).length >= n.length / 2; } },
  { id: 'xp1000', ico: '💰', name: 'Headliner', desc: 'Sell 1,000 papes', test: () => S.xp >= 1000 },
  { id: 'all', ico: '👑', name: 'King of New York', desc: 'Finish every lesson', test: () => MODEL.units.every(u => u.lessons.every(l => S.lessons[l.id] && S.lessons[l.id].stars)) },
  { id: 'opening', ico: '🌟', name: 'Opening Night', desc: 'Pass every Scene Run', test: () => MODEL.units.filter(u => u.lessons.length).every(u => S.challenges[u.id] && S.challenges[u.id].passed) },
];
function checkBadges() {
  const fresh = [];
  BADGES.forEach(b => { if (!S.badges.includes(b.id) && b.test()) { S.badges.push(b.id); fresh.push(b); } });
  if (fresh.length) persist();
  return fresh;
}

// ======================= confetti =======================
function confetti(n = 70) {
  const colors = ['#c4202f', '#e3a514', '#2f8a4a', '#2a5d9f', '#1d1a16', '#fffaf0'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.8 + Math.random() * 1.6 + 's';
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4000);
  }
}

// ======================= app shell =======================
let tab = 'path';
const app = $('#app');
function render() {
  applyTheme();
  if (!SCRIPT || !MODEL) return renderWelcome();
  if (!S.role) return renderRolePick();
  if (!S.name) return renderName();
  const due = dueItems().length;
  const rk = rankOf(S.xp);
  app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="masthead"><h1>${esc(roleTitle())}'s Script Desk</h1><span class="edition">${esc(rk.name)} Edition</span></div>
      <div class="stats">
        <div class="stat" title="Day streak"><span class="ico">🔥</span>${streakAlive()}<small>day${streakAlive() === 1 ? '' : 's'}</small></div>
        <div class="stat" title="Papes sold (points)"><span class="ico">📰</span>${S.xp.toLocaleString()}</div>
        <div class="stat" title="Lines mastered"><span class="ico">🧠</span>${mastered()}<small>/${MODEL.items.length}</small></div>
      </div>
    </header>
    <main class="main" id="main"></main>
    <nav class="tabbar"><div class="tabbar-inner">
      ${[['path', '🗺️', 'Path'], ['review', '🔁', 'Review'], ['rehearse', '🎭', 'Rehearse'], ['script', '📜', 'Script'], ['me', '🧢', 'Me']].map(([k, i, l]) =>
        `<button class="tab ${tab === k ? 'on' : ''}" data-tab="${k}"><span class="ti">${i}</span>${l}${k === 'review' && due ? `<span class="badge">${due}</span>` : ''}</button>`).join('')}
    </div></nav>
  </div>`;
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; sfx.tap(); render(); window.scrollTo(0, 0); });
  ({ path: renderPath, review: renderReview, rehearse: renderRehearse, script: renderScript, me: renderMe })[tab]($('#main'));
}
const roleTitle = () => titleCase(S.role || 'Actor').split(' ')[0];

// ---------- welcome / import ----------
function renderWelcome(msg) {
  app.innerHTML = `
  <div class="welcome">
    <div class="extra">EXTRA! EXTRA!</div>
    <h1>Script Desk</h1>
    <div class="paper">
      <p style="margin:0 0 8px;font-weight:800">Learn every line, one headline at a time.</p>
      <ol class="howto">
        <li>Load your actor's script (the PDF from the theater).</li>
        <li>Pick your role.</li>
        <li>Work down the path: hear it, build it, fill it, say it.</li>
      </ol>
      <p style="margin:12px 0 0;font-size:13px;color:var(--ink-3)">The script stays on this device. Nothing is uploaded.</p>
    </div>
    <label class="btn primary block" for="pdfIn">📄 Load script PDF</label>
    <input id="pdfIn" type="file" accept="application/pdf,.pdf" class="hidden">
    <div id="importStatus" style="margin-top:16px;font-weight:800;min-height:24px">${msg ? esc(msg) : ''}</div>
  </div>`;
  $('#pdfIn').onchange = e => { const f = e.target.files[0]; if (f) f.arrayBuffer().then(importPDF); };
}
let pdfjsReady = null;
function ensurePdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsReady) return pdfjsReady;
  pdfjsReady = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; res(window.pdfjsLib); };
    s.onerror = () => rej(new Error('Could not load the PDF reader. Check your internet connection for this one-time step.'));
    document.head.appendChild(s);
  });
  return pdfjsReady;
}
async function importPDF(buf) {
  const status = $('#importStatus');
  const set = t => { if (status) status.innerHTML = t; };
  try {
    set('Warming up the presses…');
    const lib = await ensurePdfJs();
    const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages = await ScriptParser.extractPages(pdf, (n, tot) => set(`Reading page ${n} of ${tot}… <div class="hero" style="padding:0;border:0;box-shadow:none;background:none"><div class="goalbar" style="flex:1"><i style="width:${(n / tot * 100).toFixed(0)}%"></i></div></div>`));
    set('Sorting the headlines…');
    const parsed = ScriptParser.parse(pages);
    const lines = parsed.entries.filter(e => e.t === 'line').length;
    if (lines < 20) throw new Error("That PDF doesn't look like an actor's script I can read.");
    SCRIPT = { entries: parsed.entries, importedAt: Date.now(), pages: pdf.numPages };
    save(KEY_SCRIPT, SCRIPT);
    S.role = '';
    persist();
    buildModel();
    render();
  } catch (err) {
    console.error(err);
    renderWelcome(err.message || 'Something went wrong reading that file.');
  }
}
window.__importPDF = importPDF; // used by the self-test harness

function renderRolePick() {
  const counts = ScriptParser.speakers(SCRIPT.entries).filter(([w]) => !/^(ALL|NEWSIES|ALL NEWSIES|GROUP|EVERYONE)/.test(w) && !/GROUP/.test(w)).slice(0, 24);
  app.innerHTML = `
  <div class="welcome" style="justify-content:flex-start;padding-top:40px">
    <div class="extra">CASTING CALL</div>
    <h1 style="font-size:38px">Who are you playing?</h1>
    <p style="color:var(--ink-3);font-weight:700;margin-top:0">Found ${SCRIPT.entries.filter(e => e.t === 'line').length} lines in your script.</p>
    <div style="text-align:left">
      ${counts.map(([w, n]) => `<button class="list-item" data-role="${esc(w)}"><span class="li-ico">${w === 'JACK' ? '🧢' : '🎭'}</span><span class="grow"><b>${esc(prettyWho(w))}</b><small>${n} lines</small></span><span>›</span></button>`).join('')}
    </div>
  </div>`;
  app.querySelectorAll('[data-role]').forEach(b => b.onclick = () => { S.role = b.dataset.role; persist(); buildModel(); render(); });
}
function renderName() {
  app.innerHTML = `
  <div class="welcome">
    <div class="extra">NOW STARRING</div>
    <h1 style="font-size:40px">What's your name, ${esc(roleTitle())}?</h1>
    <input id="nm" type="text" autocomplete="given-name" placeholder="Your first name">
    <button class="btn primary block" id="go">Let's go!</button>
  </div>`;
  $('#go').onclick = () => { S.name = ($('#nm').value || '').trim() || 'Star'; persist(); render(); };
}

// ---------- path ----------
function renderPath(main) {
  const nodes = pathNodes();
  const status = nodeStatus(nodes);
  const doneCount = status.filter(s => s === 'done').length;
  const pct = nodes.length ? doneCount / nodes.length : 0;
  const todayXP = S.days[todayStr()] || 0;
  const goal = S.settings.goal;
  const due = dueItems().length;
  const greet = (() => { const h = new Date().getHours(); return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; })();
  let html = `
    <div class="hero">
      <div class="ring">${ring(pct, 64, `${Math.round(pct * 100)}%`)}</div>
      <div style="flex:1;min-width:0">
        <h2>${greet}, ${esc(S.name)}!</h2>
        <p>${doneCount} of ${nodes.length} steps done · Today: ${todayXP}/${goal} papes</p>
        <div class="goalbar"><i style="width:${Math.min(100, todayXP / goal * 100)}%"></i></div>
      </div>
    </div>`;
  if (due) html += `<button class="review-cta" id="revCta"><span class="big">🔁</span><span class="grow"><b>${due} line${due === 1 ? '' : 's'} ready for review</b><span>Keep them fresh. Quick warm-up, about ${Math.max(1, Math.round(due * 0.4))} min.</span></span><span>›</span></button>`;
  let idx = 0, zig = 0, secNo = 0;
  MODEL.sections.forEach(sec => {
    const secUnits = sec.units.filter(u => u.lessons.length);
    if (!secUnits.length) return;
    html += `<div class="section-head"><div class="kicker">${secNo++ === 0 ? 'Curtain up' : 'Next edition'}</div><h3>${esc(sec.scene)}</h3><div class="rule"></div></div>`;
    secUnits.forEach(u => {
      html += `<div class="unit-label ${u.kind}"><span class="pill">${u.kind === 'song' ? '🎵 ' : '💬 '}${esc(u.kind === 'song' ? u.title : 'Dialogue')} · ${u.items.length} line${u.items.length === 1 ? '' : 's'}</span></div><div class="path">`;
      const unitNodes = nodes.filter(n => n.unit === u);
      unitNodes.forEach(n => {
        const st = status[idx]; idx++;
        const off = Math.round(Math.sin(zig++ * 0.9) * 70);
        let icon, label = '', stars = '';
        if (n.type === 'lesson') {
          const rec = S.lessons[n.id];
          icon = st === 'locked' ? '🔒' : st === 'done' ? (rec.stars === 3 ? '🏆' : '✔️') : (u.kind === 'song' ? '🎵' : '📰');
          stars = st === 'done' ? '★'.repeat(rec.stars) + '<span style="opacity:.25">' + '★'.repeat(3 - rec.stars) + '</span>' : '';
          label = `Lesson ${n.lesson.n + 1}`;
        } else {
          const rec = S.challenges[n.unit.id];
          icon = st === 'locked' ? '🔒' : st === 'done' ? '🎭' : '🎬';
          label = 'Scene Run';
          stars = rec && rec.best != null ? `<span style="font-size:12px;font-weight:800">${Math.round(rec.best * 100)}%</span>` : '';
        }
        const cls = ['node', n.type === 'challenge' ? 'challenge' : '', st === 'locked' ? 'locked' : '', st === 'current' ? 'current' : '', st === 'done' ? 'done' : '', st === 'done' && n.type === 'lesson' && S.lessons[n.id].stars === 3 ? 'perfect' : ''].join(' ');
        html += `<div class="node-wrap" style="transform:translateX(${off}px)" ${st === 'current' ? 'id="currentNode"' : ''}>
          ${st === 'current' ? `<div class="start-bubble">${doneCount === 0 ? 'START' : 'NEXT'}</div>` : ''}
          <button class="${cls}" data-node="${n.id}" aria-label="${esc(label)}">${icon}</button>
          <div class="stars">${stars}</div><div class="nlabel">${esc(label)}</div></div>`;
      });
      html += `</div>`;
    });
  });
  html += `<div class="curtain">🎉 Curtain Call<small>Finish the path and you're ready for opening night.</small></div>`;
  main.innerHTML = html;
  const rc = $('#revCta'); if (rc) rc.onclick = () => startReview();
  main.querySelectorAll('[data-node]').forEach(b => b.onclick = () => {
    const i = nodes.findIndex(n => n.id === b.dataset.node);
    const n = nodes[i];
    if (status[i] === 'locked') { sfx.bad(); toast('Finish the steps before this one first. Or unlock everything in Me → Settings.'); return; }
    sfx.tap();
    openNodeSheet(n, status[i]);
  });
  const cur = $('#currentNode');
  if (cur && !renderPath._scrolled) { renderPath._scrolled = true; setTimeout(() => cur.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150); }
}
function ring(p, size, label) {
  const r = size / 2 - 6, c = 2 * Math.PI * r;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--paper-2)" stroke-width="8"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--red)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Nunito" font-weight="900" font-size="${size / 4.4}" fill="var(--ink)">${label}</text></svg>`;
}
function sheet(html, bind) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog">${html}</div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.onclick = e => { if (e.target === back) close(); };
  bind(back, close);
  return close;
}
function openNodeSheet(n, st) {
  const u = n.unit;
  if (n.type === 'lesson') {
    const rec = S.lessons[n.id];
    sheet(`
      <div class="ctx"><span class="chip">${esc(u.scene)}</span>${u.kind === 'song' ? `<span class="chip">🎵 ${esc(u.title)}</span>` : ''}</div>
      <h2>Lesson ${n.lesson.n + 1}: ${n.lesson.items.length} line${n.lesson.items.length === 1 ? '' : 's'}</h2>
      <p>${rec ? `Best: ${'★'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)} · Play again to polish it.` : 'Hear it → Build it → Fill it → Say it. About 5 minutes.'}</p>
      <ul class="lesson-lines">${n.lesson.items.map(it => `<li>“${esc(it.text.length > 70 ? it.text.slice(0, 68) + '…' : it.text)}”</li>`).join('')}</ul>
      <div class="btns"><button class="btn primary block" id="goL">${rec ? 'Practice again' : 'Start lesson'}</button><button class="linkbtn" id="runU">🎭 Rehearse this ${u.kind === 'song' ? 'song' : 'scene'} instead</button></div>`,
      (el, close) => { el.querySelector('#goL').onclick = () => { close(); startLesson(n.lesson); }; el.querySelector('#runU').onclick = () => { close(); startRun(u, { mode: 'cue' }); }; });
  } else {
    const rec = S.challenges[u.id];
    sheet(`
      <div class="ctx"><span class="chip">${esc(u.scene)}</span>${u.kind === 'song' ? `<span class="chip">🎵 ${esc(u.title)}</span>` : ''}</div>
      <h2>🎬 Scene Run</h2>
      <p>Run the whole ${u.kind === 'song' ? 'song' : 'scene'} from the top. Your scene partners read their lines; you say yours from memory. Score 80% to pass.${rec && rec.best != null ? ` Best so far: <b>${Math.round(rec.best * 100)}%</b>.` : ''}</p>
      <div class="btns"><button class="btn go block" id="goC">Places, please!</button></div>`,
      (el, close) => { el.querySelector('#goC').onclick = () => { close(); startRun(u, { mode: 'challenge' }); }; });
  }
}

// ======================= lesson engine =======================
// Steps: meet → build → fill → hint → recall. Misses get re-queued at the end.
function startLesson(lesson) {
  const its = lesson.items;
  const steps = [];
  its.forEach(it => steps.push({ type: 'meet', it }));
  shuffle(its).forEach(it => steps.push({ type: 'build', it }));
  shuffle(its).forEach(it => steps.push({ type: 'fill', it }));
  its.forEach(it => steps.push({ type: 'hint', it }));
  its.forEach(it => steps.push({ type: 'recall', it }));
  runSession({
    title: 'Lesson', steps,
    onFinish: (res) => {
      const acc = res.max ? res.got / res.max : 1;
      const stars = acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : 1;
      const prev = S.lessons[lesson.id];
      const better = !prev || stars > prev.stars;
      S.lessons[lesson.id] = { stars: Math.max(stars, prev ? prev.stars : 0), best: Math.max(acc, prev ? prev.best : 0), plays: (prev ? prev.plays : 0) + 1, last: todayStr() };
      const bonus = 10 + stars * 5;
      addXP(res.xp + bonus);
      showResults({ stars, acc, xp: res.xp + bonus, better, headline: headlineFor(stars), sub: `Lesson ${lesson.n + 1} · ${MODEL.unitById[lesson.unitId].title}` });
    },
  });
}
function startReview() {
  let list = dueItems();
  if (!list.length) {
    // Nothing due: practice the weakest lines seen so far.
    list = MODEL.items.filter(it => S.items[it.id]).sort((a, b) => S.items[a.id].box - S.items[b.id].box).slice(0, 10);
  }
  list = shuffle(list).slice(0, 12);
  if (!list.length) { toast('Finish a lesson first. Then your lines show up here for review.'); return; }
  const steps = list.map(it => ({ type: (S.items[it.id] && S.items[it.id].box >= 2) ? 'recall' : 'hint', it }));
  runSession({
    title: 'Review', steps,
    onFinish: res => {
      const acc = res.max ? res.got / res.max : 1;
      addXP(res.xp + 5);
      showResults({ stars: acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : 1, acc, xp: res.xp + 5, headline: 'Lines Stay Sharp!', sub: `Reviewed ${list.length} line${list.length === 1 ? '' : 's'}` });
    },
  });
}
function headlineFor(stars) {
  return stars === 3 ? ['Kid Nails It!', 'Flawless! Front Page!', 'Stop the Presses!'][Math.floor(Math.random() * 3)]
    : stars === 2 ? ['Solid Edition!', 'Papes Are Movin\'!', 'Strong Showing!'][Math.floor(Math.random() * 3)]
    : ['Rough Draft Filed', 'Back to the Presses', 'Rehearsal Makes Perfect'][Math.floor(Math.random() * 3)];
}

let session = null;
function runSession(cfg) {
  session = { cfg, steps: cfg.steps.slice(), i: 0, got: 0, max: 0, xp: 0, requeued: new Set(), total: cfg.steps.length };
  const el = document.createElement('div');
  el.className = 'stage'; el.id = 'stage';
  el.innerHTML = `<div class="stage-top"><button class="iconbtn" id="quit" aria-label="Quit">✕</button><div class="progress"><i id="prog" style="width:0%"></i></div></div>
    <div class="stage-body" id="sbody"></div><div class="stage-foot" id="sfoot"></div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  $('#quit').onclick = () => {
    if (session.i > 0 && !confirm('Quit this lesson? Progress in this lesson will be lost.')) return;
    endSession();
  };
  nextStep();
}
function endSession() { stopSpeech(); if (listen.stop) listen.stop(); const st = $('#stage'); if (st) st.remove(); document.body.style.overflow = ''; session = null; render(); }
function score(got, max, xp) { session.got += got; session.max += max; session.xp += xp; }
function nextStep() {
  stopSpeech();
  const s = session;
  if (s.i >= s.steps.length) { const res = { got: s.got, max: s.max, xp: s.xp }; const fin = s.cfg.onFinish; const st = $('#stage'); if (st) st.remove(); document.body.style.overflow = ''; session = null; fin(res); return; }
  $('#prog').style.width = (s.i / s.steps.length * 100) + '%';
  const step = s.steps[s.i];
  const foot = $('#sfoot'); foot.className = 'stage-foot'; foot.innerHTML = '';
  ({ meet: stepMeet, build: stepBuild, fill: stepFill, hint: stepRecall, recall: stepRecall })[step.type](step, $('#sbody'), foot);
  $('#sbody').scrollTop = 0;
}
function advance() { session.i++; nextStep(); }
function requeue(step, type) {
  const key = step.it.id + type;
  if (session.requeued.has(key)) return;
  session.requeued.add(key);
  session.steps.push({ type, it: step.it, retry: true });
}

function ctxHTML(it) {
  const u = MODEL.unitById[it.unitId];
  return `<div class="ctx"><span class="chip">${esc(u.scene)}</span>${it.sung ? '<span class="chip">🎵 ' + esc(u.title) + '</span>' : ''}<span class="chip">p. ${esc(it.page)}</span></div>`;
}
function cueHTML(it, opts = {}) {
  const c = it.cue;
  const dir = it.dir ? `<div class="dir">(${esc(it.dir.length > 160 ? it.dir.slice(0, 158) + '…' : it.dir)})</div>` : '';
  if (!c) return `<div class="cue"><div class="who"><span>Top of the scene</span></div>${dir || '<div class="txt">You start this one!</div>'}</div>`;
  const label = c.cont ? 'You, continuing' : c.mine ? `You${c.who !== S.role ? ' (' + prettyWho(c.who) + ')' : ''}` : prettyWho(c.who);
  const cw = words(c.text);
  const shown = cw.length > 22 ? '…' + cw.slice(-18).join(' ') : c.text;
  return `<div class="cue"><div class="who"><span>${c.sung ? '🎵 ' : ''}Cue · ${esc(label)}</span>${opts.noSpeak ? '' : `<button class="speak" data-speak="cue" aria-label="Hear cue">🔊</button>`}</div><div class="txt">${esc(shown)}</div>${dir}</div>`;
}
function bindSpeak(root, it) {
  root.querySelectorAll('[data-speak]').forEach(b => b.onclick = () => {
    b.classList.add('on');
    const done = () => b.classList.remove('on');
    if (b.dataset.speak === 'cue' && it.cue) speak(it.cue.text, it.cue.who, done); else speak(it.text, S.role, done);
  });
}
function autoCue(it) { if (S.settings.speakCues && it.cue && !it.cue.mine) speak(it.cue.text, it.cue.who); }
const youLabel = it => `${it.sung ? '🎵 ' : ''}You${it.shared ? ' · with ' + esc(prettyWho(it.who.split(/\s*,\s*/).filter(w => w !== S.role).join(', ')) || 'others') : ''}`;

// ----- step: meet -----
function stepMeet(step, body, foot) {
  const it = step.it;
  body.innerHTML = `${ctxHTML(it)}<div class="ex-title">New line!</div><div class="ex-sub">Read it out loud twice. Tap 🔊 to hear it.</div>
    ${cueHTML(it)}
    <div class="myline"><div class="who"><span>${youLabel(it)}</span><button class="speak" data-speak="me" aria-label="Hear line">🔊</button></div>
    ${it.paren ? `<div class="paren">(${esc(it.paren)})</div>` : ''}<div class="txt">${esc(it.text)}</div></div>`;
  bindSpeak(body, it);
  autoCue(it);
  foot.innerHTML = `<button class="btn primary block" id="nx">Got it</button>`;
  $('#nx').onclick = () => { score(0, 0, 1); sfx.tap(); advance(); };
}

// ----- step: build (tap the tiles in order) -----
function stepBuild(step, body, foot) {
  const it = step.it;
  const ws = words(it.text);
  const per = Math.max(1, Math.ceil(ws.length / 10));
  const chunks = [];
  for (let i = 0; i < ws.length; i += per) chunks.push(ws.slice(i, i + per).join(' '));
  let pos = 0, mistakes = 0;
  const order = shuffle(chunks.map((t, i) => ({ t, i })));
  body.innerHTML = `${ctxHTML(it)}<div class="ex-title">Build your line</div><div class="ex-sub">Tap the pieces in order.</div>
    ${cueHTML(it)}<div class="answer-area" id="ans"></div>
    <div class="tiles">${order.map((o, k) => `<button class="tile" data-k="${k}">${esc(o.t)}</button>`).join('')}</div>`;
  bindSpeak(body, it);
  body.querySelectorAll('.tile').forEach(b => b.onclick = () => {
    const o = order[+b.dataset.k];
    if (o.t === chunks[pos]) {
      sfx.tap(); b.classList.add('used');
      $('#ans').insertAdjacentHTML('beforeend', `<span class="placed">${esc(o.t)}</span>`);
      pos++;
      if (pos === chunks.length) {
        const got = mistakes === 0 ? 1 : mistakes === 1 ? 0.7 : 0.4;
        score(got, 1, Math.round(3 * got));
        feedback(foot, mistakes === 0, mistakes === 0 ? pick(['Perfect build!', 'Nice!', 'Clean!']) : `Built with ${mistakes} slip${mistakes === 1 ? '' : 's'}.`, null);
        if (mistakes > 1) requeue(step, 'build');
      }
    } else {
      mistakes++; sfx.bad(); b.classList.remove('wrong'); void b.offsetWidth; b.classList.add('wrong');
    }
  });
}
const pick = a => a[Math.floor(Math.random() * a.length)];
function feedback(foot, ok, msg, answer, onNext) {
  foot.className = 'stage-foot ' + (ok ? 'feedback-ok' : 'feedback-bad');
  foot.innerHTML = `<div class="foot-wrap"><div class="foot-msg ${ok ? 'ok-text' : 'bad-text'}">${ok ? '✅' : '💡'} ${esc(msg)}</div>${answer ? `<div style="margin:-4px 0 10px;font-weight:700">${esc(answer)}</div>` : ''}<button class="btn ${ok ? 'go' : 'primary'} block" id="nx">Continue</button></div>`;
  if (ok) sfx.ok();
  $('#nx').onclick = () => (onNext || advance)();
}

// ----- step: fill the blanks -----
let VOCAB = null;
function vocab() {
  if (VOCAB) return VOCAB;
  const set = new Set();
  MODEL.items.forEach(it => words(it.text).forEach(w => { const c = w.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, ''); if (c.length >= 3 && !STOP.has(c.toLowerCase())) set.add(c.toLowerCase()); }));
  return (VOCAB = [...set]);
}
function stepFill(step, body, foot) {
  const it = step.it;
  const ws = words(it.text);
  const core = ws.map(w => w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, ''));
  const cand = core.map((c, i) => ({ c, i })).filter(o => o.c.length >= 3 && !STOP.has(o.c.toLowerCase()));
  const want = Math.min(4, Math.max(1, Math.round(ws.length / 5)));
  const chosen = [];
  shuffle(cand).sort((a, b) => b.c.length - a.c.length).forEach(o => { if (chosen.length < want && !chosen.some(x => Math.abs(x.i - o.i) < 2)) chosen.push(o); });
  if (!chosen.length) { const o = core.map((c, i) => ({ c, i })).filter(o => o.c.length)[0]; if (o) chosen.push(o); }
  chosen.sort((a, b) => a.i - b.i);
  const blanks = new Map(chosen.map((o, k) => [o.i, k]));
  let cur = 0, mistakes = 0;
  const render1 = () => {
    const html = ws.map((w, i) => {
      if (!blanks.has(i)) return esc(w);
      const k = blanks.get(i), c = core[i];
      const pre = w.slice(0, w.indexOf(c)), post = w.slice(w.indexOf(c) + c.length);
      const cls = k < cur ? 'filled' : k === cur ? 'active' : '';
      return `${esc(pre)}<span class="blank ${cls}">${esc(c)}</span>${esc(post)}`;
    }).join(' ');
    $('#cloze').innerHTML = html;
    if (cur >= chosen.length) return;
    const ans = chosen[cur].c;
    const pool = vocab().filter(v => v !== ans.toLowerCase() && Math.abs(v.length - ans.length) <= 3);
    const others = new Set(); for (const v of shuffle(pool)) { if (others.size >= 3) break; others.add(v); }
    const opts = shuffle([ans, ...[...others].map(v => /^[A-Z]/.test(ans) ? v[0].toUpperCase() + v.slice(1) : v)]);
    $('#opts').innerHTML = opts.map(o => `<button class="btn" data-o="${esc(o)}" style="text-transform:none">${esc(o)}</button>`).join('');
    $('#opts').querySelectorAll('[data-o]').forEach(b => b.onclick = () => {
      if (b.dataset.o === ans) { sfx.tap(); cur++; render1(); if (cur >= chosen.length) done(); }
      else { mistakes++; sfx.bad(); b.disabled = true; b.classList.add('wrong'); }
    });
  };
  const done = () => {
    $('#opts').innerHTML = '';
    const got = mistakes === 0 ? 1 : mistakes === 1 ? 0.7 : 0.4;
    score(got, 1, Math.round(3 * got));
    if (mistakes > 1) requeue(step, 'fill');
    feedback(foot, mistakes === 0, mistakes === 0 ? pick(['Spot on!', 'Every word!', 'Sharp!']) : 'Got there!', null);
  };
  body.innerHTML = `${ctxHTML(it)}<div class="ex-title">Fill the gaps</div><div class="ex-sub">Pick the missing word.</div>
    ${cueHTML(it)}<div class="myline"><div class="who"><span>${youLabel(it)}</span></div><div class="cloze" id="cloze"></div></div><div class="options" id="opts"></div>`;
  bindSpeak(body, it);
  render1();
}

// ----- step: hint (first letters) and recall (cold) -----
function stepRecall(step, body, foot) {
  const it = step.it, hint = step.type === 'hint';
  body.innerHTML = `${ctxHTML(it)}<div class="ex-title">${hint ? 'Say it with a hint' : step.retry ? 'One more try' : 'Your cue, ' + esc(S.name) + '!'}</div>
    <div class="ex-sub">${hint ? 'Only the first letter of each word is shown. Say the whole line out loud.' : 'No peeking. Say your line out loud, then check.'}</div>
    ${cueHTML(it)}
    <div class="myline" id="ml"><div class="who"><span>${youLabel(it)}</span></div>${it.paren ? `<div class="paren">(${esc(it.paren)})</div>` : ''}
      <div class="txt ${hint ? 'hint' : 'mystery'}" id="mt">${hint ? esc(firstLetters(it.text)) : `${words(it.text).length} words… what's your line?`}</div></div>
    <div id="micbox"></div>`;
  bindSpeak(body, it);
  autoCue(it);
  const showGrade = (suggest, heardHTML) => {
    $('#mt').className = 'txt'; $('#mt').textContent = it.text;
    if (heardHTML) $('#micbox').innerHTML = heardHTML;
    foot.innerHTML = `<div class="foot-wrap"><div class="foot-msg">${suggest != null ? (suggest === 2 ? '<span class="ok-text">🎯 Nailed it, by the sound of it!</span>' : suggest === 1 ? '<span>👍 Close! Check the red words.</span>' : '<span class="bad-text">💡 Not quite yet.</span>') : 'How did you do?'}</div>
      <div class="grade-row"><button class="btn small" data-g="0">😬 Missed</button><button class="btn small gold" data-g="1">🤏 Almost</button><button class="btn small go" data-g="2">🎯 Nailed it</button></div></div>`;
    foot.querySelectorAll('[data-g]').forEach(b => {
      if (suggest != null && +b.dataset.g === suggest) b.style.outline = '3px solid var(--blue)';
      b.onclick = () => {
        const g = +b.dataset.g;
        const pts = [0, 0.6, 1][g];
        score(pts, 1, (hint ? 4 : 6) * pts);
        if (!step.retry || g > 0) gradeItem(it.id, hint ? Math.min(g, 1) : g);
        if (g === 2) sfx.ok(); else if (g === 0) sfx.bad();
        if (g === 0) requeue(step, 'hint');
        persist();
        advance();
      };
    });
  };
  const btns = `<div class="foot-wrap" style="display:flex;gap:10px">${micAvailable() ? `<button class="btn blue" id="mic" style="flex:1">🎤 Say it</button>` : ''}<button class="btn primary" id="rev" style="flex:1">👀 Check</button></div>`;
  foot.innerHTML = btns;
  $('#rev').onclick = () => { stopSpeech(); showGrade(null); };
  const mic = $('#mic');
  if (mic) mic.onclick = async () => {
    stopSpeech();
    foot.innerHTML = `<button class="btn block" id="stopmic">⏹ Done talking</button>`;
    $('#micbox').innerHTML = `<div class="mic-live"><span class="mic-dot"></span><span id="heard">Listening… say your line.</span></div>`;
    $('#stopmic').onclick = () => listen.stop && listen.stop();
    const heard = await listen(t => { const h = $('#heard'); if (h) h.textContent = t; });
    if (!session) return;
    if (!heard) { $('#micbox').innerHTML = `<div class="heard">Didn't catch that. Check it yourself instead.</div>`; showGrade(null); return; }
    const m = lcsMatch(it.text, heard);
    const sug = m.score >= 0.88 ? 2 : m.score >= 0.6 ? 1 : 0;
    const wsT = words(it.text);
    let k = 0;
    const diff = wsT.map(w => { const n = normWord(w); if (!n) return esc(w); const ok = m.hit[k++]; return `<span class="${ok ? 'w-ok' : 'w-miss'}">${esc(w)}</span>`; }).join(' ');
    showGrade(sug, `<div class="reveal-diff">${diff}<div class="heard">You said: “${esc(heard)}” · ${Math.round(m.score * 100)}% match</div></div>`);
  };
}

// ----- results -----
function showResults({ stars, acc, xp, headline, sub }) {
  const fresh = checkBadges();
  const el = document.createElement('div');
  el.className = 'stage';
  el.innerHTML = `<div class="stage-body"><div class="results">
    <div class="headline-paper"><div class="extra">★ EXTRA! EXTRA! ★</div><h2>${esc(headline)}</h2><div style="color:var(--ink-3);font-weight:700;font-size:14px">${esc(sub)}</div></div>
    <div class="big-stars">${[0, 1, 2].map(i => `<span data-s="${i}">⭐</span>`).join('')}</div>
    <div class="res-grid"><div class="res-box"><b>${Math.round(acc * 100)}%</b><span>Accuracy</span></div><div class="res-box"><b>+${xp}</b><span>Papes</span></div><div class="res-box"><b>🔥 ${streakAlive()}</b><span>Streak</span></div></div>
    ${fresh.map(b => `<div class="card" style="text-align:left"><div class="row"><span style="font-size:36px">${b.ico}</span><div class="grow"><h3>Badge earned: ${esc(b.name)}</h3><p>${esc(b.desc)}</p></div></div></div>`).join('')}
  </div></div><div class="stage-foot"><button class="btn primary block" id="cont">Continue</button></div>`;
  document.body.appendChild(el);
  stars = stars || 0;
  for (let i = 0; i < stars; i++) setTimeout(() => { const s = el.querySelector(`[data-s="${i}"]`); s && s.classList.add('lit'); tone([600 + i * 150], 0.12, 'triangle'); }, 350 + i * 350);
  setTimeout(() => { sfx.win(); if (stars >= 2 || fresh.length) confetti(stars === 3 ? 110 : 60); }, 350 + stars * 350);
  el.querySelector('#cont').onclick = () => { el.remove(); render(); };
}

// ======================= scene runner =======================
function startRun(u, { mode }) {
  // mode: 'read' (see everything), 'cue' (hide my lines), 'challenge' (graded)
  const seq = [];
  u.entries.forEach((e, ei) => {
    if (e.t === 'dir') seq.push({ k: 'dir', e });
    else if (e.t === 'line') {
      if (roleIn(e.who)) {
        const its = u.items.filter(x => x.entryIndex === ei);
        if (mode === 'challenge' && its.length > 1) its.forEach(it => seq.push({ k: 'mine', e, it, text: it.text }));
        else seq.push({ k: 'mine', e, it: its[0], text: e.text });
      } else seq.push({ k: 'line', e });
    }
  });
  const el = document.createElement('div');
  el.className = 'stage'; el.id = 'runstage';
  el.innerHTML = `<div class="stage-top"><button class="iconbtn" id="rq" aria-label="Close">✕</button>
      <div style="flex:1;min-width:0"><div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.kind === 'song' ? '🎵 ' : ''}${esc(u.title)}</div><div style="font-size:12px;color:var(--ink-3);font-weight:700">${esc(u.kind === 'song' ? u.scene : 'Dialogue')} · ${mode === 'challenge' ? 'Scene Run challenge' : mode === 'read' ? 'Read-through' : 'Cue me'}</div></div>
      <button class="iconbtn" id="rsnd" aria-label="Toggle voices">${S.settings.speakCues ? '🔊' : '🔇'}</button></div>
    <div class="progress" style="flex:none;height:10px;border-width:1.5px;margin:0 auto 8px;max-width:608px;width:calc(100% - 32px)"><i id="rprog" style="width:0%;background:var(--blue)"></i></div>
    <div class="stage-body"><div class="run-feed" id="feed"></div></div><div class="stage-foot" id="rfoot"></div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  let i = 0, got = 0, max = 0, alive = true, paused = false;
  const close = () => { alive = false; stopSpeech(); if (listen.stop) listen.stop(); el.remove(); document.body.style.overflow = ''; render(); };
  el.querySelector('#rq').onclick = close;
  el.querySelector('#rsnd').onclick = e => { S.settings.speakCues = !S.settings.speakCues; persist(); e.target.textContent = S.settings.speakCues ? '🔊' : '🔇'; if (!S.settings.speakCues) stopSpeech(); };
  const feed = el.querySelector('#feed'), foot = el.querySelector('#rfoot');
  const scrollDown = () => { const b = el.querySelector('.stage-body'); b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); };
  const step = () => {
    if (!alive) return;
    el.querySelector('#rprog').style.width = (i / seq.length * 100) + '%';
    if (i >= seq.length) return finish();
    const s = seq[i];
    if (s.k === 'dir') {
      feed.insertAdjacentHTML('beforeend', `<div class="run-dir">(${esc(s.e.text)})</div>`); scrollDown(); i++; setTimeout(step, 250); return;
    }
    if (s.k === 'line') {
      feed.insertAdjacentHTML('beforeend', `<div class="run-line active"><div class="who">${s.e.sung ? '🎵 ' : ''}${esc(prettyWho(s.e.who))}${s.e.paren ? ' · <i>' + esc(s.e.paren) + '</i>' : ''}</div><div class="txt">${esc(s.e.text)}</div></div>`);
      scrollDown();
      const last = feed.lastElementChild;
      foot.innerHTML = `<div class="foot-wrap" style="display:flex;gap:10px"><button class="btn block" id="skip">Next ›</button></div>`;
      let moved = false;
      const go = () => { if (moved) return; moved = true; last.classList.remove('active'); i++; step(); };
      foot.querySelector('#skip').onclick = () => { stopSpeech(); go(); };
      if (S.settings.speakCues) speak(s.e.text, s.e.who, () => setTimeout(go, 250)); else setTimeout(() => {}, 0);
      return;
    }
    // My line
    const showText = mode === 'read';
    feed.insertAdjacentHTML('beforeend', `<div class="run-line mine active"><div class="who">${s.e.sung ? '🎵 ' : ''}YOU${s.e.who !== S.role ? ' · ' + esc(prettyWho(s.e.who)) : ''}${s.e.paren ? ' · <i>' + esc(s.e.paren) + '</i>' : ''}</div><div class="txt">${showText ? esc(s.text) : `<span style="color:var(--ink-3);font-style:italic;font-weight:700">Your line! (${words(s.text).length} words)</span>`}</div></div>`);
    scrollDown();
    const box = feed.lastElementChild;
    tone([880], 0.06, 'triangle', 0.06);
    if (mode === 'read') {
      foot.innerHTML = `<div class="foot-wrap" style="display:flex;gap:10px"><button class="btn" id="hear" style="flex:1">🔊 Hear</button><button class="btn primary" id="nx" style="flex:2">Next ›</button></div>`;
      foot.querySelector('#hear').onclick = () => speak(s.text, S.role);
      foot.querySelector('#nx').onclick = () => { stopSpeech(); box.classList.remove('active'); i++; step(); };
      return;
    }
    const reveal = (sugg, extra) => {
      box.querySelector('.txt').innerHTML = esc(s.text) + (extra || '');
      if (mode === 'challenge') {
        foot.innerHTML = `<div class="foot-wrap"><div class="grade-row"><button class="btn small" data-g="0">😬 Missed</button><button class="btn small gold" data-g="1">🤏 Almost</button><button class="btn small go" data-g="2">🎯 Nailed</button></div></div>`;
        foot.querySelectorAll('[data-g]').forEach(b => {
          if (sugg != null && +b.dataset.g === sugg) b.style.outline = '3px solid var(--blue)';
          b.onclick = () => { const g = +b.dataset.g; got += [0, 0.6, 1][g]; max += 1; if (s.it) gradeItem(s.it.id, g); persist(); box.classList.remove('active'); box.style.borderColor = ['var(--red)', 'var(--gold)', 'var(--green)'][g]; i++; step(); };
        });
      } else {
        foot.innerHTML = `<div class="foot-wrap"><button class="btn primary block" id="nx">Next ›</button></div>`;
        foot.querySelector('#nx').onclick = () => { box.classList.remove('active'); i++; step(); };
      }
      scrollDown();
    };
    foot.innerHTML = `<div class="foot-wrap" style="display:flex;gap:10px">${micAvailable() ? '<button class="btn blue" id="mic" style="flex:1">🎤 Say it</button>' : ''}<button class="btn primary" id="rv" style="flex:1">👀 Show</button></div>`;
    foot.querySelector('#rv').onclick = () => reveal(null);
    const mic = foot.querySelector('#mic');
    if (mic) mic.onclick = async () => {
      foot.innerHTML = `<button class="btn block" id="sm">⏹ Done talking</button>`;
      foot.querySelector('#sm').onclick = () => listen.stop && listen.stop();
      box.querySelector('.txt').innerHTML = `<div class="mic-live" style="margin:0"><span class="mic-dot"></span><span id="rheard">Listening…</span></div>`;
      const heard = await listen(t => { const h = el.querySelector('#rheard'); if (h) h.textContent = t; });
      if (!alive) return;
      const m = lcsMatch(s.text, heard || '');
      reveal(heard ? (m.score >= 0.88 ? 2 : m.score >= 0.6 ? 1 : 0) : null, heard ? `<div class="heard">You said: “${esc(heard)}” · ${Math.round(m.score * 100)}%</div>` : '');
    };
  };
  const finish = () => {
    stopSpeech();
    if (mode === 'challenge') {
      const acc = max ? got / max : 1;
      const passed = acc >= 0.8;
      const prev = S.challenges[u.id] || {};
      S.challenges[u.id] = { passed: passed || !!prev.passed, best: Math.max(acc, prev.best || 0), plays: (prev.plays || 0) + 1 };
      const xp = Math.round(15 + got * 4 + (passed ? 25 : 0));
      addXP(xp);
      el.remove(); document.body.style.overflow = '';
      showResults({ stars: acc >= 0.95 ? 3 : passed ? 2 : 1, acc, xp, headline: passed ? pick(['Bravo! Scene Nailed!', 'Standing Ovation!', 'The World Will Know!']) : 'Almost Show-Ready', sub: `${u.title} · ${passed ? 'Scene Run passed' : 'Need 80% to pass. Run it again!'}` });
    } else {
      foot.innerHTML = `<div class="foot-wrap"><div class="foot-msg ok-text">🎭 End of ${u.kind === 'song' ? 'song' : 'scene'}!</div><div style="display:flex;gap:10px"><button class="btn" id="again" style="flex:1">↺ Again</button><button class="btn primary" id="done" style="flex:1">Done</button></div></div>`;
      addXP(5);
      foot.querySelector('#again').onclick = () => { el.remove(); startRun(u, { mode }); };
      foot.querySelector('#done').onclick = close;
    }
  };
  step();
}

// ======================= tabs =======================
function renderReview(main) {
  const due = dueItems();
  const seen = MODEL.items.filter(it => S.items[it.id]);
  const boxes = [0, 0, 0, 0, 0, 0, 0]; seen.forEach(it => boxes[S.items[it.id].box]++);
  main.innerHTML = `
    <h2 class="page-title">Review Desk</h2>
    <p class="page-sub">Lines come back right before you'd forget them. A few minutes a day beats an hour the night before.</p>
    <div class="card"><div class="row"><span style="font-size:40px">🔁</span><div class="grow"><h3>${due.length ? `${due.length} line${due.length === 1 ? '' : 's'} due today` : 'All caught up!'}</h3><p>${due.length ? 'Up to 12 per round.' : seen.length ? 'Want extra practice? Drill your shakiest lines.' : 'Finish a lesson and lines start showing up here.'}</p></div></div>
      ${seen.length ? `<button class="btn primary block" id="rv" style="margin-top:12px">${due.length ? 'Start review' : 'Drill weak lines'}</button>` : ''}</div>
    <div class="card"><h3>Memory strength</h3><p style="margin-bottom:10px">How well each line you've started is sticking.</p>
      ${[['Shaky', boxes[0] + boxes[1], 'var(--red)'], ['Getting there', boxes[2], 'var(--gold)'], ['Solid', boxes[3] + boxes[4], 'var(--blue)'], ['Locked in', boxes[5] + boxes[6], 'var(--green)'], ['Not started', MODEL.items.length - seen.length, 'var(--lock)']].map(([l, n, c]) =>
        `<div class="row" style="margin:6px 0"><span style="width:110px;font-weight:800;font-size:14px">${l}</span><div class="grow meter" style="height:14px;margin:0"><i style="width:${MODEL.items.length ? n / MODEL.items.length * 100 : 0}%;background:${c}"></i></div><b style="width:36px;text-align:right">${n}</b></div>`).join('')}
    </div>`;
  const b = $('#rv'); if (b) b.onclick = () => startReview();
}
function renderRehearse(main) {
  main.innerHTML = `
    <h2 class="page-title">Rehearsal Room</h2>
    <p class="page-sub">Run any scene with a scene partner. The app reads the other parts out loud and stops on your lines.</p>
    <div class="segmented" id="seg" style="margin-bottom:14px">
      <button data-m="cue" class="${(renderRehearse.mode || 'cue') === 'cue' ? 'on' : ''}">🙈 Cue me</button>
      <button data-m="read" class="${renderRehearse.mode === 'read' ? 'on' : ''}">👀 Read-through</button>
      <button data-m="challenge" class="${renderRehearse.mode === 'challenge' ? 'on' : ''}">🎬 Graded</button>
    </div>
    <div id="ulist"></div>`;
  main.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { renderRehearse.mode = b.dataset.m; renderRehearse(main); });
  const list = $('#ulist');
  let html = '', lastScene = null;
  MODEL.units.forEach(u => {
    if (u.scene !== lastScene) { html += `<div class="sc-head" style="font-size:17px;margin-top:18px">${esc(u.scene)}</div>`; lastScene = u.scene; }
    const n = u.items.length, ch = S.challenges[u.id];
    const learned = u.items.filter(it => S.items[it.id] && S.items[it.id].box >= 3).length;
    html += `<button class="list-item" data-u="${u.id}"><span class="li-ico">${u.kind === 'song' ? '🎵' : '💬'}</span><span class="grow"><b>${esc(u.kind === 'song' ? u.title : 'Dialogue')}</b><small>${n ? `${n} of your lines · ${learned} mastered` : 'You\'re not in this part (listen along)'}</small>${n ? `<div class="meter"><i style="width:${learned / n * 100}%"></i></div>` : ''}</span>${ch && ch.passed ? '<span class="crown">🎭</span>' : ''}<span>›</span></button>`;
  });
  list.innerHTML = html;
  list.querySelectorAll('[data-u]').forEach(b => b.onclick = () => startRun(MODEL.unitById[b.dataset.u], { mode: renderRehearse.mode || 'cue' }));
}
function renderScript(main) {
  const q = renderScript.q || '';
  const cover = !!renderScript.cover;
  main.innerHTML = `
    <h2 class="page-title">The Script</h2>
    <div class="searchbar"><input id="q" type="search" placeholder="Search lines…" value="${esc(q)}"><button class="toggle" id="cov"><span class="switch ${cover ? 'on' : ''}"></span>Hide mine</button></div>
    <div id="sc"></div>`;
  const qq = q.toLowerCase();
  const hi = t => { const s = esc(t); if (!qq) return s; const re = new RegExp('(' + qq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'); return s.replace(re, '<mark>$1</mark>'); };
  let html = '', lastScene = null;
  const show = e => !qq || (e.text && e.text.toLowerCase().includes(qq)) || (e.who && e.who.toLowerCase().includes(qq));
  MODEL.units.forEach(u => {
    const ents = u.entries.filter(show);
    if (!ents.length) return;
    if (u.scene !== lastScene) { html += `<div class="sc-head">${esc(u.scene)}</div>`; lastScene = u.scene; }
    if (u.kind === 'song') html += `<div class="sc-song">🎵 ${esc(u.title)}</div>`;
    ents.forEach(e => {
      if (e.t === 'dir') { if (!qq) html += `<div class="sdir">(${esc(e.text)})</div>`; return; }
      const mine = roleIn(e.who);
      html += `<div class="sl ${mine ? 'mine' : ''} ${mine && cover ? 'covered' : ''} ${e.sung ? 'sung' : ''}"><div class="who">${esc(prettyWho(e.who))}${e.paren ? ' <i style="font-weight:600">(' + esc(e.paren) + ')</i>' : ''} <span style="font-weight:600;opacity:.6">· p.${esc(e.page)}</span></div><div class="txt">${hi(e.text)}</div></div>`;
    });
  });
  $('#sc').innerHTML = html || '<p class="page-sub">No matches.</p>';
  let t;
  $('#q').oninput = e => { clearTimeout(t); t = setTimeout(() => { renderScript.q = e.target.value; const pos = e.target.selectionStart; renderScript(main); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
  $('#cov').onclick = () => { renderScript.cover = !cover; renderScript(main); };
  $('#sc').onclick = e => { const l = e.target.closest('.covered'); if (l) l.classList.remove('covered'); };
}
function renderMe(main) {
  const rk = rankOf(S.xp);
  const days = Object.keys(S.days).length;
  const st = S.settings;
  main.innerHTML = `
    <h2 class="page-title">${esc(S.name)}</h2>
    <p class="page-sub">Playing ${esc(prettyWho(S.role))} · Rank: <b>${esc(rk.name)}</b>${rk.next ? ` · ${rk.next[0] - S.xp} papes to ${esc(rk.next[1])}` : ''}</p>
    <div class="res-grid" style="margin-top:0">
      <div class="res-box"><b>${S.xp.toLocaleString()}</b><span>Papes</span></div>
      <div class="res-box"><b>${S.streak.best || 0}</b><span>Best streak</span></div>
      <div class="res-box"><b>${days}</b><span>Days practiced</span></div>
    </div>
    <h3 class="sc-head" style="margin-top:8px">Badges</h3>
    <div class="badges">${BADGES.map(b => `<div class="badge-card ${S.badges.includes(b.id) ? '' : 'locked'}"><div class="bi">${b.ico}</div><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('')}</div>
    <h3 class="sc-head">Settings</h3>
    <div class="card">
      <div class="setting"><label>Name</label><input type="text" id="sName" value="${esc(S.name)}"></div>
      <div class="setting"><div><label>Read cues out loud</label><small>Scene partners speak their lines</small></div><button class="switch ${st.speakCues ? 'on' : ''}" data-set="speakCues" aria-label="Read cues"></button></div>
      <div class="setting"><div><label>Voice speed</label><small>${st.rate.toFixed(1)}×</small></div><input type="range" min="0.6" max="1.5" step="0.1" value="${st.rate}" id="sRate"></div>
      <div class="setting"><div><label>Microphone check</label><small>${SR ? 'Say lines out loud; the app listens and scores you' : 'Not supported in this browser'}</small></div><button class="switch ${st.mic && SR ? 'on' : ''}" data-set="mic" ${SR ? '' : 'disabled'} aria-label="Microphone"></button></div>
      <div class="setting"><div><label>Sound effects</label></div><button class="switch ${st.sound ? 'on' : ''}" data-set="sound" aria-label="Sound"></button></div>
      <div class="setting"><div><label>Unlock everything</label><small>Jump to any lesson (handy when the director says "Scene 7 by Thursday")</small></div><button class="switch ${st.unlockAll ? 'on' : ''}" data-set="unlockAll" aria-label="Unlock all"></button></div>
      <div class="setting"><div><label>Include group numbers</label><small>Also drill "ALL / NEWSIES" lines</small></div><button class="switch ${st.includeGroup ? 'on' : ''}" data-set="includeGroup" aria-label="Group lines"></button></div>
      <div class="setting"><div><label>Daily goal</label></div><select id="sGoal">${[30, 60, 100, 150].map(g => `<option value="${g}" ${st.goal === g ? 'selected' : ''}>${g} papes</option>`).join('')}</select></div>
      <div class="setting"><div><label>Theme</label></div><select id="sTheme">${[['auto', 'Match device'], ['light', 'Day edition'], ['dark', 'Night edition']].map(([v, l]) => `<option value="${v}" ${st.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <h3 class="sc-head">Script & data</h3>
    <div class="card">
      <div class="setting"><div><label>Change role</label><small>Currently ${esc(prettyWho(S.role))}</small></div><button class="btn small" id="chRole">Change</button></div>
      <div class="setting"><div><label>Load a new script</label><small>Updated PDF from the theater? Progress is kept where lines match.</small></div><label class="btn small" for="pdfIn2">Load</label><input type="file" id="pdfIn2" accept="application/pdf,.pdf" class="hidden"></div>
      <div class="setting"><div><label>Back up progress</label><small>Save a file to move to another device</small></div><button class="btn small" id="exp">Export</button></div>
      <div class="setting"><div><label>Restore progress</label></div><label class="btn small" for="impIn">Import</label><input type="file" id="impIn" accept="application/json,.json" class="hidden"></div>
      <div class="setting"><div><label style="color:var(--red)">Reset all progress</label></div><button class="btn small" id="reset">Reset</button></div>
    </div>
    <p style="text-align:center;color:var(--ink-3);font-size:12px;margin-top:20px">Your script and progress live only on this device.<br>Break a leg! 🎭</p>`;
  main.querySelectorAll('[data-set]').forEach(b => b.onclick = () => { const k = b.dataset.set; st[k] = !st[k]; persist(); if (k === 'includeGroup') { buildModel(); VOCAB = null; } render(); });
  $('#sName').onchange = e => { S.name = e.target.value.trim() || S.name; persist(); render(); };
  $('#sRate').oninput = e => { st.rate = +e.target.value; persist(); e.target.previousElementSibling.querySelector('small').textContent = st.rate.toFixed(1) + '×'; };
  $('#sRate').onchange = () => speak('Extra! Extra! Read all about it!', 'NEWSIES');
  $('#sGoal').onchange = e => { st.goal = +e.target.value; persist(); };
  $('#sTheme').onchange = e => { st.theme = e.target.value; persist(); applyTheme(); };
  $('#chRole').onclick = () => { S.role = ''; persist(); render(); };
  $('#pdfIn2').onchange = e => { const f = e.target.files[0]; if (!f) return; const role = S.role; renderWelcome(); f.arrayBuffer().then(async b => { await importPDF(b); if (role && SCRIPT) { S.role = role; persist(); buildModel(); render(); } }); };
  $('#exp').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'script-desk', v: 1, state: S }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `script-desk-progress-${todayStr()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#impIn').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => { const d = JSON.parse(t); if (!d.state) throw new Error(); S = Object.assign(defaultState(), d.state); persist(); buildModel(); toast('Progress restored!'); render(); }).catch(() => toast('That file is not a Script Desk backup.'));
  };
  $('#reset').onclick = () => { if (confirm('Erase all progress? This cannot be undone.')) { const keep = { name: S.name, role: S.role, settings: S.settings }; S = Object.assign(defaultState(), keep); persist(); render(); } };
}

// ======================= boot =======================
buildModel();
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
window.__app = { get S() { return S; }, get MODEL() { return MODEL; }, get session() { return session; }, render };
})();
