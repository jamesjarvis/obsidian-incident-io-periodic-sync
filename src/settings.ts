import { App, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import { SECRET_KEY_API } from './types';
import { IncidentIOAPI } from './api';
import IncidentIOSyncPlugin from './main';
import { logger } from './logger';

// Validation helpers
const MAX_HISTORICAL_DAYS = 90;

function validateNonNegativeInt(value: string, max?: number): number | null {
	const num = parseInt(value, 10);
	if (isNaN(num) || num < 0) return null;
	if (max !== undefined && num > max) return null;
	return num;
}

function validateSectionHeader(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	if (!trimmed.startsWith('#')) return null;
	return trimmed;
}

export class IncidentIOSyncSettingTab extends PluginSettingTab {
	plugin: IncidentIOSyncPlugin;

	constructor(app: App, plugin: IncidentIOSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private updateApiKeyStatus(statusEl: HTMLElement): void {
		if (this.plugin.settings.apiKeyConfigured) {
			statusEl.textContent = '✓ API key configured';
			statusEl.className = 'api-key-status success';
		} else {
			statusEl.textContent = 'No API key configured';
			statusEl.className = 'api-key-status pending';
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('incident-io-settings');

		// API Configuration
		new Setting(containerEl).setName('API configuration').setHeading();

		// API Key - stored in SecretStorage, not data.json
		const apiKeySetting = new Setting(containerEl)
			.setName('API key')
			.setDesc('Your incident.io API key (stored securely)');

		// Status indicator
		const apiKeyStatus = containerEl.createDiv('api-key-status');
		this.updateApiKeyStatus(apiKeyStatus);

		apiKeySetting.addText(text => {
			text
				.setPlaceholder('Enter new API key to update')
				.onChange(() => {
					// Don't save on every keystroke - wait for button click
				});
			text.inputEl.setAttribute('type', 'password');
			return text;
		});

		apiKeySetting.addButton(button => button
			.setButtonText('Save key')
			.onClick(async () => {
				const inputEl = apiKeySetting.controlEl.querySelector('input') as HTMLInputElement;
				const value = inputEl?.value?.trim();

				if (!value) {
					apiKeyStatus.textContent = 'Please enter an API key';
					apiKeyStatus.className = 'api-key-status error';
					return;
				}

				button.setButtonText('Saving...');
				button.setDisabled(true);

				try {
					await this.plugin.setSecret(SECRET_KEY_API, value);
					this.plugin.settings.apiKeyConfigured = true;
					await this.plugin.saveSettings();
					await this.plugin.reinitializeApi();

					inputEl.value = '';
					this.updateApiKeyStatus(apiKeyStatus);
					logger.info('API key saved to SecretStorage');
				} catch (error) {
					logger.error('Failed to save API key', error);
					apiKeyStatus.textContent = 'Failed to save API key';
					apiKeyStatus.className = 'api-key-status error';
				}

				button.setButtonText('Save key');
				button.setDisabled(false);
			}));

		apiKeySetting.addButton(button => button
			.setButtonText('Clear')
			.onClick(async () => {
				await this.plugin.deleteSecret(SECRET_KEY_API);
				this.plugin.settings.apiKeyConfigured = false;
				await this.plugin.saveSettings();
				await this.plugin.reinitializeApi();
				this.updateApiKeyStatus(apiKeyStatus);
				logger.info('API key cleared from SecretStorage');
			}));

		new Setting(containerEl)
			.setName('User identifier')
			.setDesc('Email substring or name to match your user (e.g., "james" will match james@company.com)')
			.addText(text => text
				.setPlaceholder('james')
				.setValue(this.plugin.settings.userIdentifier)
				.onChange(async (value) => {
					this.plugin.settings.userIdentifier = value;
					await this.plugin.saveSettings();
				}));

		// Test connection button
		const testConnectionSetting = new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Verify your API key and user identifier work correctly');

		const resultContainer = containerEl.createDiv('test-connection-result');
		resultContainer.hide();

		testConnectionSetting.addButton(button => button
			.setButtonText('Test connection')
			.onClick(async () => {
				button.setButtonText('Testing...');
				button.setDisabled(true);

				try {
					if (!this.plugin.settings.apiKeyConfigured) {
						throw new Error('API key is not configured');
					}

					const apiKey = await this.plugin.getSecret(SECRET_KEY_API);
					if (!apiKey) {
						throw new Error('API key not found in secure storage');
					}

					const api = new IncidentIOAPI(apiKey);
					const result = await api.testConnection();

					if (result.success) {
						const user = await api.findUser(this.plugin.settings.userIdentifier);
						if (user) {
							resultContainer.className = 'test-connection-result success';
							resultContainer.textContent = `Connected! Found user: ${user.name} (${user.email})`;
						} else {
							resultContainer.className = 'test-connection-result error';
							resultContainer.textContent = `API connected but couldn't find user matching "${this.plugin.settings.userIdentifier}"`;
						}
					} else {
						resultContainer.className = 'test-connection-result error';
						resultContainer.textContent = `Connection failed: ${result.error}`;
					}
				} catch (error) {
					resultContainer.className = 'test-connection-result error';
					resultContainer.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
				}

				resultContainer.show();
				button.setButtonText('Test connection');
				button.setDisabled(false);
			}));

		// Sync Configuration
		new Setting(containerEl).setName('Sync configuration').setHeading();

		new Setting(containerEl)
			.setName('Incident notes folder')
			.setDesc('Folder where separate incident note files will be created')
			.addText(text => text
				.setPlaceholder('Incidents')
				.setValue(this.plugin.settings.incidentNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.incidentNotesFolder = value ? normalizePath(value) : 'Incidents';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Historical days')
			.setDesc(`Sync incidents from the last N days (0 = only active incidents, max ${MAX_HISTORICAL_DAYS})`)
			.addText(text => text
				.setPlaceholder('0')
				.setValue(String(this.plugin.settings.historicalSyncDays))
				.onChange(async (value) => {
					const validated = validateNonNegativeInt(value, MAX_HISTORICAL_DAYS);
					if (validated !== null) {
						this.plugin.settings.historicalSyncDays = validated;
						await this.plugin.saveSettings();
					}
					// Invalid input silently ignored - field reverts on re-open
				}));

		new Setting(containerEl)
			.setName('Backfill daily notes')
			.setDesc('Add incident links to older daily notes when syncing historical incidents')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.updatePreviousDailyNotes)
				.onChange(async (value) => {
					this.plugin.settings.updatePreviousDailyNotes = value;
					await this.plugin.saveSettings();
				}));

		// Daily Note Display
		new Setting(containerEl).setName('Daily note display').setHeading();

		new Setting(containerEl)
			.setName('Daily notes folder')
			.setDesc('Path to your daily notes folder (leave empty to auto-detect from Periodic Notes or Daily Notes plugin)')
			.addText(text => text
				.setPlaceholder('e.g., Notes/Daily Notes')
				.setValue(this.plugin.settings.dailyNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotesFolder = value.trim() ? normalizePath(value.trim()) : '';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Section header')
			.setDesc('The markdown header to use for the incidents section (must start with #)')
			.addText(text => text
				.setPlaceholder('## Incidents')
				.setValue(this.plugin.settings.sectionHeader)
				.onChange(async (value) => {
					const validated = validateSectionHeader(value);
					if (validated !== null) {
						this.plugin.settings.sectionHeader = validated;
						await this.plugin.saveSettings();
					} else if (value.trim() === '') {
						// Allow clearing to reset to default
						this.plugin.settings.sectionHeader = '## Incidents';
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Show on-call status')
			.setDesc('Include on-call schedule information')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showOnCall)
				.onChange(async (value) => {
					this.plugin.settings.showOnCall = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show incidents')
			.setDesc('Include active incidents in daily notes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showIncidents)
				.onChange(async (value) => {
					this.plugin.settings.showIncidents = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Omit empty sections')
			.setDesc('Hide sections when there\'s nothing to report')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.omitEmptySections)
				.onChange(async (value) => {
					this.plugin.settings.omitEmptySections = value;
					await this.plugin.saveSettings();
				}));

		// Auto-sync
		new Setting(containerEl).setName('Auto-sync').setHeading();

		new Setting(containerEl)
			.setName('Enable auto-sync')
			.setDesc('Automatically sync at regular intervals')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSyncEnabled)
				.onChange(async (value) => {
					this.plugin.settings.autoSyncEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync frequency')
			.setDesc('How often to automatically sync')
			.addDropdown(dropdown => dropdown
				.addOption('60000', '1 minute')
				.addOption('300000', '5 minutes')
				.addOption('600000', '10 minutes')
				.addOption('1800000', '30 minutes')
				.addOption('3600000', '1 hour')
				.setValue(String(this.plugin.settings.autoSyncFrequency))
				.onChange(async (value) => {
					this.plugin.settings.autoSyncFrequency = parseInt(value, 10);
					await this.plugin.saveSettings();
				}));

		// Sync Now - single prominent button
		new Setting(containerEl).setName('Sync').setHeading();

		new Setting(containerEl)
			.setName('Sync everything')
			.setDesc('Fetch incidents, create/update note files, and update daily notes')
			.addButton(button => button
				.setButtonText('Sync now')
				.setCta()
				.onClick(async () => {
					button.setButtonText('Syncing...');
					button.setDisabled(true);

					await this.plugin.syncToDaily();

					button.setButtonText('Sync now');
					button.setDisabled(false);
				}));

		new Setting(containerEl)
			.setName('Clear incidents section')
			.setDesc('Remove the incidents section from today\'s daily note')
			.addButton(button => button
				.setButtonText('Clear')
				.onClick(async () => {
					button.setButtonText('Clearing...');
					button.setDisabled(true);

					const success = await this.plugin.clearIncidentsSection();
					button.setButtonText(success ? 'Cleared!' : 'No daily note');

					setTimeout(() => {
						button.setButtonText('Clear');
						button.setDisabled(false);
					}, 2000);
				}));
	}
}
