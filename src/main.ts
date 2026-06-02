import { Notice, Plugin } from "obsidian";
import { CalibreLockError, CalibreNotFoundError } from "./calibre";
import {
	CalibreBridgeSettings,
	CalibreBridgeSettingTab,
	DEFAULT_SETTINGS,
} from "./settings";
import { SyncEngine } from "./sync";

export default class CalibreBridgePlugin extends Plugin {
	settings!: CalibreBridgeSettings;
	private syncing = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon("library", "Sync Calibre → Obsidian", () => this.runSync());

		this.addCommand({
			id: "sync-from-calibre",
			name: "Sync library from Calibre",
			callback: () => this.runSync(),
		});

		this.addCommand({
			id: "push-to-calibre",
			name: "Push ratings & status to Calibre (write-back)",
			callback: () => this.runPush(),
		});

		this.addSettingTab(new CalibreBridgeSettingTab(this.app, this));
	}

	private engine(): SyncEngine {
		return new SyncEngine(this.app, this.settings);
	}

	private async runSync(): Promise<void> {
		if (this.syncing) {
			new Notice("Calibre Bridge: a sync is already running.");
			return;
		}
		const engine = this.engine();
		if (!engine.usesLocalAdapter()) {
			new Notice("Calibre Bridge is desktop-only — it can't reach Calibre on this device.");
			return;
		}
		if (!engine.hasValidLibraryConfig()) {
			new Notice("Calibre Bridge: set your Calibre library path in settings first.", 6000);
			return;
		}

		this.syncing = true;
		const notice = new Notice("Calibre Bridge: syncing…", 0);
		try {
			const r = await engine.syncFromCalibre();
			notice.hide();
			const parts = [`${r.created} new`, `${r.updated} updated`, `${r.coversCopied} covers`];
			new Notice(`Calibre Bridge: ${parts.join(" · ")}.`, 5000);
			if (r.errors.length) {
				console.error("Calibre Bridge sync errors:", r.errors);
				new Notice(`Calibre Bridge: ${r.errors.length} book(s) had errors (see console).`, 7000);
			}
		} catch (e: unknown) {
			notice.hide();
			this.reportError(e);
		} finally {
			this.syncing = false;
		}
	}

	private async runPush(): Promise<void> {
		const engine = this.engine();
		if (!engine.usesLocalAdapter()) {
			new Notice("Calibre Bridge is desktop-only — write-back needs the Mac.");
			return;
		}
		const notice = new Notice("Calibre Bridge: pushing to Calibre…", 0);
		try {
			const r = await engine.pushToCalibre();
			notice.hide();
			new Notice(`Calibre Bridge: pushed ${r.pushed} book(s) to Calibre.`, 5000);
			if (r.errors.length) {
				console.error("Calibre Bridge write-back errors:", r.errors);
				new Notice(`Calibre Bridge: write-back stopped — ${r.errors[0]}`, 8000);
			}
		} catch (e: unknown) {
			notice.hide();
			this.reportError(e);
		}
	}

	private reportError(e: unknown): void {
		if (e instanceof CalibreLockError || e instanceof CalibreNotFoundError) {
			new Notice(`Calibre Bridge: ${e.message}`, 9000);
		} else {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("Calibre Bridge error:", e);
			new Notice(`Calibre Bridge failed: ${msg}`, 9000);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
