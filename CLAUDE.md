# Calibre Bridge — project guide for Claude Code

An Obsidian **desktop** plugin (TypeScript) that syncs a Calibre ebook library into
Bases-ready book notes and writes ratings/status **back** to Calibre. Built 2026-06-02.
Public repo: https://github.com/caioniehues/obsidian-calibre-bridge · companion vault
system documented in `SecondBrain/Reference/calibre-obsidian-reading-system-2026.md`.

## Commands

```bash
npm install            # deps (obsidian types, esbuild, typescript)
npm run dev            # esbuild watch → rebuilds main.js on save
npm run build          # tsc --noEmit typecheck + production esbuild → main.js
```

There is **no test runner** yet. Verify by: (1) `npm run build` is green, and (2) a real
sync (see "Testing" below). Lint/format: none configured — match the existing style.

### Install the build into the test vault
The dev vault is `~/SecondBrain`. After a build, copy the three runtime files in:
```bash
cp main.js manifest.json styles.css ~/SecondBrain/.obsidian/plugins/calibre-bridge/
# then reload Obsidian (Cmd+R) to pick up changes
```

### Cut a release (how the plugin is actually distributed)
`main.js` is **gitignored** — it ships via GitHub Releases (this is what BRAT and the
community store consume; do NOT commit the build artifact to source).
```bash
npm version patch                 # bumps package.json + (via version-bump.mjs) manifest.json & versions.json, tags
git push --follow-tags
gh release create vX.Y.Z main.js manifest.json styles.css --title "vX.Y.Z" --notes "..."
```

## Architecture

One responsibility per module — keep it that way.

| File | Responsibility |
|---|---|
| `src/main.ts` | Plugin entry: settings load, ribbon icon, 2 commands, friendly `Notice` error handling. Thin — delegates to `SyncEngine`. |
| `src/calibre.ts` | The **only** place that shells out to `calibredb` (`execFile`). Normalizes `--for-machine` JSON into `CalibreBook`. Throws typed `CalibreLockError` / `CalibreNotFoundError`. |
| `src/sync.ts` | `SyncEngine` — the core: upsert notes by `calibre_uuid`, copy covers, apply the conflict model, write-back. No Obsidian-UI concerns. |
| `src/settings.ts` | `CalibreBridgeSettings` interface, `DEFAULT_SETTINGS`, and the settings tab UI. |

## Load-bearing design decisions (don't quietly reverse these)

1. **Shell out to `calibredb`; never parse `metadata.db` directly.** Avoids bundling a WASM
   SQLite or a native module (won't load in Electron). The official CLI gives us identifiers
   + custom columns for free, and the symmetric `set_metadata` write-back path.
2. **`isDesktopOnly: true`.** We use Node `fs` + `child_process`, which only exist on desktop.
   Calibre itself is desktop-only, so this is inherent, not a limitation to "fix."
3. **Non-destructive upsert, matched on `calibre_uuid`.** Use `app.fileManager.processFrontMatter`
   to rewrite ONLY Calibre-owned keys. Never use `vault.modify` on a whole note (it would
   clobber the body / `## Highlights`).
4. **The conflict model is the contract** (see below). New behaviour must respect who owns what.

### Conflict model — who owns which frontmatter

| Field | Owner | On sync |
|---|---|---|
| title, author(s), series, publisher, published, isbn/asin, format, cover, genres, `calibre_*` | **Calibre** | overwritten every sync |
| `rating` | **shared** | Obsidian wins; an *empty* rating is filled from Calibre; write-back pushes Obsidian → Calibre |
| `status`, `started`, `finished`, `page_current`, note body, `## Highlights` | **Obsidian** | set once on create (`status: tbr`), then **never touched** |

## Gotchas (verified on the author's Mac)

- **`calibredb` exits 1 + stderr "Another calibre … is running" when the GUI is open.** Reads
  and write-back both fail while locked. `calibre.ts` detects this → `CalibreLockError` →
  the user is told to quit Calibre. Server mode (`--with-library <url>`) works while open.
- **Ratings are 0–10 in Calibre** (half-star granularity). Divide by 2 for the 5-star `rating`;
  multiply by 2 on write-back.
- **`calibredb` path:** `/opt/homebrew/bin/calibredb` (Homebrew) → symlinks into the app bundle.
- **Two libraries exist** (`~/Calibre Library`, `~/Documents/Calibre Library`) — always pass the
  configured `--with-library`; never assume the default.
- **`identifiers` is an object** in `--for-machine` JSON; `authors`/`tags`/`formats` are arrays.
  `calibre.ts` is defensive about string fallbacks anyway.

## Conventions

- TypeScript `strict: true`. Prefer typed errors over string matching across module boundaries.
- esbuild externals: `obsidian`, `electron`, and Node builtins (see `esbuild.config.mjs`).
- Don't add runtime deps lightly — the value of this plugin is zero binary dependencies.
- New settings → add to the interface, `DEFAULT_SETTINGS`, AND the settings tab.

## Roadmap (open work)

- Import Calibre viewer **highlights** (`annotations` table) into each note's `## Highlights`.
- Incremental sync (only books modified since last run).
- Optional note rename when a Calibre title changes.
- Community-store submission (this is a job-search portfolio piece — keep it polished).
