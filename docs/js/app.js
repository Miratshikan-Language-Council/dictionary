let entries = [];

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

function render(list, opts = {}) {
  const results = document.getElementById('results');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');

  const backLink = opts.single
    ? '<a class="back-link" href="#" id="back-link">&larr; Show all words</a>'
    : '';

  count.innerHTML = backLink + (
    list.length === entries.length
      ? `${entries.length} words`
      : `${list.length} of ${entries.length} words`
  );

  const back = document.getElementById('back-link');
  if (back) {
    back.addEventListener('click', e => {
      e.preventDefault();
      history.pushState('', document.title, window.location.pathname + window.location.search);
      document.getElementById('search').value = '';
      render(entries);
    });
  }

  if (list.length === 0) {
    results.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  results.innerHTML = list.map(e => {
    const tags = [...e.partOfSpeech, ...(e.grammar.gender ? [e.grammar.gender] : [])]
      .map(t => `<span class="tag">${t}</span>`).join('');
    const meanings = e.meanings.map(m => `<li>${m.definition}</li>`).join('');
    const rootNote = e.root ? `root: ${e.root}` : '';

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
      </div>`;
  }).join('');
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