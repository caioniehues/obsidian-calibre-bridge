import { App, PluginSettingTab, Setting } from "obsidian";
import type CalibreBridgePlugin from "./main";

export interface CalibreBridgeSettings {
	/** Absolute path to the calibredb binary. */
	calibredbPath: string;
	/** Read the library from a local path, or from a running Content Server. */
	libraryMode: "path" | "server";
	/** Absolute path to the Calibre library folder (the one containing metadata.db). */
	libraryPath: string;
	/** Content Server URL, e.g. http://localhost:8080#Calibre_Library */
	serverUrl: string;
	serverUser: string;
	serverPass: string;
	/** Vault-relative folder that holds the per-book notes. */
	booksFolder: string;
	/** Sub-folder (under booksFolder) for downloaded cover images. */
	coversSubfolder: string;
	/** If true, fill an empty `rating` from Calibre on sync (Obsidian still wins if already set). */
	fillRatingFromCalibre: boolean;
	/** Optional Calibre custom column (e.g. "#shelf") to push reading status back into. Blank = don't. */
	statusColumn: string;
}

export const DEFAULT_SETTINGS: CalibreBridgeSettings = {
	calibredbPath: "/opt/homebrew/bin/calibredb",
	libraryMode: "path",
	libraryPath: "",
	serverUrl: "http://localhost:8080",
	serverUser: "",
	serverPass: "",
	booksFolder: "Reading/Books",
	coversSubfolder: "covers",
	fillRatingFromCalibre: true,
	statusColumn: "",
};

export class CalibreBridgeSettingTab extends PluginSettingTab {
	plugin: CalibreBridgePlugin;

	constructor(app: App, plugin: CalibreBridgePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private heading(text: string): void {
		this.containerEl.createEl("div", { text, cls: "calibre-bridge-section-heading" });
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.heading("Calibre");

		new Setting(containerEl)
			.setName("calibredb path")
			.setDesc("Absolute path to the calibredb binary (ships inside the Calibre app).")
			.addText((t) =>
				t
					.setPlaceholder("/opt/homebrew/bin/calibredb")
					.setValue(this.plugin.settings.calibredbPath)
					.onChange(async (v) => {
						this.plugin.settings.calibredbPath = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Library source")
			.setDesc("Read from the local library folder, or from a running Calibre Content Server.")
			.addDropdown((d) =>
				d
					.addOption("path", "Local folder")
					.addOption("server", "Content Server (URL)")
					.setValue(this.plugin.settings.libraryMode)
					.onChange(async (v) => {
						this.plugin.settings.libraryMode = v as "path" | "server";
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.libraryMode === "path") {
			new Setting(containerEl)
				.setName("Library folder")
				.setDesc("Absolute path to the Calibre library (the folder containing metadata.db). Quit the Calibre app before syncing, or it will hold the library locked.")
				.addText((t) =>
					t
						.setPlaceholder(`${process.env.HOME ?? "/Users/you"}/Calibre Library`)
						.setValue(this.plugin.settings.libraryPath)
						.onChange(async (v) => {
							this.plugin.settings.libraryPath = v.trim();
							await this.plugin.saveSettings();
						}),
				);
		} else {
			new Setting(containerEl)
				.setName("Server URL")
				.setDesc("e.g. http://localhost:8080 (append #Library_Id if you have multiple libraries). Works while Calibre is open.")
				.addText((t) =>
					t
						.setPlaceholder("http://localhost:8080")
						.setValue(this.plugin.settings.serverUrl)
						.onChange(async (v) => {
							this.plugin.settings.serverUrl = v.trim();
							await this.plugin.saveSettings();
						}),
				);
			new Setting(containerEl).setName("Server username").addText((t) =>
				t.setValue(this.plugin.settings.serverUser).onChange(async (v) => {
					this.plugin.settings.serverUser = v.trim();
					await this.plugin.saveSettings();
				}),
			);
			new Setting(containerEl).setName("Server password").addText((t) => {
				t.inputEl.type = "password";
				t.setValue(this.plugin.settings.serverPass).onChange(async (v) => {
					this.plugin.settings.serverPass = v;
					await this.plugin.saveSettings();
				});
			});
		}

		this.heading("Notes");

		new Setting(containerEl)
			.setName("Books folder")
			.setDesc("Vault-relative folder for the per-book notes.")
			.addText((t) =>
				t
					.setPlaceholder("Reading/Books")
					.setValue(this.plugin.settings.booksFolder)
					.onChange(async (v) => {
						this.plugin.settings.booksFolder = v.trim().replace(/\/+$/, "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Covers sub-folder")
			.setDesc("Sub-folder (inside the books folder) where cover images are saved.")
			.addText((t) =>
				t
					.setPlaceholder("covers")
					.setValue(this.plugin.settings.coversSubfolder)
					.onChange(async (v) => {
						this.plugin.settings.coversSubfolder = v.trim().replace(/^\/+|\/+$/g, "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Fill rating from Calibre")
			.setDesc("On sync, set an empty rating from Calibre's. A rating already set in Obsidian always wins.")
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.fillRatingFromCalibre).onChange(async (v) => {
					this.plugin.settings.fillRatingFromCalibre = v;
					await this.plugin.saveSettings();
				}),
			);

		this.heading("Write-back (Obsidian → Calibre)");

		new Setting(containerEl)
			.setName("Status custom column")
			.setDesc('Optional. A Calibre custom column to push reading status into, e.g. "#shelf". Leave blank to skip status write-back (ratings still push back). Create the column in Calibre first.')
			.addText((t) =>
				t
					.setPlaceholder("#shelf")
					.setValue(this.plugin.settings.statusColumn)
					.onChange(async (v) => {
						this.plugin.settings.statusColumn = v.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
