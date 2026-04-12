# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FlibDL is a book downloader for Flibusta (Russian ebook library). It consists of:
- **Backend**: Rust/Axum API server that scrapes Flibusta and proxies file downloads
- **Frontend**: Vanilla JS PWA (no build step) served via Nginx

## Commands

### Backend (Rust)
```bash
cargo build                        # Debug build
cargo build --release --bin books_downloader  # Release build
cargo run                          # Run with .env file
cargo test                         # Run tests
cargo clippy                       # Lint
```

### Docker (full stack)
```bash
# Required env vars before starting:
export API_KEY=your-secret-key
export FL_SOURCES='[{"url":"https://flibusta.is"}]'

docker-compose up -d               # Start all services
docker-compose logs -f backend     # Backend logs
docker-compose logs -f frontend    # Frontend (Nginx) logs
```

Frontend runs on port **3000**, backend on **8080**.

### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `API_KEY` | Yes | Auth token for all API endpoints |
| `FL_SOURCES` | No | JSON array of Flibusta mirrors, e.g. `[{"url":"https://flibusta.is","proxy":"http://proxy:port"}]` |
| `SENTRY_DSN` | No | Sentry error tracking DSN |

## Architecture

### Request Flow

```
Browser → Nginx (:3000)
           ├── /api/* → injects Authorization header → Backend (:8080)
           └── /* → serves static frontend files
```

Nginx injects the `Authorization: {API_KEY}` header server-side — the API key is **never** sent to or stored in the browser. All backend routes except `/health` and `/metrics` require this header.

### Backend Structure (`src/`)

- **`main.rs`** — Axum router setup, middleware (auth, tracing, metrics), port binding
- **`config.rs`** — Reads env vars, parses `FL_SOURCES` into `Vec<FlSource>` (url + optional proxy)
- **`views.rs`** — Route handlers; thin layer that delegates to services
- **`services/search.rs`** — Scrapes Flibusta search pages with `scraper` crate; parses HTML into typed results (books, authors, series)
- **`services/downloader/`** — Fetches book files from Flibusta mirrors; handles format variants (fb2, epub, mobi, html, fb2.zip)
- **`services/book_library/`** — Fetches author and series book listings
- **`services/cover.rs`** — Proxies cover images from Flibusta image server
- **`services/filename_getter.rs`** — Generates transliterated filenames (Cyrillic → Latin per GOST 7.79-2000) using the `translit` crate

Multi-mirror support: `FL_SOURCES` accepts multiple entries; the backend tries each in order with fallback on failure.

### Frontend Structure (`frontend/public/`)

Single HTML page, ES modules, no bundler. Key files:
- **`app.js`** — Main entry: tab switching, search debounce, PWA install
- **`api.js`** — All `fetch()` calls to backend API
- **`ui.js`** — DOM rendering helpers
- **`sheet.js`** — Book detail modal (cover, format picker, download progress)
- **`history.js`** — localStorage persistence (max 30 entries, deduplication)
- **`sw.js`** — Service Worker for PWA offline support

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (no auth) |
| GET | `/metrics` | Prometheus metrics (no auth) |
| GET | `/api/search?q=<query>` | Search books/authors/series |
| GET | `/api/author/{id}` | List books by author |
| GET | `/api/series/{id}` | List books in series |
| GET | `/api/cover/{book_id}` | Proxy cover image |
| GET | `/api/filename/{book_id}/{file_type}` | Get transliterated filename |
| GET | `/api/download/{source_id}/{remote_id}/{file_type}` | Download book file |

### Key Data Types

Search results are polymorphic — the `/api/search` response includes items of type `book`, `author`, or `series`. Books carry `source_id` (which mirror) and `remote_id` (Flibusta internal ID).
