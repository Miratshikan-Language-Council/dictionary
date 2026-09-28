const PAGE_SIZE = 8; // how many entries load at a time — change this one number to adjust

// The six known endings. "group" controls the section headers in the table.
const CONJUGATION_ENDINGS = [
  { label: 'Infinitive',  group: 'Base',  latinEnding: 'iti',  cyrEnding: 'ити' },
  { label: 'Present',     group: 'Tense', latinEnding: 'ita',  cyrEnding: 'ита' },
  { label: 'Past',        group: 'Tense', latinEnding: 'ite',  cyrEnding: 'ите' },
  { label: 'Future',      group: 'Tense', latinEnding: 'ito',  cyrEnding: 'ито' },
  { label: 'Volitive',    group: 'Mood',  latinEnding: 'itja', cyrEnding: 'итя' },
  { label: 'Conditional', group: 'Mood',  latinEnding: 'itu',  cyrEnding: 'иту' },
];

// Order the part-of-speech chips appear in. A tag that exists in the data but
// is missing from this list is added at the end, so nothing is ever hidden.
const POS_ORDER = [
  'noun', 'verb', 'adjective', 'interjection', 'determiner',
  'conjunction', 'preposition', 'adverb', 'pronoun', 'particle', 'numeral',
];

// Small words that don't count when you type a longer search ("to heal" = "heal").
// Searching one of them on its own still works normally.
const FILLER = new Set(['to', 'of', 'in', 'a', 'an', 'the', 'at', 'on', 'by', 'for', 'with', 'from']);

let entries = [];
let currentList = [];
let visibleCount = 0;

// All active filters live here. Only part of speech for now — adding another
// (gender, say) means one more entry here plus one more line in passesFilters().
const filters = { pos: new Set() };

fetch('database/db.json')
  .then(r => r.json())
  .then(data => {
    entries = [...data].sort((a, b) =>
      a.lemma.latin.toLowerCase().localeCompare(b.lemma.latin.toLowerCase())
    );
    entries.forEach(buildIndex);
    buildFilters();
    applyHash();
  })
  .catch(() => {
    document.getElementById('results').innerHTML =
      '<p style="color:#a8654a">Could not load database/db.json. Make sure it sits at docs/database/db.json.</p>';
  });

// ---- text helpers ----

// Strips accents/diacritics so "manov" matches "manòv", е matches ѐ, etc.
function normalize(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Plain lowercase words: accents stripped, punctuation and hyphens become breaks.
function words(str) {
  return normalize(str).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function key(str) {
  return words(str).join(' ');
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---- search index (built once, when the data loads) ----

function buildIndex(e) {
  e._idx = {
    latin: key(e.lemma.latin),
    cyr: key(e.lemma.cyrillic),
    root: e.root ? key(e.root) : '',
    meanings: e.meanings
      .map(m => key(m.definition))
      .filter(Boolean)
      .map(k => ({ key: k, bare: k.replace(/^to /, ''), words: k.split(' ') })),
  };
}

// ---- ranked search ----
//
// Every word you type must match somewhere. Each entry is then scored by how
// well its weakest word matched, and the best scores come first:
//   100  exact (the whole search equals a word, or a meaning with or without "to")
//    80  a word or meaning starts with it
//    70  it's a whole word inside a meaning
//    55  it starts a word inside a meaning
//  40/30 it appears somewhere inside a word / meaning
//  25-20 it only matches the root (always below any direct match)
// Ties stay alphabetical, since the list is already sorted A-Z.

function scoreToken(idx, t) {
  let best = 0;

  for (const f of [idx.latin, idx.cyr]) {
    if (!f) continue;
    if (f === t) best = Math.max(best, 100);
    else if (f.startsWith(t)) best = Math.max(best, 80);
    else if (f.includes(t)) best = Math.max(best, 40);
  }

  for (const m of idx.meanings) {
    if (m.words.includes(t)) best = Math.max(best, 70);
    else if (m.words.some(w => w.startsWith(t))) best = Math.max(best, 55);
    else if (m.key.includes(t)) best = Math.max(best, 30);
  }

  if (idx.root) {
    const rootWords = idx.root.split(' ');
    if (idx.root === t || rootWords.includes(t)) best = Math.max(best, 25);
    else if (rootWords.some(w => w.startsWith(t))) best = Math.max(best, 22);
    else if (idx.root.includes(t)) best = Math.max(best, 20);
  }

  return best;
}

function scoreEntry(e, tokens, phrases) {
  const idx = e._idx;

  let base = Infinity;
  for (const t of tokens) {
    const s = scoreToken(idx, t);
    if (s === 0) return 0; // every word has to match somewhere
    base = Math.min(base, s);
  }

  // The whole search compared against whole words/meanings.
  for (const p of phrases) {
    if (!p) continue;
    if (idx.latin === p || idx.cyr === p ||
        idx.meanings.some(m => m.key === p || m.bare === p)) {
      return 100;
    }
    if (idx.meanings.some(m => m.key.startsWith(p + ' ') || m.bare.startsWith(p + ' '))) {
      base = Math.max(base, 80);
    }
  }

  return base;
}

function search(pool, rawQuery) {
  const allTokens = words(rawQuery);
  if (!allTokens.length) return pool;

  const content = allTokens.filter(t => !FILLER.has(t));
  const tokens = content.length ? content : allTokens; // only filler typed: search it as-is
  const phrases = [...new Set([allTokens.join(' '), tokens.join(' ')])];

  const scored = [];
  for (const e of pool) {
    const s = scoreEntry(e, tokens, phrases);
    if (s > 0) scored.push([s, e]);
  }
  scored.sort((a, b) => b[0] - a[0]); // stable sort: equal scores stay A-Z
  return scored.map(x => x[1]);
}

// ---- "did you mean" (only used when a search finds nothing) ----

// True if the two strings are the same, or differ by exactly one letter:
// one wrong, one missing, one extra, or two neighbors swapped.
function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;

  if (la === lb) {
    let i = 0;
    while (i < la && a[i] === b[i]) i++;
    if (i === la) return true;
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // one wrong letter
    return i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] &&
           a.slice(i + 2) === b.slice(i + 2);           // two swapped
  }

  const [s, l] = la < lb ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);                 // one missing/extra
}

// Up to 3 closest words. Needs 4+ letters (on both sides) so short searches
// don't produce noise.
function suggest(pool, rawQuery) {
  const q = key(rawQuery);
  if (q.length < 4) return [];

  const found = [];
  const seen = new Set();
  for (const e of pool) {
    const idx = e._idx;
    let text = null;

    if (idx.latin.length >= 4 && withinOneEdit(q, idx.latin)) text = e.lemma.latin;
    else if (idx.cyr.length >= 4 && withinOneEdit(q, idx.cyr)) text = e.lemma.cyrillic;
    else {
      for (const m of idx.meanings) {
        const hit = [m.key, m.bare, ...m.words].find(c => c.length >= 4 && withinOneEdit(q, c));
        if (hit) { text = hit; break; }
      }
    }

    if (text && !seen.has(text)) {
      seen.add(text);
      found.push(text);
    }
    if (found.length === 3) break;
  }
  return found;
}

function emptyHTML(suggestions) {
  let html = 'No matches. Try a different spelling.';
  if (suggestions.length) {
    html = 'No exact matches. Did you mean ' + suggestions
      .map(s => `<button type="button" class="suggest" data-text="${esc(s)}">${esc(s)}</button>`)
      .join(', ') + '?';
  }
  if (filtersActive()) {
    html += '<span class="empty-note">Filters are on — try clearing them.</span>';
  }
  return html;
}

// ---- part-of-speech filter ----

function passesFilters(e) {
  return filters.pos.size === 0 || e.partOfSpeech.some(p => filters.pos.has(p));
}

function filtersActive() {
  return filters.pos.size > 0;
}

// One chip per part of speech that actually exists in the data, with a count.
function buildFilters() {
  const counts = {};
  entries.forEach(e => e.partOfSpeech.forEach(p => { counts[p] = (counts[p] || 0) + 1; }));

  const present = Object.keys(counts);
  const ordered = [
    ...POS_ORDER.filter(p => counts[p]),
    ...present.filter(p => !POS_ORDER.includes(p)).sort(),
  ];

  document.getElementById('filters').innerHTML =
    ordered.map(p =>
      `<button type="button" class="chip" data-pos="${esc(p)}" aria-pressed="false">${esc(p)} <span class="chip-count">${counts[p]}</span></button>`
    ).join('') +
    '<button type="button" class="chip-clear" hidden>Clear filters</button>';
}

function syncChips() {
  document.querySelectorAll('#filters .chip').forEach(c => {
    const on = filters.pos.has(c.dataset.pos);
    c.classList.toggle('active', on);
    c.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const clear = document.querySelector('#filters .chip-clear');
  if (clear) clear.hidden = !filtersActive();
}

// ---- verb conjugation ----

// Only words tagged as nothing but "verb", in both scripts, get the button.
// Requiring both endings to match (not just Latin) is a safety check against
// misfiring on an odd word that only coincidentally ends in "iti".
function isConjugableVerb(entry) {
  return (
    entry.partOfSpeech.length === 1 &&
    entry.partOfSpeech[0] === 'verb' &&
    entry.lemma.latin.toLowerCase().endsWith('iti') &&
    entry.lemma.cyrillic.endsWith('ити')
  );
}

function buildConjugation(entry) {
  const latinStem = entry.lemma.latin.slice(0, -3);
  const cyrStem = entry.lemma.cyrillic.slice(0, -3);
  return CONJUGATION_ENDINGS.map(f => ({
    ...f,
    latin: latinStem + f.latinEnding,
    cyrillic: cyrStem + f.cyrEnding,
  }));
}

function renderConjugationBlock(entry) {
  const forms = buildConjugation(entry);
  let lastGroup = null;
  let rows = '';
  for (const f of forms) {
    if (f.group !== 'Base' && f.group !== lastGroup) {
      rows += `<tr class="conj-group"><td colspan="2">${f.group}</td></tr>`;
    }
    rows += `
      <tr>
        <td class="conj-label">${f.label}</td>
        <td><span class="cyr">${f.cyrillic}</span><span class="lat" hidden>${f.latin}</span></td>
      </tr>`;
    lastGroup = f.group;
  }

  return `
    <div class="conj-wrap">
      <button type="button" class="conj-btn" data-id="${entry.id}">Conjugation</button>
      <div class="conj-panel" id="conj-${entry.id}" hidden>
        <div class="conj-script-toggle">
          <button type="button" class="script-btn active" data-script="cyr">Cyrillic</button>
          <button type="button" class="script-btn" data-script="lat">Latin</button>
        </div>
        <table class="conj-table">${rows}</table>
      </div>
    </div>`;
}

// ---- rendering ----

function renderEntryHTML(e) {
  const tags = [...e.partOfSpeech, ...(e.grammar.gender ? [e.grammar.gender] : [])]
    .map(t => `<span class="tag">${t}</span>`).join('');
  const meanings = e.meanings.map(m => `<li>${m.definition}</li>`).join('');
  const rootNote = e.root ? `root: ${e.root}` : '';
  const conjugation = isConjugableVerb(e) ? renderConjugationBlock(e) : '';

  return `
    <div class="entry" id="entry-${e.id}">
      <div class="lemma-row">
        <a class="lemma-cyr" href="#${e.id}">${e.lemma.cyrillic}</a>
        <span class="lemma-lat">${e.lemma.latin}</span>
        <span class="ipa">${e.ipa || ''}</span>
      </div>
      <div class="tags">${tags}</div>
      <ul class="meanings">${meanings}</ul>
      ${rootNote ? `<div class="root-note">${rootNote}</div>` : ''}
      ${conjugation}
    </div>`;
}

function render(list, opts = {}) {
  currentList = list;
  visibleCount = Math.min(PAGE_SIZE, list.length);
  renderSlice(0, visibleCount, { replace: true, opts });
}

function loadMore() {
  const start = visibleCount;
  visibleCount = Math.min(visibleCount + PAGE_SIZE, currentList.length);
  renderSlice(start, visibleCount, { replace: false });
}

// replace = true: full re-render (new search / new filter / new hash).
// replace = false: "Load more" — only the newly revealed slice is appended,
// so any conjugation panels already open lower on the page stay open.
function renderSlice(start, end, { replace, opts = {} } = {}) {
  const results = document.getElementById('results');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');
  const loadMoreBtn = document.getElementById('load-more');

  if (replace) {
    const backLink = opts.single
      ? '<a class="back-link" href="#" id="back-link">&larr; Show all words</a>'
      : '';

    if (currentList.length === 0) {
      results.innerHTML = '';
      count.innerHTML = backLink;
      empty.innerHTML = emptyHTML(opts.suggestions || []);
      empty.style.display = 'block';
      loadMoreBtn.hidden = true;
      return;
    }
    empty.style.display = 'none';

    count.innerHTML = backLink + (opts.single
      ? `${currentList.length} of ${entries.length} words`
      : `${end} of ${currentList.length} words`);

    results.innerHTML = currentList.slice(start, end).map(renderEntryHTML).join('');

    const back = document.getElementById('back-link');
    if (back) {
      // "Show all words" really means all: clears the search box and filters too.
      back.addEventListener('click', ev => {
        ev.preventDefault();
        clearHash();
        document.getElementById('search').value = '';
        filters.pos.clear();
        syncChips();
        runSearch();
      });
    }
  } else {
    results.insertAdjacentHTML('beforeend', currentList.slice(start, end).map(renderEntryHTML).join(''));
    count.textContent = `${end} of ${currentList.length} words`;
  }

  loadMoreBtn.hidden = opts.single || end >= currentList.length;
}

// ---- putting it together ----

// Reads the search box and the filters, and shows the result.
function runSearch() {
  const q = document.getElementById('search').value.trim();
  const pool = entries.filter(passesFilters);
  const list = q ? search(pool, q) : pool;

  const opts = {};
  if (q && list.length === 0) opts.suggestions = suggest(pool, q);
  render(list, opts);
}

function clearHash() {
  if (window.location.hash) {
    history.pushState('', document.title, window.location.pathname + window.location.search);
  }
}

// If the URL has a #word-id, narrow the list down to just that word.
function applyHash() {
  const id = window.location.hash.slice(1);
  if (id) {
    const match = entries.filter(e => e.id === id);
    if (match.length) {
      render(match, { single: true });
      return;
    }
  }
  runSearch();
}

window.addEventListener('hashchange', applyHash);

document.getElementById('search').addEventListener('input', () => {
  clearHash();
  runSearch();
});

document.getElementById('filters').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (chip) {
    const p = chip.dataset.pos;
    if (filters.pos.has(p)) filters.pos.delete(p);
    else filters.pos.add(p);
  } else if (e.target.closest('.chip-clear')) {
    filters.pos.clear();
  } else {
    return;
  }
  syncChips();
  clearHash();
  runSearch();
});

// Clicking a "Did you mean" suggestion searches for it.
document.getElementById('empty').addEventListener('click', e => {
  const s = e.target.closest('.suggest');
  if (!s) return;
  document.getElementById('search').value = s.dataset.text;
  runSearch();
});

document.getElementById('load-more').addEventListener('click', loadMore);

// One delegated listener handles every conjugation/script button, including
// ones added later by "Load more" — no per-entry listeners needed.
document.getElementById('results').addEventListener('click', e => {
  const conjBtn = e.target.closest('.conj-btn');
  if (conjBtn) {
    const panel = document.getElementById('conj-' + conjBtn.dataset.id);
    if (panel) {
      const wasHidden = panel.hasAttribute('hidden');
      panel.toggleAttribute('hidden', !wasHidden);
      conjBtn.textContent = wasHidden ? 'Hide conjugation' : 'Conjugation';
    }
    return;
  }

  const scriptBtn = e.target.closest('.script-btn');
  if (scriptBtn) {
    const panel = scriptBtn.closest('.conj-panel');
    const toLatin = scriptBtn.dataset.script === 'lat';
    panel.querySelectorAll('.cyr').forEach(el => { el.hidden = toLatin; });
    panel.querySelectorAll('.lat').forEach(el => { el.hidden = !toLatin; });
    panel.querySelectorAll('.script-btn').forEach(b => b.classList.toggle('active', b === scriptBtn));
  }
});