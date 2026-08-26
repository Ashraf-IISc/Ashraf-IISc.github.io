# Portfolio + Grimoire

Production-grade dual-tier personal platform:

- Public portfolio and CV surface for GitHub Pages
- Private authenticated research node running locally with Flask and SQLite

## 1. System Architecture and Overview

This repository is intentionally split into two runtime layers.

### Public Tier: Portfolio Surface

- Entry point: index.html
- Deployment target: GitHub Pages
- Purpose: personal academic profile, projects, CV showcase, and controlled launch point into the private node

### Private Tier: Grimoire Node

- Entry point: app.py
- Stack: Flask, SQLite, authenticated user system, Markdown journaling workflow
- Role: secure local research log with day-based writes, tag priority management, and archival journal browsing

### Bridge Layer: Controlled Remote Access

- Tunnel binary: cloudflared-windows-amd64.exe
- Dead-drop source of truth: GitHub Gist URL record updated by backend lifecycle hooks
- Startup and shutdown behaviors:
    - On startup, tunnel URL is discovered and published
    - On shutdown, URL is reset to OFFLINE and tunnel processes are cleaned

### Runtime Flow

GitHub Pages portfolio
-> secret trigger
-> dead-drop URL lookup
-> Cloudflare Tunnel URL
-> local Flask app
-> SQLite database

## 2. Project Structure Map

Top-level map with purpose of key files and directories.

- index.html
    - Public academic portfolio and CV-facing page
- app.py
    - Main Flask application, authentication routes, journaling API, tag management, tunnel lifecycle
- init_db.py
    - Database bootstrap helper for schema initialization
- check_users.py
    - User audit script for inspecting current users and password hash presence
- generate_pdf.py
    - Playwright automation for generating Ayan_Ashraf_CV.pdf
- templates/
    - auth.html: login, register, credential-change views
    - tracker.html: main Grimoire interface shell
- static/css/
    - style.css: application styling system
    - easymde.min.css: editor styling
- static/js/
    - main.js: client runtime, fetch pipeline, drag-and-drop persistence, Markdown rendering orchestration
    - easymde.min.js: Markdown editor runtime
    - marked.min.js: Markdown parsing and render support
    - Sortable.min.js: drag-and-drop ordering behavior
- token.txt
    - local GitHub token source for dead-drop updates
- database.db
    - primary runtime SQLite database
- database_backup.db
    - optional backup snapshot
- cloudflared-windows-amd64.exe
    - local Cloudflare tunnel executable
- webfilesv0/, webfilesv1/, webfilesv2/
    - historical backup snapshots

## 3. Prerequisites and Environment Setup

### Required

- Python 3.10+
- Windows PowerShell environment
- pip
- Cloudflare tunnel executable for remote exposure workflow

### Environment Setup

1. Create and activate virtual environment.

     python -m venv venv
     .\venv\Scripts\Activate.ps1

2. Install Python dependencies.

     pip install flask requests playwright werkzeug

3. Install Playwright browser runtime.

     python -m playwright install chromium

4. Initialize database schema.

     python init_db.py

5. Start the backend.

     python app.py

Local endpoint defaults to http://127.0.0.1:5000.

## 4. Working with the Codebase (Developer Workflow)

This section is the primary operational guide for active development.

### A. Database Lifecycle

#### Initialize

- Run init_db.py to create required tables and additive fields.
- Script delegates to application schema logic so schema remains centralized.

Command:

python init_db.py

#### Inspect users

- Use check_users.py to list user IDs, usernames, and abbreviated password-hash previews.
- Useful for local audit and account verification during auth testing.

Command:

python check_users.py

#### Locking and timeout strategy

- SQLite connections are configured with timeout=10 to reduce lock contention under rapid writes.
- Keep writes short-lived and close connections promptly.
- If you add new connection points, preserve timeout=10 and row factory conventions.

#### Migration hygiene

- Prefer additive migrations that tolerate existing schema.
- Follow existing pattern: guarded ALTER TABLE wrapped in OperationalError handling.
- Back up database.db before structural changes.

### B. Local Development Loop

#### Mode 1: Local Flask loop without tunnel dependency

- Run python app.py and work against local endpoint only.
- If cloudflared executable is missing, startup will continue while tunnel launch is skipped gracefully.
- Best mode for UI and API iteration without remote exposure.

#### Mode 2: Full stack with tunnel automation

- Ensure cloudflared-windows-amd64.exe and token.txt are present.
- Run python app.py.
- Backend will:
    - clear stale tunnel state
    - launch tunnel process
    - detect generated trycloudflare URL
    - publish URL to dead-drop gist

#### Shutdown behavior

- On exit/signals, backend resets dead-drop to OFFLINE and tears down tunnel processes.
- Keep this lifecycle intact if editing tunnel orchestration logic.

### C. Frontend Development

#### Template layer

- templates/auth.html controls auth entry, registration, and credential-change flow.
- templates/tracker.html provides application shell and injects runtime data into window.GRIMOIRE_ENV.

#### Styling layer

- Primary styles are in static/css/style.css.
- Keep sectioned structure and naming consistent for maintainability.

#### Client runtime

- static/js/main.js handles:
    - resilient backend request flow
    - calendar rendering and updates
    - tag interactions and drag-and-drop persistence
    - journal rendering from Markdown

#### Libraries used by the UI

- Sortable.js: tag priority drag-and-drop reorder behavior
- marked.js: Markdown to HTML rendering in journal view
- EasyMDE: Markdown editing experience for entries and footnotes

### D. PDF Generation Workflow

- generate_pdf.py launches headless Chromium via Playwright.
- It opens local index.html and exports Ayan_Ashraf_CV.pdf.

Command:

python generate_pdf.py

Validation checklist:

- Ensure output file is regenerated
- Confirm print-specific styles are reflected
- Verify links/layout remain readable in A4 format

## 5. Secrets and Security Configuration

### Sensitive files

- token.txt must stay local
- database.db and database_backup.db contain private data

### Ignore policy

Root ignore rules protect:

- token.txt
- database.db
- database_backup.db
- cloudflared-windows-amd64.exe
- venv/
- all __pycache__/ directories
- Ayan_Ashraf_CV.pdf
- webfilesv0/, webfilesv1/, webfilesv2/

### Security guidance

- Never commit tokens, local binaries, or runtime databases.
- Rotate GitHub token immediately if exposure is suspected.
- Keep dead-drop target private and monitor unusual updates.
- Use strong credentials for local user accounts.

## 6. License

MIT License.

See LICENSE for full text.
