import {
  parseFlibustInput,
  getSettings,
  saveSettings,
  checkHealth,
  downloadBook,
  getHistory,
  addToHistory,
  clearHistory,
  searchBooks,
  getAuthorBooks,
  getSeriesBooks,
} from './api.js';
import { initPWA, showToast } from './pwa.js';

// ─── State ───────────────────────────────────────────────────────────────────
let isDownloading = false;
let searchDebounceTimer = null;
let currentSearchController = null;
let browseStack = [];
let lastSearchResults = [];
let activeSearchTab = 'all';
let sortOrder = 'default';
let visibleCount = 20;

const PAGE_SIZE = 20;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initPWA();
  loadSettings();
  renderHistory();
  checkBackendStatus();
  setInterval(checkBackendStatus, 30000);
  bindEvents();
});

// ─── Events ──────────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('download-form').addEventListener('submit', handleDownload);

  const urlInput = document.getElementById('book-url-input');
  urlInput.addEventListener('input', handleUrlInput);
  urlInput.addEventListener('paste', () => setTimeout(() => handleUrlInput({ target: urlInput }), 10));

  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', handleSearchInput);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(searchInput.value.trim()); }
  });

  document.getElementById('search-clear').addEventListener('click', () => {
    searchInput.value = '';
    searchInput.focus();
    document.getElementById('search-clear').style.display = 'none';
    document.getElementById('search-hint').textContent = 'Минимум 3 символа для поиска';
    clearSearchResults();
  });

  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });
  document.getElementById('settings-save-btn').addEventListener('click', handleSaveSettings);
  document.getElementById('settings-cancel-btn').addEventListener('click', closeSettings);
  document.getElementById('clear-history-btn').addEventListener('click', handleClearHistory);

  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// ─── URL Input ────────────────────────────────────────────────────────────────
function handleUrlInput(e) {
  const value = e.target.value.trim();
  const parsed = parseFlibustInput(value);
  const hint = document.getElementById('url-hint');
  const formatSection = document.getElementById('format-section');
  const noIdState = document.getElementById('no-id-state');

  if (parsed) {
    hint.textContent = `ID книги: ${parsed.remoteId}`;
    hint.className = 'form-hint hint-success';
    formatSection.classList.remove('hidden');
    noIdState.classList.add('hidden');
    if (parsed.format) {
      const radio = document.querySelector(`input[name="format"][value="${parsed.format}"]`);
      if (radio) radio.checked = true;
    }
  } else if (value.length > 0) {
    hint.textContent = 'Введите URL Флибусты или числовой ID книги';
    hint.className = 'form-hint hint-error';
    formatSection.classList.add('hidden');
    noIdState.classList.remove('hidden');
  } else {
    hint.textContent = 'Например: https://flibusta.is/b/123456 или просто 123456';
    hint.className = 'form-hint';
    formatSection.classList.add('hidden');
    noIdState.classList.remove('hidden');
  }
}

// ─── Download ─────────────────────────────────────────────────────────────────
async function handleDownload(e) {
  e.preventDefault();
  if (isDownloading) return;

  const urlInput = document.getElementById('book-url-input');
  const parsed = parseFlibustInput(urlInput.value);
  if (!parsed) { showToast('Введите корректный URL или ID книги', 'error'); urlInput.focus(); return; }

  const formatRadio = document.querySelector('input[name="format"]:checked');
  if (!formatRadio) { showToast('Выберите формат файла', 'error'); return; }

  const { sourceId } = getSettings();
  await startDownload(sourceId, parsed.remoteId, formatRadio.value, null);
}

async function startDownload(sourceId, remoteId, format, bookTitle) {
  if (isDownloading) return;
  isDownloading = true;

  const dlFloat = document.getElementById('dl-float');
  const dlTitle = document.getElementById('dl-float-title');
  const dlSub   = document.getElementById('dl-float-sub');
  const dlFill  = document.getElementById('dl-float-fill');
  const dlIcon  = dlFloat.querySelector('.dl-spinner');

  dlTitle.textContent = bookTitle ? truncate(bookTitle, 40) : `Книга #${remoteId}`;
  dlSub.textContent = 'Соединение...';
  dlFill.className = 'dl-float-fill indeterminate';
  dlIcon.className = 'dl-spinner';
  dlFloat.classList.add('active');

  const btn = document.getElementById('download-btn');
  const btnText = document.getElementById('download-btn-text');
  const btnSpinner = document.getElementById('download-btn-spinner');
  if (btn) { btn.disabled = true; btnText.textContent = 'Загрузка...'; btnSpinner.style.display = 'block'; }

  try {
    const { blob, filename } = await downloadBook(sourceId, remoteId, format,
      (received, total) => {
        dlFill.classList.remove('indeterminate');
        if (total > 0) {
          const pct = Math.round((received / total) * 100);
          dlFill.style.width = pct + '%';
          dlSub.textContent = `${formatBytes(received)} / ${formatBytes(total)}`;
        } else {
          dlFill.style.width = '60%';
          dlSub.textContent = formatBytes(received);
        }
      }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    dlFill.classList.remove('indeterminate');
    dlFill.style.width = '100%';
    dlSub.textContent = `Готово · ${formatBytes(blob.size)}`;
    dlIcon.className = 'dl-spinner done';

    const title = bookTitle || `Книга #${remoteId}`;
    renderHistory(addToHistory({ remoteId, sourceId, format, title, filename }));

    showToast(`Скачано: ${filename}`, 'success');
    setTimeout(() => { dlFloat.classList.remove('active'); dlFill.style.width = '0%'; }, 3500);

  } catch (err) {
    dlFloat.classList.remove('active');
    dlFill.style.width = '0%';
    showToast(err.message || 'Ошибка скачивания', 'error');
    console.error(err);
  } finally {
    isDownloading = false;
    if (btn) { btn.disabled = false; btnText.textContent = 'Скачать книгу'; btnSpinner.style.display = 'none'; }
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────
function handleSearchInput(e) {
  const val = e.target.value;
  document.getElementById('search-clear').style.display = val.length > 0 ? 'flex' : 'none';

  clearTimeout(searchDebounceTimer);
  const trimmed = val.trim();

  if (!trimmed) {
    clearSearchResults();
    document.getElementById('search-hint').textContent = 'Минимум 3 символа для поиска';
    return;
  }
  if (trimmed.length < 3) {
    document.getElementById('search-hint').textContent = `Ещё ${3 - trimmed.length} символа...`;
    return;
  }
  document.getElementById('search-hint').textContent = '';
  searchDebounceTimer = setTimeout(() => doSearch(trimmed), 550);
}

async function doSearch(query) {
  if (!query || query.length < 3) return;

  if (currentSearchController) currentSearchController.abort();
  currentSearchController = new AbortController();

  browseStack = [];
  activeSearchTab = 'all';
  sortOrder = 'default';
  visibleCount = PAGE_SIZE;

  showSearchSkeleton();

  try {
    const items = await searchBooks(query, currentSearchController.signal);
    lastSearchResults = items;
    renderSearchResults(items, query, null);
  } catch (err) {
    if (err.name === 'AbortError') return;
    document.getElementById('search-results').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>Поиск временно недоступен.</p>
        <p style="margin-top:6px;font-size:.78rem;">Попробуйте позже или скачайте по ID.</p>
      </div>`;
    console.error(err);
  }
}

function showSearchSkeleton() {
  document.getElementById('search-results').innerHTML = `
    <div class="skeleton-list">
      ${Array(5).fill('<div class="skeleton-card"></div>').join('')}
    </div>`;
}

// ─── Render Search ────────────────────────────────────────────────────────────
function renderSearchResults(items, query, browseContext) {
  const resultsEl = document.getElementById('search-results');
  const isBrowse = !!browseContext;

  if (!items.length && !isBrowse) {
    resultsEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>По запросу «${escHtml(query)}» ничего не найдено</p>
        <p style="margin-top:8px;font-size:.78rem;">Попробуйте другие ключевые слова</p>
      </div>`;
    return;
  }

  // Навигация «Назад»
  const backHtml = isBrowse ? `
    <div class="search-nav">
      <button class="back-btn" data-action="back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        Назад
      </button>
      <div class="browse-context">${escHtml(browseContext)}</div>
    </div>` : '';

  // Фильтр-вкладки
  const tabsHtml = isBrowse ? '' : buildTabsHtml(items);

  // Тулбар: счётчик + сортировка
  const toolbarHtml = buildToolbarHtml(items, isBrowse);

  // Применяем сортировку и пагинацию
  const filtered = getFilteredItems(items, isBrowse);
  const sorted   = sortItems(filtered);
  const page     = sorted.slice(0, visibleCount);

  // Рендерим карточки
  let cardsHtml;
  if (isBrowse || activeSearchTab !== 'all') {
    cardsHtml = renderCardList(page);
  } else {
    const series  = page.filter(i => i.item_type === 'series');
    const authors = page.filter(i => i.item_type === 'author');
    const books   = page.filter(i => i.item_type === 'book');
    cardsHtml =
      (series.length  ? renderSection('📚 Серии',  series,  true)  : '') +
      (authors.length ? renderSection('👤 Авторы', authors, true)  : '') +
      (books.length   ? renderSection('📖 Книги',  books,   false) : '');
  }

  // Кнопка «Ещё»
  const remaining = filtered.length - visibleCount;
  const loadMoreHtml = remaining > 0
    ? `<button class="load-more-btn" data-action="load-more">
         Показать ещё ${Math.min(remaining, PAGE_SIZE)}
         <span class="load-more-total">из ${filtered.length}</span>
       </button>` : '';

  resultsEl.innerHTML = backHtml + tabsHtml + toolbarHtml + cardsHtml + loadMoreHtml;
  bindResultEvents(resultsEl);
}

function getFilteredItems(items, isBrowse) {
  if (isBrowse || activeSearchTab === 'all') return items;
  return items.filter(i => i.item_type === activeSearchTab);
}

function sortItems(items) {
  if (sortOrder === 'default') return items;
  const copy = [...items];
  if (sortOrder === 'title-asc')  return copy.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  if (sortOrder === 'title-desc') return copy.sort((a, b) => b.title.localeCompare(a.title, 'ru'));
  if (sortOrder === 'author')     return copy.sort((a, b) => (a.author || a.title).localeCompare(b.author || b.title, 'ru'));
  return copy;
}

function buildTabsHtml(items) {
  const counts = {
    all:    items.length,
    book:   items.filter(i => i.item_type === 'book').length,
    author: items.filter(i => i.item_type === 'author').length,
    series: items.filter(i => i.item_type === 'series').length,
  };
  const tabs = [
    { key: 'all',    label: 'Все',    n: counts.all    },
    { key: 'book',   label: 'Книги',  n: counts.book   },
    { key: 'author', label: 'Авторы', n: counts.author },
    { key: 'series', label: 'Серии',  n: counts.series },
  ].filter(t => t.n > 0 || t.key === 'all');

  return `<div class="search-tabs">
    ${tabs.map(t => `
      <button class="s-tab ${activeSearchTab === t.key ? 'active' : ''}" data-filter="${t.key}">
        ${t.label} <span class="tab-count">${t.n}</span>
      </button>`).join('')}
  </div>`;
}

function buildToolbarHtml(items, isBrowse) {
  const filtered = getFilteredItems(items, isBrowse);
  if (!filtered.length) return '';

  return `
    <div class="results-toolbar">
      <span class="results-count-text">${filtered.length} результатов</span>
      <div class="sort-pills">
        <button class="sort-pill ${sortOrder === 'default'    ? 'active' : ''}" data-sort="default">По умолч.</button>
        <button class="sort-pill ${sortOrder === 'title-asc'  ? 'active' : ''}" data-sort="title-asc">А→Я</button>
        <button class="sort-pill ${sortOrder === 'title-desc' ? 'active' : ''}" data-sort="title-desc">Я→А</button>
        <button class="sort-pill ${sortOrder === 'author'     ? 'active' : ''}" data-sort="author">Автор</button>
      </div>
    </div>`;
}

function renderSection(title, items, useGrid) {
  return `
    <div class="search-section">
      <div class="section-header">${title}</div>
      ${useGrid
        ? `<div class="results-grid">${items.map(renderCard).join('')}</div>`
        : items.map(renderCard).join('')}
    </div>`;
}

function renderCardList(items) {
  const books   = items.filter(i => i.item_type === 'book');
  const nonbook = items.filter(i => i.item_type !== 'book');
  if (nonbook.length && !books.length) {
    return `<div class="results-grid">${items.map(renderCard).join('')}</div>`;
  }
  return items.map(renderCard).join('');
}

function renderCard(item) {
  const isBook   = item.item_type === 'book';
  const isAuthor = item.item_type === 'author';

  const badgeIcon  = isBook ? '📖' : isAuthor ? '👤' : '📚';
  const badgeLabel = isBook ? 'Книга' : isAuthor ? 'Автор' : 'Серия';

  // Обложка — только для книг
  const coverHtml = isBook ? `
    <div class="rc-cover" data-id="${item.id}">
      <img src="/api/cover/${item.id}"
           loading="lazy"
           alt=""
           decoding="async"
           onerror="this.closest('.rc-cover').classList.add('no-cover')" />
    </div>` : '';

  // Ссылка на Флибусту
  const flibUrl = isBook
    ? `https://flibusta.is/b/${item.id}`
    : isAuthor
      ? `https://flibusta.is/a/${item.id}`
      : `https://flibusta.is/sequence/${item.id}`;

  const formatsHtml = isBook ? `
    <div class="rc-formats">
      <button class="dl-fmt-btn" data-id="${item.id}" data-title="${escAttr(item.title)}" data-fmt="epub">EPUB</button>
      <button class="dl-fmt-btn" data-id="${item.id}" data-title="${escAttr(item.title)}" data-fmt="fb2">FB2</button>
      <button class="dl-fmt-btn" data-id="${item.id}" data-title="${escAttr(item.title)}" data-fmt="fb2zip">FB2.ZIP</button>
      <button class="dl-fmt-btn" data-id="${item.id}" data-title="${escAttr(item.title)}" data-fmt="mobi">MOBI</button>
    </div>` : '';

  const openBtnHtml = !isBook ? `
    <div class="rc-open-btn">
      <button class="open-btn browse-btn" data-id="${item.id}" data-type="${item.item_type}" data-title="${escAttr(item.title)}">
        Открыть
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>` : '';

  return `
    <div class="result-card type-${item.item_type}">
      <div class="rc-stripe"></div>
      ${coverHtml}
      <div class="rc-body">
        <div class="rc-badge">${badgeIcon} ${badgeLabel}</div>
        <div class="rc-title">${escHtml(item.title)}</div>
        ${item.author ? `<div class="rc-author">${escHtml(item.author)}</div>` : ''}
        <div class="rc-meta">
          <span class="rc-id">ID: ${item.id}</span>
          <a href="${flibUrl}" target="_blank" rel="noopener noreferrer" class="rc-flib-link">
            Флибуста
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        </div>
        ${formatsHtml}
      </div>
      ${openBtnHtml}
    </div>`;
}

function bindResultEvents(container) {
  container.querySelector('[data-action="back"]')?.addEventListener('click', goBackInBrowse);

  container.querySelectorAll('[data-filter]').forEach(tab => {
    tab.addEventListener('click', () => {
      activeSearchTab = tab.dataset.filter;
      visibleCount = PAGE_SIZE;
      const query = document.getElementById('search-input').value.trim();
      renderSearchResults(lastSearchResults, query, null);
    });
  });

  container.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      sortOrder = btn.dataset.sort;
      visibleCount = PAGE_SIZE;
      const query = document.getElementById('search-input').value.trim();
      const isBrowse = browseStack.length > 0;
      renderSearchResults(
        isBrowse ? (browseStack[browseStack.length - 1]?.browseItems ?? lastSearchResults) : lastSearchResults,
        query,
        isBrowse ? document.querySelector('.browse-context')?.textContent || null : null
      );
    });
  });

  container.querySelector('[data-action="load-more"]')?.addEventListener('click', () => {
    visibleCount += PAGE_SIZE;
    const query = document.getElementById('search-input').value.trim();
    const browseCtx = container.querySelector('.browse-context')?.textContent || null;
    renderSearchResults(lastSearchResults, query, browseCtx);
    // Скроллим к новым результатам
    const cards = container.querySelectorAll('.result-card');
    if (cards.length > 0) {
      cards[Math.max(0, visibleCount - PAGE_SIZE)]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  container.querySelectorAll('.dl-fmt-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { sourceId } = getSettings();
      await startDownload(sourceId, btn.dataset.id, btn.dataset.fmt, btn.dataset.title);
    });
  });

  container.querySelectorAll('.browse-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await browseCategory(btn.dataset.type, btn.dataset.id, btn.dataset.title);
    });
  });

  // Предотвращаем переход по ссылкам при нажатии на кнопки
  container.querySelectorAll('.rc-flib-link').forEach(link => {
    link.addEventListener('click', e => e.stopPropagation());
  });
}

// ─── Browse ───────────────────────────────────────────────────────────────────
async function browseCategory(type, id, title) {
  if (currentSearchController) currentSearchController.abort();
  currentSearchController = new AbortController();

  browseStack.push({
    items:   lastSearchResults,
    query:   document.getElementById('search-input').value.trim(),
    tab:     activeSearchTab,
    sort:    sortOrder,
    visible: visibleCount,
  });

  sortOrder    = 'default';
  visibleCount = PAGE_SIZE;

  showSearchSkeleton();

  try {
    const books = type === 'author'
      ? await getAuthorBooks(id, currentSearchController.signal)
      : await getSeriesBooks(id, currentSearchController.signal);

    lastSearchResults = books;
    const label = type === 'author' ? `Книги автора: ${title}` : `Серия: ${title}`;
    renderSearchResults(books, '', label);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    if (err.name === 'AbortError') return;
    showToast('Не удалось загрузить список книг', 'error');
    goBackInBrowse();
  }
}

function goBackInBrowse() {
  const prev = browseStack.pop();
  if (!prev) {
    const q = document.getElementById('search-input').value.trim();
    if (q) doSearch(q);
    return;
  }
  lastSearchResults = prev.items;
  activeSearchTab   = prev.tab;
  sortOrder         = prev.sort;
  visibleCount      = prev.visible;
  renderSearchResults(prev.items, prev.query, null);
}

function clearSearchResults() {
  const el = document.getElementById('search-results');
  if (el) el.innerHTML = '';
  browseStack = [];
  lastSearchResults = [];
}

// ─── History ──────────────────────────────────────────────────────────────────
function renderHistory(history) {
  if (!history) history = getHistory();
  const listEl = document.getElementById('history-list');
  if (!listEl) return;

  if (!history.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <p>История пуста</p>
        <p style="margin-top:6px;font-size:.78rem;">Скачанные книги появятся здесь</p>
      </div>`;
    return;
  }

  listEl.innerHTML = history.map(h => `
    <div class="history-item">
      <div class="history-fmt-badge">${(h.format || 'book').substring(0, 4)}</div>
      <div class="history-info">
        <div class="history-title">${escHtml(h.title || `Книга #${h.remoteId}`)}</div>
        <div class="history-meta">ID ${h.remoteId} · ${(h.format || '').toUpperCase()} · ${formatDate(h.date)}</div>
      </div>
      <button class="history-dl-btn" title="Скачать снова"
        data-sid="${h.sourceId}" data-rid="${h.remoteId}"
        data-fmt="${h.format}" data-title="${escAttr(h.title || '')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
    </div>
  `).join('');

  listEl.querySelectorAll('.history-dl-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await startDownload(btn.dataset.sid, btn.dataset.rid, btn.dataset.fmt, btn.dataset.title || null);
    });
  });
}

function handleClearHistory() {
  if (!confirm('Очистить всю историю скачиваний?')) return;
  clearHistory();
  renderHistory([]);
  showToast('История очищена');
}

// ─── Settings ────────────────────────────────────────────────────────────────
function loadSettings() {
  const s = getSettings();
  const sidInput = document.getElementById('setting-source-id');
  if (sidInput) sidInput.value = s.sourceId;
}
function handleSaveSettings() {
  const sourceId = parseInt(document.getElementById('setting-source-id')?.value || '1', 10);
  saveSettings({ sourceId });
  closeSettings();
  showToast('Настройки сохранены', 'success');
}
function openSettings()  { document.getElementById('settings-overlay').classList.add('open'); }
function closeSettings() { document.getElementById('settings-overlay').classList.remove('open'); }

// ─── Status ───────────────────────────────────────────────────────────────────
async function checkBackendStatus() {
  const dot   = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  if (!dot) return;
  const online = await checkHealth();
  dot.className = 'status-dot ' + (online ? 'online' : 'offline');
  if (label) label.textContent = online ? 'Онлайн' : 'Офлайн';
}

// ─── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('[data-tab]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === tabName));
  document.querySelectorAll('[data-tab-content]').forEach(panel =>
    panel.classList.toggle('hidden', panel.dataset.tabContent !== tabName));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes) return '0 Б';
  if (bytes < 1024)    return bytes + ' Б';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / 1048576).toFixed(1) + ' МБ';
}
function formatDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(str) {
  if (!str) return '';
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function truncate(str, len) {
  if (!str || str.length <= len) return str || '';
  return str.substring(0, len) + '…';
}
