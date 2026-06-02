# Calibre Bridge

> Sync your [Calibre](https://calibre-ebook.com/) ebook library into [Obsidian](https://obsidian.md/) as clean, [Bases](https://help.obsidian.md/bases)-ready book notes — covers, ratings and reading status — with **two-way write-back** of ratings and status *back* into Calibre.

An Obsidian plugin for people who keep their ebooks in Calibre and their reading life in Obsidian. It turns each Calibre book into one Markdown note you can track, rate, and annotate, and (uniquely) can push your Obsidian-side ratings and shelf status back to the Calibre library.

> **Desktop only.** Calibre has no mobile build, so the sync runs on the desktop where Calibre lives. The notes it writes sync to your phone like any other notes (e.g. via Obsidian Sync).

## Why this exists

The Obsidian ecosystem has book plugins, but each fills only part of the gap:

- The only Calibre plugin in the community store is an **in-app reader** (an iframe over the Content Server) — it imports no metadata.
- The best metadata bridges talk to Calibre's **Content Server** (extra setup, must be running) and write only a binary `Read: true/false` — no real reading status, no ratings, no dates.
- **Nothing writes back.** Rate a book in Obsidian and Calibre never hears about it.

Calibre Bridge reads the library through the official **`calibredb` CLI** (no Content Server required, no SQLite parsing), writes a proper reading-tracker schema, and closes the loop with `calibredb set_metadata`.

## Features

- **One-command sync** — ribbon icon or command: pulls every book into `Reading/Books/<Title - Author>.md`.
- **Bases-ready frontmatter** — `status`, `rating` (5-star), `author` (wikilink), `series`, `isbn`, `published`, `format`, `genres`, `cover`, `calibre_uuid`.
- **Local covers** — copies each `cover.jpg` into the vault and links it from the `cover` property, so card views render offline.
- **Non-destructive upsert** — matches existing notes by `calibre_uuid` and refreshes only bibliographic fields. Your `status`, `started`, `finished`, notes and **`## Highlights`** are never touched.
- **Two-way write-back** — push Obsidian ratings (and optionally reading status, via a Calibre custom column) back into Calibre.
- **Sensible conflict model** — Calibre owns the bibliography; Obsidian owns your reading life (see below).
- **Local folder _or_ Content Server** — sync from the library path on disk, or from a running server (works while Calibre is open).

## How it works

```
Calibre library ──calibredb list --for-machine──▶ Calibre Bridge ──▶ Reading/Books/*.md  ──Obsidian Sync──▶ phone
       ▲                                                │
       └────────────── calibredb set_metadata ◀─────────┘  (write-back: ratings, status)
```

Reads go through `calibredb list --for-machine` (clean JSON, including identifiers and custom columns). Write-back uses `calibredb set_metadata`. Reads work even while Calibre holds the library lock; **write-back needs Calibre closed** (or use a Content Server with write access).

### Conflict model — who owns what

| Field | Owner | Behaviour on sync |
|---|---|---|
| title, author(s), series, publisher, published, isbn/asin, format, cover, genres, `calibre_*` | **Calibre** | Refreshed every sync |
| `rating` | **Shared** | Obsidian wins; an *empty* rating is filled from Calibre. Write-back pushes Obsidian → Calibre |
| `status`, `started`, `finished`, `page_current`, note body, `## Highlights` | **Obsidian** | Set once on create (`status: tbr`), then **never overwritten** |

## Install

### From source (current)
```bash
git clone https://github.com/caioniehues/obsidian-calibre-bridge
cd obsidian-calibre-bridge
npm install
npm run build
# copy main.js, manifest.json, styles.css into <vault>/.obsidian/plugins/calibre-bridge/
```
Then enable **Calibre Bridge** in *Settings → Community plugins*.

### Via BRAT
Add `caioniehues/obsidian-calibre-bridge` in [BRAT](https://github.com/TfTHacker/obsidian42-brat).

## Setup

1. *Settings → Calibre Bridge*:
   - **calibredb path** — usually `/opt/homebrew/bin/calibredb` (macOS, Homebrew) or inside the Calibre app bundle.
   - **Library source** — *Local folder* (set the path to the folder containing `metadata.db`) or *Content Server* (a URL).
   - **Books folder** — defaults to `Reading/Books`.
   - **Status custom column** *(optional)* — a Calibre custom column such as `#shelf` to receive write-back of reading status.
2. **Quit the Calibre app** (local-folder mode locks against a running GUI), then run **Sync library from Calibre** (ribbon or command palette).
3. Pair with a Bases view over `tags: book` for the dashboard (shelf board, currently-reading, read-by-year). See the schema below.

## Book-note schema

```yaml
type: book
status: tbr            # tbr | reading | read | dnf
rating:                # 1-5 (Calibre's 0-10 ÷ 2)
title: 
author: "[[Name]]"
series: 
pages: 
page_current: 0
isbn: 
format: epub
cover: "[[Reading/Books/covers/<slug>.jpg]]"
started: 
finished: 
source: calibre
calibre_id: 
calibre_uuid: 
genres: []
tags: [book]
```

## Commands

| Command | Action |
|---|---|
| **Sync library from Calibre** | Pull/refresh all books into notes |
| **Push ratings & status to Calibre (write-back)** | Send Obsidian ratings (and status, if a column is configured) back to Calibre |

## Roadmap

- [ ] Import Calibre viewer **highlights** (the `annotations` table) into each note's `## Highlights`.
- [ ] Per-book "open in Calibre" / "open file" actions via the `calibre://` URL scheme.
- [ ] Optional rename of notes when a Calibre title changes.
- [ ] Incremental sync (only books modified since last run).
- [ ] Submit to the Obsidian community store.

## License

MIT © Caio Niehues
