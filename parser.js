/* Script parser: turns a Music Theatre International actor's script PDF
   into structured scenes, songs, lines and stage directions.
   Runs entirely on-device; works in the browser (pdf.js) and in Node for testing. */
(function (root) {
  'use strict';

  // ---------- 1. Pull positioned text items out of the PDF ----------
  async function extractPages(pdf, onProgress) {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      await page.getOperatorList(); // loads fonts so we can read their real names
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (!it.str) continue;
        let font = '';
        try { const f = page.commonObjs.get(it.fontName); font = (f && f.name) || ''; } catch (e) { font = ''; }
        font = font.replace(/^[A-Z]{6}\+/, '');
        const [a, b, , , e, f] = it.transform;
        const size = Math.round(Math.hypot(a, b) * 10) / 10;
        items.push({ s: it.str, x0: e, x1: e + it.width, y: vp.height - f, size, font });
      }
      pages.push({ n, width: vp.width, height: vp.height, items });
      if (onProgress) onProgress(n, pdf.numPages);
    }
    return pages;
  }

  // ---------- helpers ----------
  const clean = s => s
    .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl')
    .replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/ /g, ' ');
  const squash = s => s.replace(/\s+/g, ' ').trim();
  const styleOf = font => /Bold/i.test(font) ? (/It|Oblique/i.test(font) ? 'bi' : 'b') : (/It|Oblique/i.test(font) ? 'i' : 'r');
  const isScriptFont = font => /Palatino|Times/i.test(font);

  // Group items into visual rows (same baseline), sorted left to right.
  function rowsOf(items) {
    const sorted = items.slice().sort((p, q) => p.y - q.y || p.x0 - q.x0);
    const rows = [];
    for (const it of sorted) {
      const r = rows[rows.length - 1];
      if (r && Math.abs(r.y - it.y) < 3 && (r.items[0].size >= 13.5) === (it.size >= 13.5)) r.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    }
    rows.forEach(r => r.items.sort((p, q) => p.x0 - q.x0));
    return rows;
  }

  // Join a row's segments, honouring hyphen items that sit between syllables.
  function joinSyllables(items) {
    const hy = [], sy = [];
    for (const it of items) {
      const t = clean(it.s);
      if (/^\s*-\s*$/.test(t)) hy.push((it.x0 + it.x1) / 2);
      else if (t.trim()) sy.push({ t, x0: it.x0, x1: it.x1 });
    }
    sy.sort((a, b) => a.x0 - b.x0);
    let out = '', lead = false, trail = false;
    if (!sy.length) return { text: '', lead: hy.length > 0, trail: false };
    lead = hy.some(h => h < sy[0].x0);
    trail = hy.some(h => h > sy[sy.length - 1].x1 - 1);
    sy.forEach((s, i) => {
      if (i === 0) { out = s.t; return; }
      const p = sy[i - 1];
      const joined = hy.some(h => h >= p.x1 - 2 && h <= s.x0 + 2);
      if (joined) out = out.replace(/\s+$/, '') + s.t.replace(/^\s+/, '');
      else if (/\s$/.test(out) || /^\s/.test(s.t) || s.x0 - p.x1 > 1.2) out = out.replace(/\s+$/, '') + ' ' + s.t.replace(/^\s+/, '');
      else out += s.t;
    });
    return { text: squash(out), lead, trail };
  }

  // Split label text like "JACK, CRUTCHIE:" into a speaker string.
  const normWho = s => squash(clean(s).replace(/:\s*$/, '').replace(/\s*[&+]\s*/g, ', ').replace(/\s+AND\s+/g, ', ')).toUpperCase().replace(/^[,\s]+|[,\s]+$/g, '');

  // ---------- 2. Table of contents -> song titles by printed page ----------
  function parseTOC(pages) {
    const songs = [];
    for (const pg of pages.slice(0, 6)) {
      const text = rowsOf(pg.items).map(r => clean(r.items.map(i => i.s).join(''))).join('\n');
      if (!/Table of Contents/i.test(text)) continue;
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*(.+?)\s*\.{3,}\s*(\d+)\s*$/);
        if (m) songs.push({ title: squash(m[1]), page: +m[2] });
      }
    }
    // Front-matter entries (Welcome, Synopsis...) use roman numerals and won't match; drop the
    // "Script" entry itself and anything after the script (glossaries, credits).
    const out = [];
    for (const s of songs) {
      if (/script$/i.test(s.title)) continue;
      if (/glossary|credits|copyright/i.test(s.title)) break;
      out.push(s);
    }
    return out;
  }

  // Printed page number from the footer (e.g. "Actor's Script 7" or "8 Disney's ...").
  function printedPage(pg) {
    for (const it of pg.items) {
      if (/Calibri|Myriad/i.test(it.font) && /^\s*\d{1,3}\s*$/.test(it.s) && it.y > pg.height * 0.85) return +it.s.trim();
    }
    const foot = pg.items.filter(i => i.y > pg.height * 0.9).map(i => i.s).join(' ');
    const m = foot.match(/Script\s+(\d{1,3})\b/) || foot.match(/^\s*(\d{1,3})\s/);
    return m ? +m[1] : null;
  }

  // ---------- 3. Lyric rows -> words with x positions ----------
  // Text runs often hold several syllables ("dy in' to") while the hyphens are separate runs,
  // so explode runs into space-separated pieces with estimated x positions, then glue
  // pieces back together wherever a hyphen sits in the gap between them.
  function lyricWords(items) {
    const hy = [], pieces = [];
    for (const it of items) {
      const t = clean(it.s);
      if (!t.trim()) continue;
      if (/^\s*-\s*$/.test(t)) { hy.push((it.x0 + it.x1) / 2); continue; }
      const cw = (it.x1 - it.x0) / Math.max(1, t.length);
      const re = /\S+/g; let m;
      while ((m = re.exec(t))) {
        const x0 = it.x0 + cw * m.index, x1 = it.x0 + cw * (m.index + m[0].length);
        let w = m[0];
        if (w === '-') { hy.push((x0 + x1) / 2); continue; }
        if (/^-./.test(w)) { hy.push(x0 - 1); w = w.slice(1); }
        if (/[^-]-$/.test(w)) { hy.push(x1 + 1); w = w.slice(0, -1); }
        pieces.push({ t: w, x0, x1 });
      }
    }
    pieces.sort((a, b) => a.x0 - b.x0);
    if (!pieces.length) return { words: [], lead: hy.length > 0, trail: false };
    const join = new Array(pieces.length).fill(false); // join[i]: glue piece i to piece i-1
    let lead = false, trail = false;
    for (const h of hy) {
      if (h < pieces[0].x0 + 1) { lead = true; continue; }
      if (h > pieces[pieces.length - 1].x1 - 1) { trail = true; continue; }
      let best = -1, bd = 1e9;
      for (let i = 1; i < pieces.length; i++) {
        const a = pieces[i - 1].x1, b = pieces[i].x0;
        const d = h >= Math.min(a, b) - 2 && h <= Math.max(a, b) + 2 ? 0 : Math.min(Math.abs(h - a), Math.abs(h - b));
        if (d < bd) { bd = d; best = i; }
      }
      if (best > 0 && bd < 9) join[best] = true;
    }
    const words = [];
    pieces.forEach((p, i) => {
      if (i > 0 && join[i]) { const w = words[words.length - 1]; w.t += p.t; w.x1 = p.x1; }
      else words.push({ t: p.t, x0: p.x0, x1: p.x1 });
    });
    return { words, lead, trail };
  }

  // Prose text of a row: insert spaces at visual gaps.
  function proseText(segs) {
    let out = '', px = null;
    for (const s of segs) {
      if (px != null && s.x0 - px > 1.5 && !/\s$/.test(out) && !/^\s/.test(s.t)) out += ' ';
      out += s.t; px = s.x1;
    }
    return squash(out);
  }

  // ---------- 4. Main parse ----------
  function parse(pages) {
    const out = [];
    let pageOffset = null;
    for (const pg of pages) { const pp = printedPage(pg); if (pp) { pageOffset = pg.n - pp; break; } }

    let started = false, ended = false;
    let cur = null;          // spoken line being accumulated
    let dirBuf = null;       // multi-row stage direction
    let inSong = null;
    let carry = {};          // staff slot within a system -> current singer
    let acc = {};            // singer -> words of the phrase in progress
    let pendingTrail = {};   // singer -> previous row ended mid-word
    let prevTail = [];       // row signatures from the end of the previous page (overflow de-dupe)

    let lastWho = '';
    const pushLine = () => {
      if (cur && !cur.who) cur.who = lastWho;
      if (cur && cur.who) lastWho = cur.who;
      if (cur && cur.text.trim()) { cur.text = squash(cur.text); if (cur.paren) cur.paren = squash(cur.paren); delete cur.x; delete cur.y; out.push(cur); }
      cur = null;
    };
    const pushDir = () => {
      if (dirBuf && dirBuf.text.trim()) {
        const t = squash(dirBuf.text).replace(/^\(\s*/, '').replace(/\s*\)\s*$/, '');
        if (cur && !cur.text.trim() && t.length < 140 && !/^#\d/.test(t)) cur.paren = (cur.paren ? cur.paren + '; ' : '') + t;
        else if (t && !(inSong && t === inSong)) { if (cur && cur.text.trim()) pushLine(); out.push({ t: 'dir', text: t, page: dirBuf.page }); }
      }
      dirBuf = null;
    };
    const flush = (who) => {
      const a = acc[who];
      if (a && a.words.length) out.push({ t: 'line', who, text: squash(a.words.join(' ')), sung: true, page: a.page });
      delete acc[who];
    };
    const flushAll = () => Object.keys(acc).forEach(flush);
    let lastSong = null, bookSinceSong = true;
    const endSong = () => { if (inSong) { flushAll(); out.push({ t: 'endsong' }); lastSong = inSong; bookSinceSong = false; inSong = null; carry = {}; pendingTrail = {}; } };
    const startSong = (title, page) => {
      pushDir(); pushLine(); endSong();
      if (!title) title = (!bookSinceSong && lastSong) ? lastSong.replace(/( \(cont\.\))?$/, ' (cont.)') : 'Musical Number';
      inSong = title; out.push({ t: 'song', title, page });
    };

    for (const pg of pages) {
      if (ended) break;
      const page = pageOffset != null ? pg.n - pageOffset : pg.n;
      const footY = Math.min(pg.height - 20, ...pg.items.filter(i => /Calibri|Myriad/i.test(i.font) && i.y > pg.height * 0.85).map(i => i.y - 14));
      const items0 = pg.items.filter(i => isScriptFont(i.font) && i.y > 28 && i.y < footY).sort((a, b) => a.y - b.y);
      // Some pages carry a hidden second copy of the same text a few points lower; drop the twins.
      // Find the layer's vertical offset: many long strings repeated at the same x and the same dy.
      const dyCount = {};
      items0.forEach((it, k) => { if (it.s.trim().length < 4) return; for (let j = 0; j < k; j++) { const o = items0[j]; const dy = it.y - o.y; if (dy > 3 && dy < 60 && o.s === it.s && Math.abs(o.x0 - it.x0) < 0.3) { const key = Math.round(dy * 2) / 2; dyCount[key] = (dyCount[key] || 0) + 1; } } });
      const best = Object.entries(dyCount).sort((a, b) => b[1] - a[1])[0];
      const layerDy = best && best[1] >= 6 ? +best[0] : null;
      const items = layerDy == null ? items0 : items0.filter((it, k) => !items0.some((o, j) => j < k && o.s === it.s && Math.abs(o.x0 - it.x0) < 0.3 && Math.abs(it.y - o.y - layerDy) < 0.8));
      const banners = [];
      items.filter(i => i.size > 20).sort((a, b) => a.y - b.y || a.x0 - b.x0).forEach(b => {
        const last = banners[banners.length - 1];
        if (last && b.y - last.y < 60) { last.s = (Math.abs(b.y - last.y) < 3 ? last.s + b.s : last.s + ' ' + b.s); last.y = b.y; }
        else banners.push({ s: b.s, y: b.y });
      });
      const body = items.filter(i => i.size <= 20);
      const measures = pg.items.filter(i => /Helvetica/i.test(i.font) && /^\s*\d+\s*$/.test(i.s)).map(i => i.y).sort((a, b) => a - b);
      const systemOf = y => { let k = -1; for (let i = 0; i < measures.length; i++) if (measures[i] <= y + 2) k = i; return k; };

      const pageText = clean(pg.items.map(i => i.s).join(' '));
      if (started && /GLOSSARY|CREDITS & COPYRIGHTS/.test(pageText) && !body.some(i => i.size >= 11.9 && styleOf(i.font) === 'b' && i.x0 > 140)) { ended = true; break; }

      const rows = rowsOf(body);
      const labels = [];      // singer labels on this page {who,x,y}
      const slotCount = {};
      let lastLyricY = -1e9;
      let dedupe = prevTail.length > 0;
      const tailSet = new Set(prevTail);
      const sigs = [];
      let lastLabelRow = null;

      for (const row of rows) {
        while (banners.length && banners[0].y < row.y) { startSong(squash(clean(banners.shift().s)), page); started = true; }
        const segs = row.items.map(it => ({ t: clean(it.s), st: styleOf(it.font), size: it.size, x0: it.x0, x1: it.x1 })).filter(s => s.t.length);
        const vis = segs.filter(s => s.t.trim());
        if (!vis.length) continue;
        const text = proseText(segs);
        const sig = text.replace(/\s+/g, '');
        const size = Math.max(...vis.map(s => s.size));
        const bold = vis.filter(s => s.st === 'b');
        const roman = vis.filter(s => s.st === 'r' && !/^-$/.test(s.t.trim()));
        const firstX = vis[0].x0;
        const isLabelRow = bold.length && !roman.length && /[:,]\s*$/.test(bold[bold.length - 1].t) && size < 11.9;

        // Skip overflow rows repeated from the bottom of the previous page.
        if (dedupe) {
          if (tailSet.has(sig) && !isLabelRow) { continue; }
          if (!isLabelRow) dedupe = false;
        }
        sigs.push(sig);

        if (size >= 13.5 && bold.length === vis.length) {          // scene heading
          pushDir(); pushLine(); endSong();
          out.push({ t: 'scene', title: text, page }); started = true; continue;
        }
        if (!started) {
          if (/^\(#1\b/.test(text) || (size >= 11.9 && bold.length === vis.length && firstX > 140)) started = true; else continue;
        }
        const big = size >= 11.6;

        // ----- stage directions: rows that open with "(" or are wholly italic -----
        const italicOnly = vis.every(s => s.st === 'i' || s.st === 'bi');
        if (dirBuf || /^\(/.test(text) && (vis[0].st === 'i' || vis[0].st === 'bi' || /^\(#\d/.test(text)) || (italicOnly && !(inSong && /^\d+x$/.test(text)))) {
          if (cur && cur.y != null && cur.text.trim() && !dirBuf) pushLine();
          if (!dirBuf) dirBuf = { text: '', page };
          dirBuf.text += ' ' + text;
          const o = (dirBuf.text.match(/\(/g) || []).length, c = (dirBuf.text.match(/\)/g) || []).length;
          if (c >= o) pushDir();
          continue;
        }

        if (big) {
          // ----- book scene: centered bold NAME, then prose -----
          if (bold.length === vis.length && firstX > 140 && /^[A-Z0-9 .,'&()\-/]+$/.test(text)) {
            pushLine(); endSong(); bookSinceSong = true;
            cur = { t: 'line', who: normWho(text.replace(/\(.*?\)/g, '')), text: '', sung: false, page };
            continue;
          }
          if (!cur && lastWho && roman.length) cur = { t: 'line', who: lastWho, text: '', sung: false, page };
          if (cur) {
            for (const s of segs) {
              if (s.st === 'i' || s.st === 'bi') { const p = s.t.trim().replace(/^\(|\)$/g, ''); if (p) cur.paren = (cur.paren ? cur.paren + '; ' : '') + p; }
            }
            cur.text += ' ' + proseText(segs.filter(s => s.st === 'r' || s.st === 'b').map(s => s));
          }
          continue;
        }

        // ----- inside a song (11pt text) -----
        if (!inSong) startSong(null, page);

        // Inline spoken line: "NAME: text" (or "NAME: (note)" with the text on the next row).
        if (vis[0].st === 'b' && /:\s*$/.test(vis[0].t) && (roman.length ? roman[0].x0 >= vis[0].x1 - 1 : vis.some(s => s.st === 'i'))) {
          flushAll(); pushLine();
          const label = bold.map(s => s.t).join(' ');
          const paren = vis.filter(s => s.st === 'i' || s.st === 'bi').map(s => s.t).join(' ').trim().replace(/^\(|\)$/g, '');
          cur = { t: 'line', who: normWho(label.replace(/[()]/g, '')), text: proseText(segs.filter(s => s.st === 'r')), sung: false, page, x: vis[0].x0, y: row.y };
          if (paren) cur.paren = squash(paren);
          continue;
        }
        if (cur && cur.y != null && !bold.length && row.y - cur.y < 16 && Math.abs(firstX - cur.x) < 40) {
          cur.text += ' ' + proseText(segs); cur.y = row.y; continue;
        }
        if (cur) pushLine();

        // Singer labels.
        if (isLabelRow) {
          const parts = []; let p = null;
          for (const s of bold) {
            if (p && s.x0 - p.x1 < 10) { p.t += s.t; p.x1 = s.x1; }
            else { p = { t: s.t, x0: s.x0, x1: s.x1 }; parts.push(p); }
          }
          for (const part of parts) {
            const prevStack = lastLabelRow && row.y - lastLabelRow.y < 16 && labels.find(l => (/,\s*$/.test(l.raw) || /^\s*[&+,]/.test(part.t)) && Math.abs(l.x - part.x0) < 40 && l.y === lastLabelRow.y);
            if (prevStack) { prevStack.raw += ' ' + part.t; prevStack.who = normWho(prevStack.raw.replace(/[()]/g, '')); prevStack.y = row.y; }
            else labels.push({ raw: part.t, who: normWho(part.t.replace(/[()]/g, '')), x: part.x0, y: row.y });
          }
          lastLabelRow = row;
          continue;
        }

        // ----- lyric row -----
        const lyricItems = row.items.filter(it => styleOf(it.font) === 'r' || styleOf(it.font) === 'i');
        const { words, lead, trail } = lyricWords(lyricItems);
        if (!words.length) continue;
        const sys = systemOf(row.y);
        const slot = slotCount[sys] = (slotCount[sys] || 0) + 1;
        const mine = labels.filter(l => l.y < row.y && l.y > Math.max(lastLyricY, row.y - 100)).sort((a, b) => a.x - b.x);
        lastLyricY = row.y;

        let singer = carry[slot] || carry[1] || 'ALL';
        const groups = [];
        let g = { who: singer, words: [] };
        const queue = mine.slice();
        if (queue.length && queue[0].x <= words[0].x0 + 8) g.who = queue.shift().who;
        for (const w of words) {
          while (queue.length && w.x0 >= queue[0].x - 6) {
            if (g.words.length) groups.push(g);
            g = { who: queue.shift().who, words: [] };
          }
          g.words.push(w.t);
        }
        if (g.words.length) groups.push(g);
        if (queue.length && groups.length) groups[groups.length - 1].nextWho = queue[queue.length - 1].who;

        const singingNow = new Set(groups.map(x => x.who));
        const newCarry = groups.length ? (groups[groups.length - 1].nextWho || groups[groups.length - 1].who) : singer;
        const live = new Set(Object.entries(carry).filter(([k]) => +k !== slot).map(([, v]) => v));
        Object.keys(acc).forEach(k => { if (!singingNow.has(k) && !live.has(k)) flush(k); });
        groups.forEach((gr, gi) => {
          if (!acc[gr.who]) acc[gr.who] = { words: [], page };
          const ws = gr.words.slice();
          const a0 = acc[gr.who];
          if (gi === 0 && (pendingTrail[gr.who] || lead) && a0.words.length) a0.words[a0.words.length - 1] += ws.shift() || '';
          for (const w of ws) {
            const a = acc[gr.who];
            a.words.push(w);
            const n = a.words.length;
            if ((/[.!?]["')]*$/.test(w) && !/^(Mr|Mrs|Dr|St)\.$/.test(w)) || (/[,;:]["')]*$/.test(w) && n >= 10) || n >= 16) {
              flush(gr.who); acc[gr.who] = { words: [], page };
            }
          }
          if (!acc[gr.who].words.length) delete acc[gr.who];
          // A singer switch mid-row closes the previous singer's phrase.
          if (gi < groups.length - 1) flush(gr.who);
          pendingTrail[gr.who] = gi === groups.length - 1 ? trail : false;
        });
        carry[slot] = newCarry;
      }
      pushDir();
      if (cur && cur.y != null) pushLine();
      prevTail = sigs.slice(-14);
    }
    pushDir(); pushLine(); endSong();

    // Tidy up text and drop empties / empty songs.
    const final = [];
    for (const e of out) {
      if (e.t === 'line') {
        e.text = e.text.replace(/\s+([,.!?;:])/g, '$1').replace(/\s+/g, ' ').trim();
        if (!e.text || /^[-.\s]+$/.test(e.text)) continue;
      }
      if (e.t === 'endsong' && final.length && final[final.length - 1].t === 'song') { final.pop(); continue; }
      final.push(e);
    }
    return { entries: final };
  }

  // Count lines per speaker so the app can offer a role picker.
  function speakers(entries) {
    const c = {};
    entries.filter(e => e.t === 'line').forEach(e => e.who.split(/\s*,\s*/).forEach(w => { if (w) c[w] = (c[w] || 0) + 1; }));
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }

  const api = { extractPages, parse, speakers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScriptParser = api;
})(typeof self !== 'undefined' ? self : this);
