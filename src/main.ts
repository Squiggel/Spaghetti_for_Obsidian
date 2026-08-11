import {
	Editor,
	MarkdownView,
	MarkdownFileInfo,
	Modal,
	Notice,
	Plugin,
	ItemView,
	WorkspaceLeaf,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	SampleSettingTab,
} from './settings';

// Node and Electron modules for file system operations and opening files
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore - Electron is available in Obsidian Desktop environments
import { shell } from 'electron'; 

const EXPLORER_VIEW_TYPE = 'custom-system-explorer-view';

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// REGISTER THE CUSTOM VIEW
		this.registerView(
			EXPLORER_VIEW_TYPE,
			(leaf) => new SystemFileExplorerView(leaf, this)
		);

		// Add a ribbon icon to toggle our custom explorer in the right sidebar
		this.addRibbonIcon('folder-tree', 'Open Custom Explorer', () => {
			this.activateExplorerView();
		});

		// Command to open the explorer via command palette
		this.addCommand({
			id: 'open-custom-explorer',
			name: 'Open Custom File Explorer',
			callback: () => {
				this.activateExplorerView();
			}
		});

		// --- ORIGINAL BOILERPLATE BELOW ---

		this.addRibbonIcon('dice', 'Sample', (_evt: MouseEvent) => {
			new Notice('This is a notice!');
		});

		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status bar text');

		this.addCommand({
			id: 'open-modal-simple',
			name: 'Open modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			},
		});

		this.addCommand({
			id: 'replace-selected',
			name: 'Replace selected content',
			editorCallback: (editor: Editor, _ctx: MarkdownView | MarkdownFileInfo) => {
				editor.replaceSelection('Sample editor command');
			},
		});

		this.addCommand({
			id: 'open-modal-complex',
			name: 'Open modal (complex)',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						new SampleModal(this.app).open();
					}
					return true;
				}
				return false;
			},
		});

		this.addSettingTab(new SampleSettingTab(this.app, this));

		this.registerDomEvent(activeDocument, 'click', (_evt: MouseEvent) => {
			// new Notice('Click'); // Commented out to prevent annoying clicks during testing
		});

		this.registerInterval(
			window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000),
		);
	}

	onunload() {
		// No manual view cleanup needed; Obsidian handles detaching registered views
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Helper function to open/reveal our view in the right sidebar
	async activateExplorerView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(EXPLORER_VIEW_TYPE);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use it
			leaf = leaves[0];
		} else {
			// Our view could not be found, create a new leaf in the right sidebar
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: EXPLORER_VIEW_TYPE, active: true });
			}
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}
}

class SampleModal extends Modal {
	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// =========================================================================
// CUSTOM FILE EXPLORER VIEW LOGIC
// =========================================================================

class SystemFileExplorerView extends ItemView {
	plugin: MyPlugin;
	// Store active watchers so we can close them when directories collapse or view closes
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

	// Called when the view is opened
	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('custom-explorer-container');

		// Determine the root path. Default to the vault's base path if setting is empty.
		let rootPath = this.plugin.settings.explorerRootPath;
		if (!rootPath || rootPath.trim() === '') {
			// @ts-ignore - Accessing internal adapter to get the absolute OS path of the vault
			rootPath = this.app.vault.adapter.getBasePath();
		}

		const header = container.createEl('h4', { text: 'System Explorer' });
		const rootNode = container.createDiv('tree-root');

		// Start rendering the tree from the root path
		this.renderFolder(rootNode, rootPath, path.basename(rootPath), true);
	}

	// Called when the view is closed. Important to clean up file watchers!
	async onClose() {
		for (const [dirPath, watcher] of this.activeWatchers.entries()) {
			watcher.close();
		}
		this.activeWatchers.clear();
	}

	/**
	 * Renders a directory and sets up lazy loading for its children.
	 */
	renderFolder(containerEl: HTMLElement, dirPath: string, name: string, isRoot: boolean = false) {
		const nodeEl = containerEl.createDiv('tree-node');
		
		const headerEl = nodeEl.createDiv('tree-node-header');
		const collapseBtn = headerEl.createSpan({ cls: 'collapse-btn', text: '▶' });
		const nameEl = headerEl.createSpan({ cls: 'node-name', text: name });

		const childrenContainer = nodeEl.createDiv('tree-node-children');
		childrenContainer.style.display = 'none'; // Hidden by default (lazy loaded)

		let isExpanded = false;

		// Select action (clicking the name)
		nameEl.onclick = () => {
			new Notice(`Selected! ${name}`);
		};

		// Expand/Collapse action (clicking the arrow)
		collapseBtn.onclick = () => {
			isExpanded = !isExpanded;
			
			if (isExpanded) {
				collapseBtn.innerText = '▼';
				childrenContainer.style.display = 'block';
				this.loadAndRenderChildren(childrenContainer, dirPath);
				this.startWatching(dirPath, childrenContainer);
			} else {
				collapseBtn.innerText = '▶';
				childrenContainer.style.display = 'none';
				childrenContainer.empty(); // Unload children
				this.stopWatching(dirPath);
			}
		};

		// If it's the root node, auto-expand it
		if (isRoot) {
			collapseBtn.click();
		}
	}

	/**
	 * Renders a file node.
	 */
	renderFile(containerEl: HTMLElement, filePath: string, name: string) {
		const nodeEl = containerEl.createDiv('tree-node');
		
		const headerEl = nodeEl.createDiv('tree-node-header');
		const spacer = headerEl.createSpan({ cls: 'collapse-spacer' }); // Empty space to align with folders
		const nameEl = headerEl.createSpan({ cls: 'node-name file-name', text: name });
		
		// System default program button
		const openBtn = headerEl.createSpan({ cls: 'open-system-btn', text: '↗' });
		openBtn.title = "Open with system default";

		// Select action
		nameEl.onclick = () => {
			new Notice(`Selected! ${name}`);
		};

		// Open external action
		openBtn.onclick = (e) => {
			e.stopPropagation();
			shell.openPath(filePath); // Uses electron to open in OS
		};
	}

	/**
	 * Reads directory contents and renders them inside the provided container.
	 */
	loadAndRenderChildren(containerEl: HTMLElement, dirPath: string) {
		containerEl.empty();
		
		try {
			const items = fs.readdirSync(dirPath, { withFileTypes: true });
			
			// Sort items: folders first, then files, alphabetically
			items.sort((a, b) => {
				if (a.isDirectory() && !b.isDirectory()) return -1;
				if (!a.isDirectory() && b.isDirectory()) return 1;
				return a.name.localeCompare(b.name);
			});

			for (const item of items) {
				// Skip hidden files (like .git, .obsidian) to keep it clean
				if (item.name.startsWith('.')) continue;

				const fullPath = path.join(dirPath, item.name);
				
				if (item.isDirectory()) {
					this.renderFolder(containerEl, fullPath, item.name);
				} else {
					this.renderFile(containerEl, fullPath, item.name);
				}
			}
		} catch (error) {
			containerEl.createDiv({ text: 'Error loading directory', cls: 'error-text' });
			console.error(`Error reading directory ${dirPath}:`, error);
		}
	}

	/**
	 * Starts an fs.watch on a directory. Re-renders children if a change is detected.
	 */
	startWatching(dirPath: string, childrenContainer: HTMLElement) {
		if (this.activeWatchers.has(dirPath)) return;

		try {
			const watcher = fs.watch(dirPath, (eventType, filename) => {
				// Re-render children when a file is added/removed/renamed
				// We use a slight delay/debounce to prevent rapid firing during multiple file operations
				setTimeout(() => {
					// Only re-render if the container is still visible (expanded)
					if (childrenContainer.style.display !== 'none') {
						this.loadAndRenderChildren(childrenContainer, dirPath);
					}
				}, 100);
			});
			this.activeWatchers.set(dirPath, watcher);
		} catch (error) {
			console.error(`Failed to watch directory ${dirPath}:`, error);
		}
	}

	/**
	 * Stops watching a directory and cleans up the watcher.
	 */
	stopWatching(dirPath: string) {
		const watcher = this.activeWatchers.get(dirPath);
		if (watcher) {
			watcher.close();
			this.activeWatchers.delete(dirPath);
		}
	}
}