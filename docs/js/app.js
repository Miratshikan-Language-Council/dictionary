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

let entries = [];
let currentList = [];
let visibleCount = 0;

fetch('database/db.json')
  .then(r => r.json())
  .then(data => {
    entries = [...data].sort((a, b) =>
      a.lemma.latin.toLowerCase().localeCompare(b.lemma.latin.toLowerCase())
    );
    entries.forEach(e => { e._search = buildSearchText(e); });
    applyHash();
  })
  .catch(() => {
    document.getElementById('results').innerHTML =
      '<p style="color:#a8654a">Could not load database/db.json. Make sure it sits at docs/database/db.json.</p>';
  });

// Strips accents/diacritics so "manov" matches "manòv", е matches ѐ, etc.
function normalize(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function buildSearchText(entry) {
  const parts = [
    entry.lemma.latin,
    entry.lemma.cyrillic,
    ...entry.meanings.map(m => m.definition)
  ];
  return normalize(parts.join(' '));
}

function matches(entry, q) {
  if (!q) return true;
  return entry._search.includes(normalize(q));
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

// replace = true: full re-render (new search / new hash / back to full list).
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
      back.addEventListener('click', ev => {
        ev.preventDefault();
        history.pushState('', document.title, window.location.pathname + window.location.search);
        document.getElementById('search').value = '';
        render(entries);
      });
    }
  } else {
    results.insertAdjacentHTML('beforeend', currentList.slice(start, end).map(renderEntryHTML).join(''));
    count.textContent = `${end} of ${currentList.length} words`;
  }

  loadMoreBtn.hidden = opts.single || end >= currentList.length;
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
  render(entries);
}

window.addEventListener('hashchange', applyHash);

document.getElementById('search').addEventListener('input', e => {
  const q = e.target.value.trim();
  if (window.location.hash) {
    history.pushState('', document.title, window.location.pathname + window.location.search);
  }
  render(entries.filter(entry => matches(entry, q)));
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