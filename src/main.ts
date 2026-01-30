import { Notice, Plugin } from 'obsidian';
import { IncidentIOSyncSettings, DEFAULT_SETTINGS, SECRET_KEY_API } from './types';
import { IncidentIOAPI, HistoricalSyncOptions } from './api';
import { DailyNoteManager } from './daily-note';
import { IncidentNoteManager } from './incident-notes';
import { IncidentIOSyncSettingTab } from './settings';
import { logger } from './logger';

// Constants
const STATUS_SUCCESS_CLEAR_MS = 5000;
const STATUS_ERROR_CLEAR_MS = 8000;
const AUTO_SYNC_STARTUP_DELAY_MS = 1000;

export default class IncidentIOSyncPlugin extends Plugin {
	settings: IncidentIOSyncSettings = DEFAULT_SETTINGS;
	private api: IncidentIOAPI | null = null;
	private dailyNoteManager: DailyNoteManager | null = null;
	private incidentNoteManager: IncidentNoteManager | null = null;
	private autoSyncInterval: number | null = null;
	private statusBarItem: HTMLElement | null = null;
	private ribbonIconEl: HTMLElement | null = null;
	private isSyncing = false;
	private hasSecretStorage = false;

	/**
	 * Check if SecretStorage API is available (Obsidian 1.10.0+).
	 */
	private checkSecretStorageAvailable(): boolean {
		return !!(
			this.app.secretStorage &&
			typeof this.app.secretStorage.get === 'function' &&
			typeof this.app.secretStorage.set === 'function'
		);
	}

	/**
	 * Get a secret value - uses SecretStorage if available, falls back to settings.
	 */
	async getSecret(key: string): Promise<string | null> {
		if (this.hasSecretStorage) {
			return await this.app.secretStorage.get(key) || null;
		}
		// Fallback: check if we have it stored in settings (legacy)
		if (key === SECRET_KEY_API && this.settings.apiKey) {
			return this.settings.apiKey;
		}
		return null;
	}

	/**
	 * Set a secret value - uses SecretStorage if available, falls back to settings.
	 */
	async setSecret(key: string, value: string): Promise<void> {
		if (this.hasSecretStorage) {
			await this.app.secretStorage.set(key, value);
		} else {
			// Fallback: store in settings (plaintext - not ideal but functional)
			if (key === SECRET_KEY_API) {
				this.settings.apiKey = value;
				await this.saveData(this.settings);
			}
		}
	}

	/**
	 * Delete a secret value.
	 */
	async deleteSecret(key: string): Promise<void> {
		if (this.hasSecretStorage) {
			await this.app.secretStorage.delete(key);
		} else {
			// Fallback: clear from settings
			if (key === SECRET_KEY_API) {
				delete this.settings.apiKey;
				await this.saveData(this.settings);
			}
		}
	}

	async onload(): Promise<void> {
		await this.loadSettings();

		// Check if SecretStorage is available (Obsidian 1.10.0+)
		this.hasSecretStorage = this.checkSecretStorageAvailable();
		if (!this.hasSecretStorage) {
			logger.info('SecretStorage not available (requires Obsidian 1.10.0+), using fallback storage');
		}

		// Migrate from plaintext API key to SecretStorage if available
		await this.migrateApiKeyToSecretStorage();

		// Initialize managers
		await this.initializeApi();
		this.dailyNoteManager = new DailyNoteManager(this.app, this.settings);
		this.incidentNoteManager = new IncidentNoteManager(this.app, this.settings);

		// Status bar
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar('idle');

		// Ribbon icon (shield for incidents)
		this.ribbonIconEl = this.addRibbonIcon('shield', 'Sync incidents to daily note', () => {
			void this.syncToDaily();
		});

		// Commands
		this.addCommand({
			id: 'sync-incidents-to-daily',
			name: 'Sync incidents to daily note',
			callback: () => {
				void this.syncToDaily();
			},
		});

		this.addCommand({
			id: 'clear-incidents-section',
			name: 'Clear incidents section from daily note',
			callback: () => {
				void this.clearIncidentsSection();
			},
		});


		// Settings tab
		this.addSettingTab(new IncidentIOSyncSettingTab(this.app, this));

		// Setup auto-sync after a short delay
		window.setTimeout(() => {
			this.setupAutoSync();
		}, AUTO_SYNC_STARTUP_DELAY_MS);
	}

	onunload(): void {
		this.clearAutoSync();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * Migrate plaintext API key from data.json to SecretStorage.
	 * This handles users upgrading from older versions.
	 * If SecretStorage isn't available, just mark it as configured.
	 */
	private async migrateApiKeyToSecretStorage(): Promise<void> {
		// Check if there's an old plaintext API key that needs migration
		if (this.settings.apiKey && !this.settings.apiKeyConfigured) {
			if (this.hasSecretStorage) {
				logger.info('Migrating API key to SecretStorage...');
				try {
					await this.app.secretStorage.set(SECRET_KEY_API, this.settings.apiKey);
					this.settings.apiKeyConfigured = true;
					// Clear the plaintext key from settings
					delete this.settings.apiKey;
					await this.saveData(this.settings);
					new Notice('Incident.io: migrated API key to secure storage');
					logger.info('API key migration complete');
				} catch (error) {
					logger.error('Failed to migrate API key to SecretStorage', error);
				}
			} else {
				// SecretStorage not available - keep using plaintext but mark as configured
				this.settings.apiKeyConfigured = true;
				await this.saveData(this.settings);
				logger.info('API key configured (plaintext fallback - upgrade Obsidian for secure storage)');
			}
		}
	}

	/**
	 * Initialize the API client with the key from SecretStorage or settings fallback.
	 */
	private async initializeApi(): Promise<void> {
		if (!this.settings.apiKeyConfigured) {
			this.api = null;
			return;
		}

		const apiKey = await this.getSecret(SECRET_KEY_API);
		if (apiKey) {
			this.api = new IncidentIOAPI(apiKey);
		} else {
			// Key was supposed to be configured but not found
			logger.warn('API key marked as configured but not found');
			this.api = null;
		}
	}

	/**
	 * Reinitialize the API client (called from settings when key changes).
	 */
	async reinitializeApi(): Promise<void> {
		await this.initializeApi();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);

		// Note: API client is NOT re-initialized here because the API key
		// is stored in SecretStorage, not in settings. Call reinitializeApi()
		// explicitly when the key changes.

		// Update daily note manager settings
		if (this.dailyNoteManager) {
			this.dailyNoteManager.updateSettings(this.settings);
		}

		// Update incident note manager settings
		if (this.incidentNoteManager) {
			this.incidentNoteManager.updateSettings(this.settings);
		}

		// Restart auto-sync with new settings
		this.setupAutoSync();
	}

	private updateStatusBar(status: 'idle' | 'syncing' | 'success' | 'error', message?: string): void {
		if (!this.statusBarItem) return;

		this.statusBarItem.empty();
		this.statusBarItem.removeClass('syncing', 'success', 'error');
		this.statusBarItem.addClass('incident-io-sync-status');

		let text = 'incident.io: ';
		switch (status) {
			case 'idle':
				text += 'Idle';
				break;
			case 'syncing':
				text += 'Syncing...';
				this.statusBarItem.addClass('syncing');
				break;
			case 'success':
				text += message || 'Synced';
				this.statusBarItem.addClass('success');
				window.setTimeout(() => this.updateStatusBar('idle'), STATUS_SUCCESS_CLEAR_MS);
				break;
			case 'error':
				text += message || 'Error';
				this.statusBarItem.addClass('error');
				window.setTimeout(() => this.updateStatusBar('idle'), STATUS_ERROR_CLEAR_MS);
				break;
		}

		this.statusBarItem.setText(text);
	}

	private setupAutoSync(): void {
		this.clearAutoSync();

		if (this.settings.autoSyncEnabled && this.settings.autoSyncFrequency > 0 && this.api) {
			this.autoSyncInterval = window.setInterval(() => {
				void this.syncToDaily().catch((error: unknown) => {
					logger.error('Auto-sync failed', error);
					// Don't show notice for auto-sync failures - just log
				});
			}, this.settings.autoSyncFrequency);
		}
	}

	private clearAutoSync(): void {
		if (this.autoSyncInterval) {
			window.clearInterval(this.autoSyncInterval);
			this.autoSyncInterval = null;
		}
	}

	private getHistoricalSyncOptions(): HistoricalSyncOptions | undefined {
		if (this.settings.historicalSyncDays <= 0) {
			return undefined;
		}

		return {
			days: this.settings.historicalSyncDays,
		};
	}

	async syncToDaily(): Promise<void> {
		if (this.isSyncing) {
			new Notice('Incident.io: sync already in progress');
			return;
		}

		if (!this.api) {
			new Notice('Incident.io: API key not configured');
			this.updateStatusBar('error', 'No API key');
			return;
		}

		if (!this.dailyNoteManager || !this.incidentNoteManager) {
			this.updateStatusBar('error', 'Internal error');
			return;
		}

		this.isSyncing = true;
		this.updateStatusBar('syncing');

		try {
			const historicalOptions = this.getHistoricalSyncOptions();
			const result = await this.api.syncData(this.settings.userIdentifier, historicalOptions);

			// Step 1: Create/update individual incident note files
			if (result.fullIncidents.length > 0) {
				await this.incidentNoteManager.syncIncidents(result.fullIncidents);
			}

			// Step 2: Update today's daily note with wikilinks
			const success = await this.dailyNoteManager.updateDailyNote(result);

			// Step 3: Backfill previous daily notes if enabled
			if (this.settings.updatePreviousDailyNotes && result.fullIncidents.length > 0) {
				await this.backfillDailyNotes(result);
			}

			if (success) {
				const incidentCount = result.fullIncidents.length;
				const activeCount = result.fullIncidents.filter(
					inc => inc.statusCategory === 'live' || inc.statusCategory === 'triage'
				).length;
				const onCallCount = result.onCall?.schedules.length || 0;

				let message = 'Synced';
				const parts = [];
				if (activeCount > 0) {
					parts.push(`${activeCount} active`);
				}
				if (incidentCount > activeCount) {
					parts.push(`${incidentCount - activeCount} historical`);
				}
				if (onCallCount > 0) {
					parts.push(`${onCallCount} on-call`);
				}
				if (parts.length > 0) {
					message = parts.join(', ');
				}

				this.updateStatusBar('success', message);
				new Notice(`incident.io: ${message}`);
			} else {
				this.updateStatusBar('error', 'No daily note');
				new Notice('Incident.io: no daily note found for today');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			this.updateStatusBar('error', 'Sync failed');
			new Notice(`incident.io sync failed: ${message}`);
			logger.error('Sync error', error);
		} finally {
			this.isSyncing = false;
		}
	}

	private async backfillDailyNotes(result: import('./types').SyncResult): Promise<void> {
		if (!this.dailyNoteManager) {
			return;
		}

		// Backfill the last N days based on historicalSyncDays setting
		// This ensures stale incidents are removed from daily notes where they shouldn't appear
		const daysToProcess = this.settings.historicalSyncDays > 0
			? this.settings.historicalSyncDays
			: 30; // Default to 30 days if not set

		const today = new Date();
		today.setHours(0, 0, 0, 0);

		logger.info(`Backfilling last ${daysToProcess} daily notes`);

		// Process each day from (today - N) to yesterday
		// Today is handled separately in syncToDaily
		for (let i = 1; i <= daysToProcess; i++) {
			const date = new Date(today);
			date.setDate(date.getDate() - i);

			// The filtering in formatSyncResultForDate will:
			// - Include only incidents that were active on this date
			// - Remove the section entirely if no incidents were active (if omitEmptySections is enabled)
			await this.dailyNoteManager.updateDailyNoteForDate(date, result);
		}

		logger.info('Backfill complete');
	}

	async clearIncidentsSection(): Promise<boolean> {
		if (!this.dailyNoteManager) {
			return false;
		}

		const success = await this.dailyNoteManager.clearIncidentsSection();
		if (success) {
			new Notice('Incident.io: cleared incidents section');
		} else {
			new Notice('Incident.io: no daily note found');
		}
		return success;
	}

}
