/**
 * API клиент для books_downloader бэкенда
 * API_KEY инжектится на уровне Nginx — фронт его не знает.
 */

/**
 * Парсит URL или ID Флибусты и возвращает { remoteId, format? }
 * Поддерживает:
 *   - https://flibusta.is/b/123456
 *   - https://flibusta.is/b/123456/epub
 *   - /b/123456
 *   - 123456
 */
export function parseFlibustInput(input) {
  input = input.trim();

  const urlMatch = input.match(/\/b\/(\d+)(?:\/(\w+))?/);
  if (urlMatch) {
    return { remoteId: urlMatch[1], format: urlMatch[2] || null };
  }

  if (/^\d+$/.test(input)) {
    return { remoteId: input, format: null };
  }

  return null;
}

/**
 * Настройки (localStorage) — без API ключа, он в ENV Nginx
 */
export function getSettings() {
  return {
    sourceId: parseInt(localStorage.getItem('flibdl_source_id') || '1', 10),
  };
}

export function saveSettings(settings) {
  if (settings.sourceId !== undefined) localStorage.setItem('flibdl_source_id', settings.sourceId);
}

/**
 * Проверяет доступность бэкенда
 */
export async function checkHealth() {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

const MIME_TYPES = {
  epub:   'application/epub+zip',
  fb2:    'application/x-fictionbook+xml',
  fb2zip: 'application/zip',
  mobi:   'application/x-mobipocket-ebook',
  html:   'text/html',
};

/**
 * Скачивает книгу и возвращает Blob + имена файла (Unicode и ASCII)
 * Nginx автоматически подставляет Authorization заголовок.
 */
export async function downloadBook(sourceId, remoteId, fileType, onProgress) {
  const url = `/api/download/${sourceId}/${remoteId}/${fileType}`;

  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 401) throw new Error('Ошибка авторизации (проверьте API_KEY в ENV)');
    if (response.status === 204) throw new Error('Книга не найдена или недоступна');
    throw new Error(`Ошибка сервера: ${response.status}`);
  }

  // Извлекаем имена файла из заголовков
  // filename     — Unicode (для отображения в UI)
  // filenameAscii — транслит ASCII (для a.download, безопасен на всех платформах)
  let filename      = `book_${remoteId}.${fileType}`;
  let filenameAscii = filename;

  const b64Ascii = response.headers.get('x-filename-b64-ascii');
  if (b64Ascii) {
    try { filenameAscii = atob(b64Ascii); } catch { /* оставляем fallback */ }
  }

  const b64Header = response.headers.get('x-filename-b64');
  if (b64Header) {
    try {
      filename = decodeURIComponent(escape(atob(b64Header)));
    } catch {
      filename = filenameAscii;
    }
  } else {
    const disposition = response.headers.get('content-disposition');
    if (disposition) {
      const match = disposition.match(/filename=(.+)/);
      if (match) filename = match[1];
    }
    if (filename === `book_${remoteId}.${fileType}`) filename = filenameAscii;
  }

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) onProgress(received, total);
  }

  const mimeType = MIME_TYPES[fileType] || 'application/octet-stream';
  const blob = new Blob(chunks, { type: mimeType });
  return { blob, filename, filenameAscii };
}

/**
 * История скачиваний (localStorage)
 */
export function getHistory() {
  try {
    return JSON.parse(localStorage.getItem('flibdl_history') || '[]');
  } catch {
    return [];
  }
}

export function addToHistory(entry) {
  const history = getHistory();
  // Дедупликация по remoteId + format (было h.fileType — баг, ключ называется format)
  const filtered = history.filter(
    (h) => !(h.remoteId === entry.remoteId && h.format === entry.format)
  );
  filtered.unshift({ ...entry, date: new Date().toISOString() });
  const trimmed = filtered.slice(0, 30);
  localStorage.setItem('flibdl_history', JSON.stringify(trimmed));
  return trimmed;
}

export function clearHistory() {
  localStorage.removeItem('flibdl_history');
}

/**
 * Поиск книг через бэкенд
 */
export async function searchBooks(query, signal) {
  const url = `/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Ошибка при поиске');
  return await res.json();
}

/**
 * Получить книги автора
 */
export async function getAuthorBooks(id, signal) {
  const res = await fetch(`/api/author/${id}`, { signal });
  if (!res.ok) throw new Error('Ошибка при получении книг автора');
  return await res.json();
}

/**
 * Получить книги серии
 */
export async function getSeriesBooks(id, signal) {
  const res = await fetch(`/api/series/${id}`, { signal });
  if (!res.ok) throw new Error('Ошибка при получении книг серии');
  return await res.json();
}
