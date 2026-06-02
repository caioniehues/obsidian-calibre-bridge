import { App, FileSystemAdapter, normalizePath, TFile } from "obsidian";
import { existsSync, readFileSync } from "fs";
import { extname } from "path";
import {
	CalibreBook,
	CalibreConnection,
	listBooks,
	setMetadataField,
} from "./calibre";
import { CalibreBridgeSettings } from "./settings";

export interface SyncResult {
	created: number;
	updated: number;
	coversCopied: number;
	errors: string[];
}

export interface PushResult {
	pushed: number;
	errors: string[];
}

const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

const BODY_SKELETON = (today: string) =>
	[
		"",
		"## Notes",
		"",
		"<!-- Your thoughts while reading. -->",
		"",
		"## Highlights",
		"",
		"<!-- Pasted/synced highlights. Keep them below this line so re-syncs never clobber your notes above. -->",
		"",
		"## Log",
		"",
		`- ${today} imported from Calibre`,
		"",
	].join("\n");

export class SyncEngine {
	constructor(
		private app: App,
		private settings: CalibreBridgeSettings,
	) {}

	private conn(): CalibreConnection {
		return {
			calibredbPath: this.settings.calibredbPath,
			libraryMode: this.settings.libraryMode,
			libraryPath: this.settings.libraryPath,
			serverUrl: this.settings.serverUrl,
			serverUser: this.settings.serverUser,
			serverPass: this.settings.serverPass,
		};
	}

	private get booksFolder(): string {
		return normalizePath(this.settings.booksFolder);
	}

	private get coversFolder(): string {
		return normalizePath(`${this.settings.booksFolder}/${this.settings.coversSubfolder}`);
	}

	/** Pull the whole Calibre library into book notes (create new, update existing by uuid). */
	async syncFromCalibre(): Promise<SyncResult> {
		const result: SyncResult = { created: 0, updated: 0, coversCopied: 0, errors: [] };
		const books = await listBooks(this.conn());

		await this.ensureFolder(this.booksFolder);
		await this.ensureFolder(this.coversFolder);

		const byUuid = this.indexExistingByUuid();
		const usedPaths = new Set<string>();

		for (const book of books) {
			try {
				const slug = this.slug(book);
				const coverLink = await this.copyCover(book, slug, result);
				const existing = book.uuid ? byUuid.get(book.uuid) : undefined;

				if (existing) {
					await this.app.fileManager.processFrontMatter(existing, (fm) =>
						this.applyManaged(fm, book, coverLink, false),
					);
					result.updated++;
				} else {
					await this.createNote(book, slug, coverLink, usedPaths);
					result.created++;
				}
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				result.errors.push(`${book.title}: ${msg}`);
			}
		}
		return result;
	}

	/** Push ratings (and optionally status) from book notes back into Calibre. */
	async pushToCalibre(): Promise<PushResult> {
		const result: PushResult = { pushed: 0, errors: [] };
		const conn = this.conn();
		const statusCol = this.settings.statusColumn.trim();

		for (const file of this.bookNotes()) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const id = fm?.calibre_id;
			if (fm == null || id == null) continue;
			try {
				if (fm.rating != null && fm.rating !== "") {
					const calRating = Math.round(Number(fm.rating) * 2);
					await setMetadataField(conn, Number(id), "rating", String(calRating));
				}
				if (statusCol && fm.status) {
					await setMetadataField(conn, Number(id), statusCol, String(fm.status));
				}
				result.pushed++;
			} catch (e: unknown) {
				// Surface the first lock/error and stop hammering calibredb.
				const msg = e instanceof Error ? e.message : String(e);
				result.errors.push(`${file.basename}: ${msg}`);
				break;
			}
		}
		return result;
	}

	// --- internals -------------------------------------------------------

	/** Map a Calibre record onto the managed frontmatter keys, preserving user-owned fields. */
	private applyManaged(
		fm: Record<string, unknown>,
		book: CalibreBook,
		coverLink: string | undefined,
		creating: boolean,
	): void {
		// Calibre-owned bibliographic fields — always refreshed.
		fm.type = "book";
		fm.title = book.title;
		if (book.authors.length) fm.author = `[[${book.authors[0]}]]`;
		if (book.authors.length > 1) fm.authors = book.authors;
		if (book.series) {
			fm.series = book.series;
			if (book.series_index != null) fm.series_index = book.series_index;
		}
		if (book.publisher) fm.publisher = book.publisher;
		const published = formatPubdate(book.pubdate);
		if (published) fm.published = published;
		if (book.formats.length) {
			fm.format = extname(book.formats[0]).replace(".", "").toLowerCase();
		}
		const ids = book.identifiers;
		if (ids.isbn) fm.isbn = ids.isbn;
		if (ids.amazon || ids.asin) fm.asin = ids.amazon ?? ids.asin;
		fm.calibre_id = book.id;
		if (book.uuid) fm.calibre_uuid = book.uuid;
		if (coverLink) fm.cover = coverLink;
		if (book.tags.length) fm.genres = book.tags;

		// tags — keep the graph clean: never import Calibre subject tags into `tags`.
		const tags = new Set<string>(asArray(fm.tags));
		tags.add("book");
		fm.tags = [...tags];

		// rating — Obsidian wins; only fill an empty value from Calibre.
		const calRating = book.rating != null ? book.rating / 2 : undefined;
		if (creating) {
			fm.rating = calRating ?? null;
		} else if (
			this.settings.fillRatingFromCalibre &&
			(fm.rating == null || fm.rating === "") &&
			calRating != null
		) {
			fm.rating = calRating;
		}

		// Obsidian-owned reading state — defaults on create, NEVER overwritten afterwards.
		if (creating) {
			fm.status = "tbr";
			fm.page_current = 0;
			fm.source = "calibre";
			if (!("started" in fm)) fm.started = null;
			if (!("finished" in fm)) fm.finished = null;
			if (!("pages" in fm)) fm.pages = null;
		}
		if (!("cssclasses" in fm)) fm.cssclasses = ["anp-bold-lavender"];
	}

	private async createNote(
		book: CalibreBook,
		slug: string,
		coverLink: string | undefined,
		usedPaths: Set<string>,
	): Promise<void> {
		let path = normalizePath(`${this.booksFolder}/${slug}.md`);
		// Avoid clobbering an unrelated note that happens to share the name.
		if (usedPaths.has(path) || this.app.vault.getAbstractFileByPath(path)) {
			path = normalizePath(`${this.booksFolder}/${slug} (${book.id}).md`);
		}
		usedPaths.add(path);

		const today = todayISO();
		const file = await this.app.vault.create(path, BODY_SKELETON(today));
		await this.app.fileManager.processFrontMatter(file, (fm) =>
			this.applyManaged(fm, book, coverLink, true),
		);
	}

	/** Copy the Calibre cover into the vault and return a wikilink for the `cover` property. */
	private async copyCover(
		book: CalibreBook,
		slug: string,
		result: SyncResult,
	): Promise<string | undefined> {
		if (!book.cover || !existsSync(book.cover)) return undefined;
		const ext = extname(book.cover).toLowerCase() || ".jpg";
		const vaultPath = normalizePath(`${this.coversFolder}/${slug}${ext}`);
		try {
			const buf = readFileSync(book.cover);
			const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
			await this.app.vault.adapter.writeBinary(vaultPath, ab);
			result.coversCopied++;
			return `[[${vaultPath}]]`;
		} catch {
			return undefined;
		}
	}

	private indexExistingByUuid(): Map<string, TFile> {
		const map = new Map<string, TFile>();
		for (const file of this.bookNotes()) {
			const uuid = this.app.metadataCache.getFileCache(file)?.frontmatter?.calibre_uuid;
			if (uuid) map.set(String(uuid), file);
		}
		return map;
	}

	private bookNotes(): TFile[] {
		const prefix = this.booksFolder + "/";
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(prefix) && !f.path.startsWith(this.coversFolder + "/"));
	}

	private slug(book: CalibreBook): string {
		const author = book.authors[0] ? ` - ${book.authors[0]}` : "";
		return `${book.title}${author}`
			.replace(ILLEGAL, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 180);
	}

	private async ensureFolder(path: string): Promise<void> {
		if (!(await this.app.vault.adapter.exists(path))) {
			await this.app.vault.createFolder(path);
		}
	}

	/** Confirm the configured library is reachable (used for a friendlier first-run error). */
	hasValidLibraryConfig(): boolean {
		if (this.settings.libraryMode === "server") return !!this.settings.serverUrl;
		const p = this.settings.libraryPath;
		return !!p && existsSync(p);
	}

	usesLocalAdapter(): boolean {
		return this.app.vault.adapter instanceof FileSystemAdapter;
	}
}

/** Local-time YYYY-MM-DD (avoids the UTC off-by-a-day of toISOString near midnight). */
function todayISO(): string {
	const d = new Date();
	const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
	return local.toISOString().slice(0, 10);
}

function asArray(v: unknown): string[] {
	if (Array.isArray(v)) return v.map(String);
	if (v == null || v === "") return [];
	return [String(v)];
}

/** Calibre uses 0101-01-01 for "no date"; only accept plausible publication years. */
function formatPubdate(pubdate?: string): string | undefined {
	if (!pubdate) return undefined;
	const d = pubdate.slice(0, 10);
	const year = Number(d.slice(0, 4));
	if (!Number.isFinite(year) || year < 1450 || year > 2200) return undefined;
	return d;
}
