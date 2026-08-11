// settings.ts
import { App, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';

export interface MyPluginSettings {
	expandedPaths: string[];
	notesFolder: string; // The nominated folder for our generated notes
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	expandedPaths: [],
	notesFolder: '', // No default, as requested
};

export class SystemExplorerSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Notes Folder')
			.setDesc('The folder in your vault where system element notes will be created. e.g., "SystemNotes"')
			.addText((text) =>
				text
					.setPlaceholder('Enter folder path...')
					.setValue(this.plugin.settings.notesFolder)
					.onChange(async (value) => {
						this.plugin.settings.notesFolder = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}