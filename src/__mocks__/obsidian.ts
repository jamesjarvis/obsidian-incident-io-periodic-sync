// Mock for obsidian module used in tests
// Only provides minimal stubs needed for importing modules

export function requestUrl(): Promise<unknown> {
	throw new Error('requestUrl should not be called in tests');
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export class TFile {
	path = '';
	name = '';
	basename = '';
	extension = '';
}

export class TFolder {
	path = '';
	name = '';
}

export class App {
	vault = {
		read: () => Promise.resolve(''),
		process: () => Promise.resolve(),
		getAbstractFileByPath: () => null,
		getMarkdownFiles: () => [],
		create: () => Promise.resolve(new TFile()),
		createFolder: () => Promise.resolve(),
	};
	fileManager = {
		processFrontMatter: () => Promise.resolve(),
	};
	metadataCache = {
		getFileCache: () => null,
	};
}

export class Plugin {
	app = new App();
	manifest = {
		id: '',
		name: '',
		version: '',
	};
	loadData = () => Promise.resolve({});
	saveData = () => Promise.resolve();
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl = {
		empty: () => {},
		createEl: () => ({}),
	};

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
	}
}

export class Setting {
	constructor() {}
	setName = () => this;
	setDesc = () => this;
	addText = () => this;
	addButton = () => this;
	addToggle = () => this;
	addDropdown = () => this;
}

export class Notice {
	constructor() {}
}
