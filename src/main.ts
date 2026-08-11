// main.ts
import {
	Plugin,
	ItemView,
	WorkspaceLeaf,
	Notice,
} from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings } from './settings';

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

		// Register the custom view
		this.registerView(
			EXPLORER_VIEW_TYPE,
			(leaf) => new SystemFileExplorerView(leaf, this)
		);

		// Add a ribbon icon to toggle our custom explorer
		this.addRibbonIcon('folder-tree', 'Open System Explorer', () => {
			this.activateExplorerView();
		});

		// Command to open the explorer via command palette
		this.addCommand({
			id: 'open-system-explorer',
			name: 'Open System File Explorer',
			callback: () => {
				this.activateExplorerView();
			}
		});
	}

	onunload() {
		// Clean up is handled by Obsidian
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

		// Fetch root drives depending on the OS
		const roots = this.getSystemRoots();

		for (const root of roots) {
			// We treat the system roots as top-level folders
			this.renderFolder(rootNode, root, root, false);
		}
	}

	async onClose() {
		for (const [dirPath, watcher] of this.activeWatchers.entries()) {
			watcher.close();
		}
		this.activeWatchers.clear();
	}

	/**
	 * Determines the root drives of the computer.
	 */
	getSystemRoots(): string[] {
		if (os.platform() === 'win32') {
			const drives: string[] = [];
			// Quick and dirty check for common Windows drive letters
			for (let i = 65; i <= 90; i++) {
				const drive = String.fromCharCode(i) + ':\\';
				try {
					if (fs.existsSync(drive)) {
						drives.push(drive);
					}
				} catch (e) {
					// Ignore drives that throw errors (e.g., restricted or empty optical drives)
				}
			}
			return drives.length > 0 ? drives : ['C:\\'];
		} else {
			// macOS and Linux
			return ['/'];
		}
	}

	renderFolder(containerEl: HTMLElement, dirPath: string, name: string, isRoot: boolean = false) {
		const nodeEl = containerEl.createDiv('tree-node');
		
		const headerEl = nodeEl.createDiv('tree-node-header');
		const collapseBtn = headerEl.createSpan({ cls: 'collapse-btn', text: '▶' });
		const nameEl = headerEl.createSpan({ cls: 'node-name', text: name });

		const childrenContainer = nodeEl.createDiv('tree-node-children');
		childrenContainer.style.display = 'none';

		// Check if this path was saved in data.json as expanded
		let isExpanded = this.plugin.settings.expandedPaths.includes(dirPath);

		nameEl.onclick = () => {
			new Notice(`Selected! ${name}`);
		};

		// The logic for expanding/collapsing
		const toggleExpand = async () => {
			isExpanded = !isExpanded;
			
			if (isExpanded) {
				collapseBtn.innerText = '▼';
				childrenContainer.style.display = 'block';
				this.loadAndRenderChildren(childrenContainer, dirPath);
				this.startWatching(dirPath, childrenContainer);
				
				// Save state
				if (!this.plugin.settings.expandedPaths.includes(dirPath)) {
					this.plugin.settings.expandedPaths.push(dirPath);
					await this.plugin.saveSettings();
				}
			} else {
				collapseBtn.innerText = '▶';
				childrenContainer.style.display = 'none';
				childrenContainer.empty();
				this.stopWatching(dirPath);

				// Remove from state
				this.plugin.settings.expandedPaths = this.plugin.settings.expandedPaths.filter(p => p !== dirPath);
				await this.plugin.saveSettings();
			}
		};

		collapseBtn.onclick = toggleExpand;

		// If it's a saved expanded path (or forced root), trigger it open immediately
		if (isExpanded || isRoot) {
			// Temporarily set to false so the toggle function does its job correctly
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

		nameEl.onclick = () => {
			new Notice(`Selected! ${name}`);
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
				// Skip hidden/system files to avoid permission crashes
				if (item.name.startsWith('.')) continue;

				const fullPath = path.join(dirPath, item.name);
				
				if (item.isDirectory()) {
					this.renderFolder(containerEl, fullPath, item.name);
				} else {
					this.renderFile(containerEl, fullPath, item.name);
				}
			}
		} catch (error) {
			// Extremely common when hitting protected OS folders (like "System Volume Information")
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
			// Some system directories don't allow watchers
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