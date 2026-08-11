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
// CUSTOM FILE EXPLORER VIEW LOGIC
// =========================================================================

class SystemFileExplorerView extends ItemView {
	plugin: MyPlugin;
	activeWatchers: Map<string, fs.FSWatcher> = new Map();
	debounceTimers: Map<string, NodeJS.Timeout> = new Map();
	
	// Track the main scroll container
	treeRootEl!: HTMLElement;

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
		this.refreshTree();
	}

	/**
	 * Completely rebuilds the tree UI. Attached to the manual refresh button.
	 */
	refreshTree() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('custom-explorer-container');

		// 1. Sticky Header with Refresh Button
		const headerContainer = container.createDiv('explorer-sticky-header');
		headerContainer.createEl('h4', { text: 'My Computer' });
		
		const refreshBtn = headerContainer.createEl('button', { cls: 'refresh-btn' });
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.title = "Refresh Explorer";
		refreshBtn.onclick = () => {
			this.refreshTree();
		};

		// 2. Scrollable Tree Container
		this.treeRootEl = container.createDiv('tree-root');

		const roots = this.getSystemRoots();
		const existingNotes = this.getExistingNoteIdentifiers();

		for (const root of roots) {
			// We skip the stat check for system roots as they can throw errors, just assume no note
			this.renderFolder(this.treeRootEl, root, root, false, existingNotes);
		}
	}

	async onClose() {
		this.clearWatchers();
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

	/**
	 * Scans the vault once to find all existing attached system notes.
	 * Returns a Set of formatted strings: "inode_deviceId"
	 */
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
						frontmatter.modified_time = stat.mtime.toISOString(); 
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
modified_time: "${stat.mtime.toISOString()}"
---
`;
				targetFile = await this.app.vault.create(finalNotePath, content);
				
				// Automatically turn the button green upon successful creation
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

		// Evaluate node existence
		let hasNote = false;
		let stat: fs.Stats | null = null;
		try {
			stat = fs.statSync(dirPath);
			hasNote = existingNotes.has(`${stat.ino}_${stat.dev}`);
		} catch (e) {
			// Permission errors common on root/system folders
		}

		// New Note Button
		const noteBtn = headerEl.createSpan({ cls: `note-btn ${hasNote ? 'exists' : 'missing'}` });
		setIcon(noteBtn, 'pen');
		noteBtn.title = hasNote ? "Open Note" : "Create Note";

		// Click event specifically for the pen icon
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

		// Clicking the main header area (name or blank space) now expands/collapses
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
		
		let hasNote = false;
		let stat: fs.Stats | null = null;
		try {
			stat = fs.statSync(filePath);
			hasNote = existingNotes.has(`${stat.ino}_${stat.dev}`);
		} catch (e) {}

		// New Note Button
		const noteBtn = headerEl.createSpan({ cls: `note-btn ${hasNote ? 'exists' : 'missing'}` });
		setIcon(noteBtn, 'pen');
		noteBtn.title = hasNote ? "Open Note" : "Create Note";

		noteBtn.onclick = (e) => {
			e.stopPropagation();
			if (stat) this.handleNodeClick(name, filePath, stat, noteBtn);
		};

		const openBtn = headerEl.createSpan({ cls: 'open-system-btn' });
		setIcon(openBtn, 'external-link'); // Look cleaner with standard icon
		openBtn.title = "Open with system default";

		openBtn.onclick = (e) => {
			e.stopPropagation();
			shell.openPath(filePath);
		};

		// Clicking the main file area now does nothing specific, or you can bind it to shell open
		// but typically files don't expand. We'll prevent it from bubbling.
		headerEl.onclick = (e) => {
			e.stopPropagation();
		};
	}

	loadAndRenderChildren(containerEl: HTMLElement, dirPath: string) {
		containerEl.empty();
		
		try {
			const items = fs.readdirSync(dirPath, { withFileTypes: true });
			const existingNotes = this.getExistingNoteIdentifiers(); // Fetch once per folder load
			
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