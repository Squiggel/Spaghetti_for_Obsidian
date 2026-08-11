// settings.ts
export interface MyPluginSettings {
	// We use this to save the state to data.json
	expandedPaths: string[];
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	expandedPaths: [],
};