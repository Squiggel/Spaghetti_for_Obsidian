// main.ts
import {
	Plugin,
	ItemView,
	WorkspaceLeaf,
	Notice,
	TFile,
	normalizePath,
	setIcon,
	addIcon
} from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, SystemExplorerSettingTab } from './settings';

// Node and Electron modules
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// @ts-ignore
import { shell } from 'electron'; 

const EXPLORER_VIEW_TYPE = 'custom-system-explorer-view';

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new SystemExplorerSettingTab(this.app, this));

		this.registerView(
			EXPLORER_VIEW_TYPE,
			(leaf) => new SystemFileExplorerView(leaf, this)
		);

		// 1. Define your custom SVG string (copied directly from your HTML, excluding the wrapper)
		const NOODLE_ICON_SVG = `<svg viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<linearGradient id="box" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe38b"/><stop offset=".55" stop-color="#f7c75b"/><stop offset="1" stop-color="#e9a63e"/></linearGradient>
				<linearGradient id="boxLight" x1="0" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset="1" stop-color="#f4c85c"/></linearGradient>
				<linearGradient id="sauce" x1="0" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="#f04428"/><stop offset=".55" stop-color="#d92d1f"/><stop offset="1" stop-color="#b51e18"/></linearGradient>
				<linearGradient id="meat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a75c43"/><stop offset="1" stop-color="#633327"/></linearGradient>
				<filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="5" flood-color="#40170c" flood-opacity=".35"/></filter>
			</defs>
			<path d="M52 145 L354 25 Q380 15 389 42 L404 96 L91 235 Z" fill="url(#boxLight)" stroke="#542010" stroke-width="7" stroke-linejoin="round"/>
			<path d="M47 153 Q43 140 58 132 L350 27 Q375 17 386 42 L401 105 L91 248 Z" fill="url(#box)" stroke="#542010" stroke-width="6"/>
			<g fill="none" stroke="#4e2113" stroke-width="15" stroke-linecap="round">
				<path d="M91 251 C80 192 157 157 216 188 C276 220 318 179 373 143 C423 110 472 133 464 179 C458 211 423 227 388 215"/>
				<path d="M102 275 C70 224 116 180 180 190 C245 201 264 238 321 211 C380 182 423 149 453 173 C480 196 456 231 420 235"/>
				<path d="M105 310 C66 276 76 227 125 214 C175 201 202 245 246 253 C303 264 329 215 375 205 C421 194 451 218 438 252 C426 282 387 278 363 263"/>
				<path d="M98 342 C61 315 64 269 102 251 C145 231 179 275 207 295 C243 321 282 314 310 286 C343 253 390 244 415 271 C442 299 418 329 386 328"/>
				<path d="M106 377 C66 360 66 315 95 294 C126 272 157 312 178 335 C210 370 245 363 269 333 C298 297 349 290 375 318 C397 343 382 374 348 375"/>
			</g>
			<g fill="none" stroke="#ffe99a" stroke-width="7" stroke-linecap="round">
				<path d="M91 251 C80 192 157 157 216 188 C276 220 318 179 373 143 C423 110 472 133 464 179"/>
				<path d="M102 275 C70 224 116 180 180 190 C245 201 264 238 321 211"/>
				<path d="M105 310 C66 276 76 227 125 214 C175 201 202 245 246 253"/>
				<path d="M98 342 C61 315 64 269 102 251"/>
				<path d="M106 377 C66 360 66 315 95 294"/>
			</g>
			<path d="M92 221 C123 196 159 206 187 194 C218 181 246 177 278 187 C307 196 334 184 360 176 C388 168 414 180 408 202 C402 221 380 226 365 240 C350 254 353 279 331 292 C308 306 286 294 270 306 C247 324 214 310 195 319 C169 331 141 317 125 303 C108 288 82 276 78 254 C75 240 81 230 92 221Z" fill="url(#sauce)" stroke="#511b12" stroke-width="8" stroke-linejoin="round" filter="url(#shadow)"/>
			<path d="M270 298 C272 319 283 330 295 326 C306 322 304 305 303 293" fill="#c3261c" stroke="#511b12" stroke-width="6"/>
			<path d="M151 300 C150 321 158 330 169 327 C179 324 176 308 174 298" fill="#c3261c" stroke="#511b12" stroke-width="5"/>
			<g fill="none" stroke="#ff7655" stroke-linecap="round">
				<path d="M116 247 C132 237 145 239 159 237" stroke-width="9"/>
				<path d="M222 208 C234 202 246 201 257 202" stroke-width="7"/>
				<path d="M316 236 C325 230 331 222 334 215" stroke-width="8"/>
				<path d="M179 275 C184 269 188 262 190 256" stroke-width="6"/>
			</g>
			<g stroke="#4c2118" stroke-width="7">
				<circle cx="130" cy="218" r="25" fill="url(#meat)"/>
				<circle cx="223" cy="259" r="27" fill="url(#meat)"/>
				<circle cx="294" cy="168" r="26" fill="url(#meat)"/>
			</g>
			<g fill="#572b21">
				<circle cx="119" cy="211" r="3"/><circle cx="137" cy="225" r="3"/><circle cx="128" cy="231" r="2.5"/><circle cx="143" cy="207" r="2.5"/>
				<circle cx="212" cy="252" r="3"/><circle cx="230" cy="264" r="3"/><circle cx="221" cy="273" r="2.5"/><circle cx="239" cy="247" r="2.5"/>
				<circle cx="283" cy="160" r="3"/><circle cx="302" cy="173" r="3"/><circle cx="291" cy="181" r="2.5"/><circle cx="309" cy="157" r="2.5"/>
			</g>
			<g fill="#d18061"><circle cx="122" cy="203" r="4"/><circle cx="216" cy="244" r="4"/><circle cx="286" cy="153" r="4"/></g>
			<g fill="#49b93b" stroke="#3c2115" stroke-width="6">
				<ellipse cx="176" cy="210" rx="13" ry="8" transform="rotate(-10 176 210)"/>
				<ellipse cx="264" cy="207" rx="13" ry="8" transform="rotate(-45 264 207)"/>
			</g>
			<path d="M161 319 L478 160 Q487 156 484 177 L434 380 Q431 395 418 402 L116 493 Q101 498 105 479 L151 338 Q154 326 161 319Z" fill="url(#box)" stroke="#542010" stroke-width="7" stroke-linejoin="round"/>
			<path d="M170 333 L466 184 L421 370 Q419 381 408 386 L130 472 L170 333Z" fill="#ffd975" opacity=".72"/>
			<path d="M190 350 L433 225" fill="none" stroke="#ffe89a" stroke-width="10" stroke-linecap="round" opacity=".65"/>
			<path d="M273 294 C248 311 233 332 226 351 C219 370 225 386 239 391 C254 397 258 382 253 365 C248 346 258 329 275 318" fill="none" stroke="#542010" stroke-width="13" stroke-linecap="round"/>
			<path d="M273 294 C248 311 233 332 226 351 C219 370 225 386 239 391 C254 397 258 382 253 365 C248 346 258 329 275 318" fill="none" stroke="#ffe89b" stroke-width="7" stroke-linecap="round"/>
			<g fill="none" stroke="#542010" stroke-width="13" stroke-linecap="round">
				<path d="M68 286 C44 308 51 343 81 350 C111 357 126 331 111 312"/>
				<path d="M72 355 C44 378 51 411 81 419 C107 426 121 403 107 385"/>
				<path d="M95 411 C69 437 78 464 102 469 C126 474 137 451 123 435"/>
			</g>
			<g fill="none" stroke="#ffe99a" stroke-width="6" stroke-linecap="round">
				<path d="M68 286 C44 308 51 343 81 350 C111 357 126 331 111 312"/>
				<path d="M72 355 C44 378 51 411 81 419 C107 426 121 403 107 385"/>
				<path d="M95 411 C69 437 78 464 102 469 C126 474 137 451 123 435"/>
			</g>
		</svg>`;

		// 2. Register the custom icon with a unique ID
		addIcon('noodle-box', NOODLE_ICON_SVG);

		// 3. Use the unique ID instead of 'folder-tree'
		this.addRibbonIcon('noodle-box', 'Open System Explorer', () => {
			this.activateExplorerView();
		});

		this.addCommand({
			id: 'open-system-explorer',
			name: 'Open System File Explorer',
			callback: () => {
				this.activateExplorerView();
			}
		});
	}

	onunload() {}

		/**
	/**
	 * Opens a native system file/folder dialog to let the user re-link an orphaned note.
	 */
	async relinkOrphanNote(note: TFile, oldPath?: string): Promise<boolean> {
		try {
			let isDirectoryTarget = false;
			let defaultPathDir = undefined;
			
			if (oldPath && oldPath !== 'Unknown path') {
				try {
					const stat = fs.statSync(oldPath);
					isDirectoryTarget = stat.isDirectory();
					defaultPathDir = path.dirname(oldPath);
				} catch (e) {
					isDirectoryTarget = !path.extname(oldPath);
					defaultPathDir = path.dirname(oldPath);
				}
			}

			const dialogProperties: ('openFile' | 'openDirectory' | 'showHiddenFiles')[] = isDirectoryTarget 
				? ['openDirectory'] 
				: ['openFile'];

			// @ts-ignore
			const { remote } = window.require('electron');
			const dialog = remote ? remote.dialog : window.require('@electron/remote').dialog;

			const result = await dialog.showOpenDialog({
				title: isDirectoryTarget ? 'Select replacement folder for this note' : 'Select replacement file for this note',
				properties: dialogProperties,
				defaultPath: defaultPathDir
			});

			if (!result.canceled && result.filePaths.length > 0) {
				const newPath = result.filePaths[0];
				const stat = fs.statSync(newPath);
				const name = path.basename(newPath);
				const currentSafeName = name.replace(/[\\/:]/g, '_');
				const folderPath = this.settings.notesFolder;

				// Update frontmatter with new file stats (without modified_time)
				await this.app.fileManager.processFrontMatter(note, (frontmatter) => {
					frontmatter.full_path = newPath;
					frontmatter.inode = stat.ino;
					frontmatter.device_id = stat.dev;
				});

				const expectedNotePath = normalizePath(`${folderPath}/${currentSafeName}.md`);
				if (note.path !== expectedNotePath) {
					let finalNotePath = expectedNotePath;
					let counter = 1;
					while (this.app.vault.getAbstractFileByPath(finalNotePath) && this.app.vault.getAbstractFileByPath(finalNotePath) !== note) {
						finalNotePath = normalizePath(`${folderPath}/${currentSafeName}_${counter}.md`);
						counter++;
					}
					await this.app.fileManager.renameFile(note, finalNotePath);
				}

				new Notice(`Successfully re-linked note to: ${name}`);
				return true;
			}
			return false;
		} catch (err) {
			console.error('Failed to open system dialog for re-linking', err);
			new Notice('Error opening system selection dialog.');
			return false;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateExplorerView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(EXPLORER_VIEW_TYPE);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: EXPLORER_VIEW_TYPE, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}
}

// =========================================================================
// CUSTOM FILE EXPLORER VIEW LOGIC (WITH MAIN PANEL TABS)
// =========================================================================

class SystemFileExplorerView extends ItemView {
	plugin: MyPlugin;
	activeWatchers: Map<string, fs.FSWatcher> = new Map();
	debounceTimers: Map<string, NodeJS.Timeout> = new Map();
	
	// Track the main scroll container and scroll positions for the tree
	treeRootEl!: HTMLElement;
	savedScrollTop: number = 0;
	savedScrollLeft: number = 0;
	activeMainTab: 'explorer' | 'orphans' = 'explorer';

	constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return EXPLORER_VIEW_TYPE;
	}

	getDisplayText() {
		return 'System Explorer';
	}

	// Add this new method right here!
	getIcon() {
		return 'noodle-box';
	}

	async onOpen() {
		this.renderMainView();
	}

	async onClose() {
		this.clearWatchers();
	}

	/**
	 * Renders the top-level panel layout with view selection tabs (Explorer vs Orphans)
	 */
	renderMainView() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('custom-explorer-container');

		// View Navigation Tabs Header
		const navHeader = container.createDiv('explorer-view-nav');
		navHeader.style.display = 'flex';
		navHeader.style.gap = '5px';
		navHeader.style.padding = '8px 10px';
		navHeader.style.borderBottom = '1px solid var(--background-modifier-border)';
		navHeader.style.backgroundColor = 'var(--background-secondary)';

		const explorerTabBtn = navHeader.createEl('button', { 
			text: 'Explorer', 
			cls: this.activeMainTab === 'explorer' ? 'mod-cta' : '' 
		});
		explorerTabBtn.onclick = () => {
			this.activeMainTab = 'explorer';
			this.renderMainView();
		};

		const orphansTabBtn = navHeader.createEl('button', { 
			text: 'Orphans', 
			cls: this.activeMainTab === 'orphans' ? 'mod-cta' : '' 
		});
		orphansTabBtn.onclick = () => {
			this.activeMainTab = 'orphans';
			this.renderMainView();
		};

		// Content Panel Container
		const contentContainer = container.createDiv('explorer-tab-content');
		contentContainer.style.display = 'flex';
		contentContainer.style.flexDirection = 'column';
		contentContainer.style.flexGrow = '1';
		contentContainer.style.overflow = 'hidden';

		if (this.activeMainTab === 'explorer') {
			this.renderExplorerInterface(contentContainer);
		} else {
			this.renderOrphansInterface(contentContainer);
		}
	}

	/**
	 * Renders the original tree explorer interface inside its tab body
	 */
	renderExplorerInterface(container: HTMLElement) {
		// 1. If treeRootEl already exists, save its scroll position before clearing
		if (this.treeRootEl) {
			this.savedScrollTop = this.treeRootEl.scrollTop;
			this.savedScrollLeft = this.treeRootEl.scrollLeft;
		}

		// Completely clear the container first to prevent stacking/nesting duplicates
		container.empty();

		// Sub-header with Title & Refresh Button
		const headerContainer = container.createDiv('explorer-sticky-header');
		headerContainer.createEl('h4', { text: 'Spaghetti' });
		
		const refreshBtn = headerContainer.createEl('button', { cls: 'refresh-btn' });
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.title = "Refresh Explorer";
		refreshBtn.onclick = () => {
			// Reset saved scroll positions on manual refresh if desired, or keep them
			this.savedScrollTop = 0;
			this.savedScrollLeft = 0;
			this.renderExplorerInterface(container);
		};

		// 2. Freshly create the Scrollable Tree Container
		this.treeRootEl = container.createDiv('tree-root');

		const roots = this.getSystemRoots();
		const existingNotes = this.getExistingNoteIdentifiers();

		for (const root of roots) {
			this.renderFolder(this.treeRootEl, root, root, false, existingNotes);
		}

		// 3. Restore the saved scroll position right after building elements
		if (this.treeRootEl) {
			this.treeRootEl.scrollTop = this.savedScrollTop;
			this.treeRootEl.scrollLeft = this.savedScrollLeft;
		}
	}

	/**
	 * Renders the Orphans management panel inside its tab body
	 */
	renderOrphansInterface(container: HTMLElement) {
		const wrapper = container.createDiv('orphans-view-wrapper');
		wrapper.style.padding = '15px';
		wrapper.style.overflowY = 'auto';
		wrapper.style.flexGrow = '1';

		wrapper.createEl('h3', { text: 'Orphaned System Notes' });
		wrapper.createEl('p', { 
			text: 'These notes point to system files that have been deleted or moved beyond automatic detection.',
			cls: 'setting-item-description'
		});

		const listContainer = wrapper.createDiv({ cls: 'orphans-list-container' });
		listContainer.style.marginTop = '15px';

		const folderPath = this.plugin.settings.notesFolder;
		if (!folderPath || folderPath.trim() === '') {
			listContainer.createEl('p', { text: 'Please configure your Notes Folder in General Settings first.', cls: 'error-text' });
			return;
		}

		const allNotes = this.app.vault.getFiles().filter(
			(file) => file.path.startsWith(normalizePath(folderPath)) && file.extension === 'md'
		);

		const orphans: { note: TFile; pathStr: string }[] = [];

		for (const note of allNotes) {
			const cache = this.app.metadataCache.getFileCache(note);
			if (cache && cache.frontmatter) {
				const fm = cache.frontmatter;
				const fullPath = fm.full_path;
				
				let isOrphan = false;
				if (!fullPath) {
					isOrphan = true;
				} else {
					try {
						if (!fs.existsSync(fullPath)) {
							isOrphan = true;
						} else {
							const stat = fs.statSync(fullPath);
							if (fm.inode !== stat.ino || fm.device_id !== stat.dev) {
								isOrphan = true;
							}
						}
					} catch (e) {
						isOrphan = true;
					}
				}

				if (isOrphan) {
					orphans.push({ note, pathStr: fullPath || 'Unknown path' });
				}
			}
		}

		if (orphans.length === 0) {
			listContainer.createEl('p', { text: 'No orphaned notes found! Everything is up to date.' });
			return;
		}

		for (const orphan of orphans) {
			const itemEl = listContainer.createDiv({ cls: 'orphan-item' });
			itemEl.style.display = 'flex';
			itemEl.style.alignItems = 'center';
			itemEl.style.gap = '10px';
			itemEl.style.padding = '8px 0';
			itemEl.style.borderBottom = '1px solid var(--background-modifier-border)';

			// Container on the left for actions (Open Note + Re-Link)
			const actionsContainer = itemEl.createDiv();
			actionsContainer.style.display = 'flex';
			actionsContainer.style.gap = '4px';

			// 1. Open Note Button (New)
			const openNoteBtn = actionsContainer.createEl('button', { cls: 'open-note-icon-btn' });
			openNoteBtn.style.background = 'none';
			openNoteBtn.style.border = 'none';
			openNoteBtn.style.cursor = 'pointer';
			openNoteBtn.style.padding = '4px';
			openNoteBtn.style.display = 'flex';
			openNoteBtn.style.alignItems = 'center';
			openNoteBtn.style.justifyContent = 'center';
			
			setIcon(openNoteBtn, 'pen'); // Uses the same pen icon style as the tree explorer
			openNoteBtn.title = "Open orphan note";
			openNoteBtn.onclick = async () => {
				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(orphan.note);
			};

			// 2. Re-Link Button
			const relinkBtn = actionsContainer.createEl('button', { cls: 'relink-icon-btn' });
			relinkBtn.style.background = 'none';
			relinkBtn.style.border = 'none';
			relinkBtn.style.cursor = 'pointer';
			relinkBtn.style.padding = '4px';
			relinkBtn.style.display = 'flex';
			relinkBtn.style.alignItems = 'center';
			relinkBtn.style.justifyContent = 'center';
			
			setIcon(relinkBtn, 'link');
			relinkBtn.title = "Re-Link note";
			relinkBtn.onclick = async () => {
				const success = await this.plugin.relinkOrphanNote(orphan.note, orphan.pathStr);
				if (success) {
					this.renderMainView(); 
				}
			};

			// 3. Text info block on the right
			const infoEl = itemEl.createDiv();
			infoEl.createEl('strong', { text: orphan.note.basename });
			infoEl.createEl('br');
			infoEl.createEl('small', { text: `Old Target: ${orphan.pathStr}`, cls: 'text-muted' });
		}
	}

	clearWatchers() {
		for (const [dirPath, watcher] of this.activeWatchers.entries()) {
			watcher.close();
		}
		this.activeWatchers.clear();
		
		for (const [dirPath, timer] of this.debounceTimers.entries()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();
	}

	getSystemRoots(): string[] {
		if (os.platform() === 'win32') {
			const drives: string[] = [];
			for (let i = 65; i <= 90; i++) {
				const drive = String.fromCharCode(i) + ':\\';
				try {
					if (fs.existsSync(drive)) {
						drives.push(drive);
					}
				} catch (e) {}
			}
			return drives.length > 0 ? drives : ['C:\\'];
		} else {
			return ['/'];
		}
	}

	getExistingNoteIdentifiers(): Set<string> {
		const folderPath = this.plugin.settings.notesFolder;
		const identifiers = new Set<string>();
		
		if (!folderPath) return identifiers;

		const allNotes = this.app.vault.getFiles().filter(
			(file) => file.path.startsWith(normalizePath(folderPath)) && file.extension === 'md'
		);

		for (const note of allNotes) {
			const cache = this.app.metadataCache.getFileCache(note);
			if (cache && cache.frontmatter) {
				const fm = cache.frontmatter;
				if (fm.inode !== undefined && fm.device_id !== undefined) {
					identifiers.add(`${fm.inode}_${fm.device_id}`);
				}
			}
		}
		return identifiers;
	}

	isCloudOnlyFile(filePath: string, stat: fs.Stats): boolean {
		if (filePath.includes("CLOUD_CLOUD_CLOUD")) {
			return true;
		}

		if (os.platform() === 'win32') {
			// @ts-ignore
			const attrs = stat.fileAttributes || 0;
			if ((attrs & 0x1000) || (attrs & 0x40000)) {
				return true;
			}
		}

		return false;
	}

	async handleNodeClick(name: string, fullPath: string, stat: fs.Stats, noteBtnEl: HTMLElement) {
		const folderPath = this.plugin.settings.notesFolder;
		
		if (!folderPath || folderPath.trim() === '') {
			new Notice('Error: Notes folder is not configured! Please set it in the plugin settings.');
			return;
		}

		try {
			const currentInode = stat.ino;
			const currentDevice = stat.dev;
			const currentSafeName = name.replace(/[\\/:]/g, '_'); 

			const allNotes = this.app.vault.getFiles().filter(
				(file) => file.path.startsWith(normalizePath(folderPath)) && file.extension === 'md'
			);

			let targetFile: TFile | null = null;

			for (const note of allNotes) {
				const cache = this.app.metadataCache.getFileCache(note);
				if (cache && cache.frontmatter) {
					const fm = cache.frontmatter;
					if (fm.inode === currentInode && fm.device_id === currentDevice) {
						targetFile = note;
						break;
					}
				}
			}

			if (targetFile) {
				const cache = this.app.metadataCache.getFileCache(targetFile);
				const expectedNotePath = normalizePath(`${folderPath}/${currentSafeName}.md`);
				let updated = false;

				if (cache?.frontmatter?.full_path !== fullPath) {
					await this.app.fileManager.processFrontMatter(targetFile, (frontmatter) => {
						frontmatter.full_path = fullPath; 
					});
					updated = true;
				}

				if (targetFile.path !== expectedNotePath) {
					let finalNotePath = expectedNotePath;
					let counter = 1;
					while (this.app.vault.getAbstractFileByPath(finalNotePath) && this.app.vault.getAbstractFileByPath(finalNotePath) !== targetFile) {
						finalNotePath = normalizePath(`${folderPath}/${currentSafeName}_${counter}.md`);
						counter++;
					}
					await this.app.fileManager.renameFile(targetFile, finalNotePath);
					updated = true;
				}

				if (updated) {
					new Notice(`Note updated to reflect moved/renamed system file!`);
				}
			} else {
				const folder = this.app.vault.getAbstractFileByPath(normalizePath(folderPath));
				if (!folder) {
					await this.app.vault.createFolder(normalizePath(folderPath));
				}
				
				let finalNotePath = normalizePath(`${folderPath}/${currentSafeName}.md`);
				
				let counter = 1;
				while (this.app.vault.getAbstractFileByPath(finalNotePath)) {
					finalNotePath = normalizePath(`${folderPath}/${currentSafeName}_${counter}.md`);
					counter++;
				}

				const yamlSafePath = fullPath.replace(/\\/g, '\\\\');

				const content = `---
full_path: "${yamlSafePath}"
inode: ${currentInode}
device_id: ${currentDevice}
---
`;
				targetFile = await this.app.vault.create(finalNotePath, content);
				
				noteBtnEl.removeClass('missing');
				noteBtnEl.addClass('exists');
			}
			
			if (targetFile instanceof TFile) {
				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(targetFile);
			}

		} catch (err) {
			console.error(`Failed to handle click for ${fullPath}`, err);
			new Notice(`Error accessing system data for ${name}.`);
		}
	}

	renderFolder(containerEl: HTMLElement, dirPath: string, name: string, isRoot: boolean, existingNotes: Set<string>) {
		const nodeEl = containerEl.createDiv('tree-node');
		
		const headerEl = nodeEl.createDiv('tree-node-header clickable-area');
		const collapseBtn = headerEl.createSpan({ cls: 'collapse-btn', text: '▶' });
		const nameEl = headerEl.createSpan({ cls: 'node-name', text: name });

		let hasNote = false;
		let stat: fs.Stats | null = null;
		try {
			stat = fs.statSync(dirPath);
			hasNote = existingNotes.has(`${stat.ino}_${stat.dev}`);
		} catch (e) {}

		const isCloud = stat ? this.isCloudOnlyFile(dirPath, stat) : dirPath.includes("CLOUD_CLOUD_CLOUD");

		if (isCloud) {
			collapseBtn.style.visibility = 'hidden';
			const cloudBtn = headerEl.createSpan({ cls: 'cloud-btn' });
			setIcon(cloudBtn, 'cloud');
			cloudBtn.title = "Can't work with online-only items on cloud drives. Download it!";
			
			headerEl.onclick = (e) => e.stopPropagation();
			return; 
		}

		const noteBtn = headerEl.createSpan({ cls: `note-btn ${hasNote ? 'exists' : 'missing'}` });
		setIcon(noteBtn, 'pen');
		noteBtn.title = hasNote ? "Open note" : "Create note";

		noteBtn.onclick = (e) => {
			e.stopPropagation();
			if (stat) this.handleNodeClick(name, dirPath, stat, noteBtn);
		};

		const childrenContainer = nodeEl.createDiv('tree-node-children');
		childrenContainer.style.display = 'none';

		let isExpanded = this.plugin.settings.expandedPaths.includes(dirPath);

		const toggleExpand = async (e?: MouseEvent) => {
			if (e) e.stopPropagation();
			isExpanded = !isExpanded;
			
			if (isExpanded) {
				collapseBtn.innerText = '▼';
				childrenContainer.style.display = 'block';
				this.loadAndRenderChildren(childrenContainer, dirPath);
				this.startWatching(dirPath, childrenContainer);
				
				if (!this.plugin.settings.expandedPaths.includes(dirPath)) {
					this.plugin.settings.expandedPaths.push(dirPath);
					await this.plugin.saveSettings();
				}
			} else {
				collapseBtn.innerText = '▶';
				childrenContainer.style.display = 'none';
				childrenContainer.empty();
				this.stopWatching(dirPath);

				this.plugin.settings.expandedPaths = this.plugin.settings.expandedPaths.filter(p => p !== dirPath);
				await this.plugin.saveSettings();
			}
		};

		headerEl.onclick = toggleExpand;
		collapseBtn.onclick = toggleExpand;

		if (isExpanded || isRoot) {
			isExpanded = false; 
			toggleExpand();
		}
	}

	renderFile(containerEl: HTMLElement, filePath: string, name: string, existingNotes: Set<string>) {
		const nodeEl = containerEl.createDiv('tree-node');
		
		const headerEl = nodeEl.createDiv('tree-node-header clickable-area');
		headerEl.createSpan({ cls: 'collapse-spacer' });
		const nameEl = headerEl.createSpan({ cls: 'node-name file-name', text: name });
		
		let stat: fs.Stats | null = null;
		try {
			stat = fs.statSync(filePath);
		} catch (e) {}

		const isCloud = stat ? this.isCloudOnlyFile(filePath, stat) : filePath.includes("CLOUD_CLOUD_CLOUD");

		if (isCloud) {
			const cloudBtn = headerEl.createSpan({ cls: 'cloud-btn' });
			setIcon(cloudBtn, 'cloud');
			cloudBtn.title = "Can't work with online-only items on cloud drives. Download it!";
		} else {
			let hasNote = false;
			if (stat) {
				hasNote = existingNotes.has(`${stat.ino}_${stat.dev}`);
			}

			const noteBtn = headerEl.createSpan({ cls: `note-btn ${hasNote ? 'exists' : 'missing'}` });
			setIcon(noteBtn, 'pen');
			noteBtn.title = hasNote ? "Open note" : "Create note";

			noteBtn.onclick = (e) => {
				e.stopPropagation();
				if (stat) this.handleNodeClick(name, filePath, stat, noteBtn);
			};

			const openBtn = headerEl.createSpan({ cls: 'open-system-btn' });
			setIcon(openBtn, 'external-link');
			openBtn.title = "Open with system default";

			openBtn.onclick = (e) => {
				e.stopPropagation();
				shell.openPath(filePath);
			};
		}

		headerEl.onclick = (e) => {
			e.stopPropagation();
		};
	}

	loadAndRenderChildren(containerEl: HTMLElement, dirPath: string) {
		containerEl.empty();
		
		try {
			const items = fs.readdirSync(dirPath, { withFileTypes: true });
			const existingNotes = this.getExistingNoteIdentifiers();
			
			items.sort((a, b) => {
				if (a.isDirectory() && !b.isDirectory()) return -1;
				if (!a.isDirectory() && b.isDirectory()) return 1;
				return a.name.localeCompare(b.name);
			});

			for (const item of items) {
				if (item.name.startsWith('.')) continue;

				const fullPath = path.join(dirPath, item.name);
				
				if (item.isDirectory()) {
					this.renderFolder(containerEl, fullPath, item.name, false, existingNotes);
				} else {
					this.renderFile(containerEl, fullPath, item.name, existingNotes);
				}
			}
		} catch (error) {
			containerEl.createDiv({ text: 'Access denied or error loading directory', cls: 'error-text' });
		}
	}

	startWatching(dirPath: string, childrenContainer: HTMLElement) {
		if (this.activeWatchers.has(dirPath)) return;

		try {
			const watcher = fs.watch(dirPath, (eventType, filename) => {
				const existingTimer = this.debounceTimers.get(dirPath);
				if (existingTimer) {
					clearTimeout(existingTimer);
				}

				const timer = setTimeout(() => {
					if (childrenContainer.style.display !== 'none') {
						this.loadAndRenderChildren(childrenContainer, dirPath);
					}
					this.debounceTimers.delete(dirPath);
				}, 200);

				this.debounceTimers.set(dirPath, timer);
			});
			this.activeWatchers.set(dirPath, watcher);
		} catch (error) {}
	}

	stopWatching(dirPath: string) {
		const watcher = this.activeWatchers.get(dirPath);
		if (watcher) {
			watcher.close();
			this.activeWatchers.delete(dirPath);
		}

		const timer = this.debounceTimers.get(dirPath);
		if (timer) {
			clearTimeout(timer);
			this.debounceTimers.delete(dirPath);
		}
	}
}