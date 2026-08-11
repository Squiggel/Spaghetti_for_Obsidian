// main.ts
import {
	Plugin,
	ItemView,
	WorkspaceLeaf,
	Notice,
	TFile,
	normalizePath
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

		// Add our clean settings tab back so the user can set the notes folder
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
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('custom-explorer-container');

		const header = container.createEl('h4', { text: 'My Computer' });
		const rootNode = container.createDiv('tree-root');

		const roots = this.getSystemRoots();

		for (const root of roots) {
			this.renderFolder(rootNode, root, root, false);
		}
	}

	async onClose() {
		for (const [dirPath, watcher] of this.activeWatchers.entries()) {
			watcher.close();
		}
		this.activeWatchers.clear();
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
	 * Core logic for handling clicks on files and folders.
	 * Checks settings, gets system stats, and generates/opens the Obsidian note.
	 */
	async handleNodeClick(name: string, fullPath: string) {
		const folderPath = this.plugin.settings.notesFolder;
		
		// Requirement: Error message if no default folder is set
		if (!folderPath || folderPath.trim() === '') {
			new Notice('Error: Notes folder is not configured! Please set it in the plugin settings.');
			return;
		}

		try {
			// Get system stats for the file/folder synchronously
			const stats = fs.statSync(fullPath);
			
			// Sanitize the filename to ensure it is valid for Obsidian (removes slashes, colons)
			const safeName = name.replace(/[\\/:]/g, '_'); 
			const notePath = normalizePath(`${folderPath}/${safeName}.md`);
			
			let file = this.app.vault.getAbstractFileByPath(notePath);
			
			// Requirement: Lazy creation (only create if it doesn't exist)
			if (!file) {
				// Ensure the parent directory exists in the vault first
				const folder = this.app.vault.getAbstractFileByPath(normalizePath(folderPath));
				if (!folder) {
					await this.app.vault.createFolder(normalizePath(folderPath));
				}
				
				// Format Windows paths nicely for YAML (escaping backslashes)
				const yamlSafePath = fullPath.replace(/\\/g, '\\\\');

				// Construct the YAML string
				const content = `---
full_path: "${yamlSafePath}"
inode: ${stats.ino}
device_id: ${stats.dev}
modified_time: "${stats.mtime.toISOString()}"
---
`;
				// Create the file in the vault
				file = await this.app.vault.create(notePath, content);
			}
			
			// Open the note in the active workspace
			if (file instanceof TFile) {
				const leaf = this.app.workspace.getLeaf(false); // Open in current active leaf/tab
				await leaf.openFile(file);
			}

		} catch (err) {
			console.error(`Failed to handle click for ${fullPath}`, err);
			new Notice(`Error accessing system data for ${name}`);
		}
	}

	renderFolder(containerEl: HTMLElement, dirPath: string, name: string, isRoot: boolean = false) {
		const nodeEl = containerEl.createDiv('tree-node');
		
		const headerEl = nodeEl.createDiv('tree-node-header');
		const collapseBtn = headerEl.createSpan({ cls: 'collapse-btn', text: '▶' });
		const nameEl = headerEl.createSpan({ cls: 'node-name', text: name });

		const childrenContainer = nodeEl.createDiv('tree-node-children');
		childrenContainer.style.display = 'none';

		let isExpanded = this.plugin.settings.expandedPaths.includes(dirPath);

		// Replaced Notice popup with our new note opening logic
		nameEl.onclick = () => {
			this.handleNodeClick(name, dirPath);
		};

		const toggleExpand = async () => {
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

		collapseBtn.onclick = toggleExpand;

		if (isExpanded || isRoot) {
			isExpanded = false; 
			toggleExpand();
		}
	}

	renderFile(containerEl: HTMLElement, filePath: string, name: string) {
		const nodeEl = containerEl.createDiv('tree-node');
		
		const headerEl = nodeEl.createDiv('tree-node-header');
		const spacer = headerEl.createSpan({ cls: 'collapse-spacer' });
		const nameEl = headerEl.createSpan({ cls: 'node-name file-name', text: name });
		
		const openBtn = headerEl.createSpan({ cls: 'open-system-btn', text: '↗' });
		openBtn.title = "Open with system default";

		// Replaced Notice popup with our new note opening logic
		nameEl.onclick = () => {
			this.handleNodeClick(name, filePath);
		};

		openBtn.onclick = (e) => {
			e.stopPropagation();
			shell.openPath(filePath);
		};
	}

	loadAndRenderChildren(containerEl: HTMLElement, dirPath: string) {
		containerEl.empty();
		
		try {
			const items = fs.readdirSync(dirPath, { withFileTypes: true });
			
			items.sort((a, b) => {
				if (a.isDirectory() && !b.isDirectory()) return -1;
				if (!a.isDirectory() && b.isDirectory()) return 1;
				return a.name.localeCompare(b.name);
			});

			for (const item of items) {
				if (item.name.startsWith('.')) continue;

				const fullPath = path.join(dirPath, item.name);
				
				if (item.isDirectory()) {
					this.renderFolder(containerEl, fullPath, item.name);
				} else {
					this.renderFile(containerEl, fullPath, item.name);
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
				setTimeout(() => {
					if (childrenContainer.style.display !== 'none') {
						this.loadAndRenderChildren(childrenContainer, dirPath);
					}
				}, 100);
			});
			this.activeWatchers.set(dirPath, watcher);
		} catch (error) {
			console.log(`Could not watch directory ${dirPath}`);
		}
	}

	stopWatching(dirPath: string) {
		const watcher = this.activeWatchers.get(dirPath);
		if (watcher) {
			watcher.close();
			this.activeWatchers.delete(dirPath);
		}
	}
}