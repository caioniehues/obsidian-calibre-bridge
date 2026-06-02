import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** A normalized Calibre book record (subset of fields we map into notes). */
export interface CalibreBook {
	id: number;
	uuid: string;
	title: string;
	authors: string[];
	series?: string;
	series_index?: number;
	/** Calibre stores ratings 0-10 (half-star granularity). Divide by 2 for a 5-star scale. */
	rating?: number;
	tags: string[];
	identifiers: Record<string, string>;
	/** Absolute paths to the format files on disk. */
	formats: string[];
	/** Absolute path to cover.jpg, if the book has a cover. */
	cover?: string;
	pubdate?: string;
	publisher?: string;
	languages: string[];
	comments?: string;
}

/** Thrown when Calibre has the library locked (the GUI or a server is running). */
export class CalibreLockError extends Error {}
/** Thrown when the calibredb binary cannot be found. */
export class CalibreNotFoundError extends Error {}

/** Connection details for talking to a Calibre library via calibredb. */
export interface CalibreConnection {
	calibredbPath: string;
	libraryMode: "path" | "server";
	libraryPath: string;
	serverUrl: string;
	serverUser: string;
	serverPass: string;
}

const FIELDS = [
	"title",
	"authors",
	"series",
	"series_index",
	"rating",
	"tags",
	"identifiers",
	"formats",
	"cover",
	"pubdate",
	"publisher",
	"languages",
	"comments",
	"uuid",
].join(",");

function libraryArgs(c: CalibreConnection): string[] {
	if (c.libraryMode === "server") {
		const args = ["--with-library", c.serverUrl];
		if (c.serverUser) args.push("--username", c.serverUser);
		if (c.serverPass) args.push("--password", c.serverPass);
		return args;
	}
	return ["--with-library", c.libraryPath];
}

async function run(c: CalibreConnection, args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync(c.calibredbPath, [...args, ...libraryArgs(c)], {
			maxBuffer: 128 * 1024 * 1024,
		});
		return stdout;
	} catch (e: unknown) {
		const err = e as { stderr?: string; message?: string; code?: string };
		const msg = String(err.stderr || err.message || e);
		if (/Another calibre|is running|database is locked|locked/i.test(msg)) {
			throw new CalibreLockError(
				"Calibre is open and holding the library lock. Quit the Calibre app (or switch to server mode in settings), then retry.",
			);
		}
		if (err.code === "ENOENT") {
			throw new CalibreNotFoundError(
				`calibredb not found at "${c.calibredbPath}". Set the correct path in Calibre Bridge settings.`,
			);
		}
		throw new Error(msg.trim());
	}
}

/** List every book in the configured library as normalized records. */
export async function listBooks(c: CalibreConnection): Promise<CalibreBook[]> {
	const out = await run(c, ["list", "--for-machine", "--fields", FIELDS]);
	const raw = JSON.parse(out) as Record<string, unknown>[];
	return raw.map(normalizeBook);
}

/** Write a single metadata field back to Calibre. Requires the library NOT be locked. */
export async function setMetadataField(
	c: CalibreConnection,
	id: number,
	field: string,
	value: string,
): Promise<void> {
	await run(c, ["set_metadata", "--field", `${field}:${value}`, String(id)]);
}

function normalizeBook(r: Record<string, unknown>): CalibreBook {
	return {
		id: Number(r.id),
		uuid: r.uuid ? String(r.uuid) : "",
		title: r.title ? String(r.title) : "Untitled",
		authors: toList(r.authors),
		series: r.series ? String(r.series) : undefined,
		series_index: r.series_index != null ? Number(r.series_index) : undefined,
		rating: r.rating != null ? Number(r.rating) : undefined,
		tags: toList(r.tags),
		identifiers: parseIdentifiers(r.identifiers),
		formats: toList(r.formats),
		cover: r.cover ? String(r.cover) : undefined,
		pubdate: r.pubdate ? String(r.pubdate) : undefined,
		publisher: r.publisher ? String(r.publisher) : undefined,
		languages: toList(r.languages),
		comments: r.comments ? String(r.comments) : undefined,
	};
}

/** calibredb --for-machine returns arrays for list fields, but be defensive about strings too. */
function toList(v: unknown): string[] {
	if (v == null) return [];
	if (Array.isArray(v)) return v.map(String);
	return String(v)
		.split(/\s*&\s*|\s*,\s*/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Identifiers come back as an object map; tolerate the legacy "isbn:123,amazon:B0.." string too. */
function parseIdentifiers(v: unknown): Record<string, string> {
	if (!v) return {};
	if (typeof v === "object" && !Array.isArray(v)) {
		return v as Record<string, string>;
	}
	const out: Record<string, string> = {};
	for (const pair of String(v).split(",")) {
		const i = pair.indexOf(":");
		if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
	}
	return out;
}
