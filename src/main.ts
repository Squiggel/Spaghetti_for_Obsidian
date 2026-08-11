// main.ts
import {
	Plugin,
	ItemView,
	WorkspaceLeaf,
	Notice,
	TFile,
	normalizePath,
	setIcon
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

		this.addRibbonIcon('folder-tree', 'Open System Explorer', () => {
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
	 * Opens a native system file/folder dialog to let the user re-link an orphaned note.
	 */
	async relinkOrphanNote(note: TFile, oldPath?: string) {
		try {
			// Determine if the original target was a directory/folder or a file.
			// Fallback: check if the path doesn't have a standard file extension or test fs stats.
			let isDirectoryTarget = false;
			
			if (oldPath && oldPath !== 'Unknown path') {
				try {
					const stat = fs.statSync(oldPath);
					isDirectoryTarget = stat.isDirectory();
				} catch (e) {
					// If it doesn't exist on disk anymore, infer from path characteristics 
					// (e.g., lacks an extension, or matches how you structured folder notes).
					isDirectoryTarget = !path.extname(oldPath);
				}
			}

			// Set properties dynamically: 'openDirectory' if it was a folder, 'openFile' if it was a file
			const dialogProperties: ('openFile' | 'openDirectory' | 'showHiddenFiles')[] = isDirectoryTarget 
				? ['openDirectory'] 
				: ['openFile'];

			// @ts-ignore
			const { remote } = window.require('electron');
			const dialog = remote ? remote.dialog : window.require('@electron/remote').dialog;

			const result = await dialog.showOpenDialog({
				title: isDirectoryTarget ? 'Select replacement folder for this note' : 'Select replacement file for this note',
				properties: dialogProperties
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
	
	// Track the main scroll container for the tree
	treeRootEl!: HTMLElement;
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
		// 1. Capture current scroll position before clearing/rebuilding if element exists
		const currentScrollTop = this.treeRootEl ? this.treeRootEl.scrollTop : 0;
		const currentScrollLeft = this.treeRootEl ? this.treeRootEl.scrollLeft : 0;

		// Sub-header with Title & Refresh Button
		const headerContainer = container.createDiv('explorer-sticky-header');
		headerContainer.createEl('h4', { text: 'Spaghetti' });
		
		const refreshBtn = headerContainer.createEl('button', { cls: 'refresh-btn' });
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.title = "Refresh Explorer";
		refreshBtn.onclick = () => {
			this.renderExplorerInterface(container);
		};

		// 2. Scrollable Tree Container
		this.treeRootEl = container.createDiv('tree-root');

		const roots = this.getSystemRoots();
		const existingNotes = this.getExistingNoteIdentifiers();

		for (const root of roots) {
			this.renderFolder(this.treeRootEl, root, root, false, existingNotes);
		}

		// 3. Restore scroll position after rebuilding nodes
		if (this.treeRootEl) {
			this.treeRootEl.scrollTop = currentScrollTop;
			this.treeRootEl.scrollLeft = currentScrollLeft;
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
			itemEl.style.gap = '10px'; // Spacing between the icon and text
			itemEl.style.padding = '8px 0';
			itemEl.style.borderBottom = '1px solid var(--background-modifier-border)';

			// 1. Create the button on the left with a link icon
			const relinkBtn = itemEl.createEl('button', { cls: 'relink-icon-btn' });
			relinkBtn.style.background = 'none';
			relinkBtn.style.border = 'none';
			relinkBtn.style.cursor = 'pointer';
			relinkBtn.style.padding = '4px';
			relinkBtn.style.display = 'flex';
			relinkBtn.style.alignItems = 'center';
			relinkBtn.style.justifyContent = 'center';
			
			setIcon(relinkBtn, 'link'); // Sets Obsidian's link icon
			relinkBtn.title = "Re-Link note";

			relinkBtn.onclick = async () => {
				// Pass the orphan path so we can check if it was a file or folder
				const success = await this.plugin.relinkOrphanNote(orphan.note, orphan.pathStr);
				if (success) {
					this.renderMainView(); // Refresh view panel contents
				}
			};

			// 2. Text info block on the right
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