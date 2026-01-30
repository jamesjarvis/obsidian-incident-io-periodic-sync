import { App, TFile, normalizePath, Plugin } from 'obsidian';
import { SyncResult, IncidentIOSyncSettings, FullIncident } from './types';
import { logger } from './logger';

// Type declarations for internal Obsidian plugin APIs
interface PeriodicNotesSettings {
	daily?: {
		enabled?: boolean;
		folder?: string;
		format?: string;
	};
}

interface PeriodicNotesPlugin extends Plugin {
	settings?: PeriodicNotesSettings;
}

interface DailyNotesPluginInstance {
	options?: {
		folder?: string;
		format?: string;
	};
}

interface InternalPlugin {
	enabled?: boolean;
	instance?: DailyNotesPluginInstance;
}

interface InternalPlugins {
	getPluginById?(id: string): InternalPlugin | undefined;
}

interface PluginsWithPeriodic {
	getPlugin?(id: string): PeriodicNotesPlugin | undefined;
}

interface AppWithInternals extends App {
	plugins?: PluginsWithPeriodic;
	internalPlugins?: InternalPlugins;
}

export class DailyNoteManager {
	private app: App;
	private settings: IncidentIOSyncSettings;

	constructor(app: App, settings: IncidentIOSyncSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: IncidentIOSyncSettings): void {
		this.settings = settings;
	}

	private formatDateWithPattern(date: Date, format: string): string {
		const year = date.getFullYear();
		const month = date.getMonth() + 1;
		const day = date.getDate();

		return format
			.replace('YYYY', String(year))
			.replace('MM', String(month).padStart(2, '0'))
			.replace('DD', String(day).padStart(2, '0'));
	}

	// Get daily notes folder and date format from various sources
	private getDailyNotesConfig(): { folder: string; format: string } {
		// 1. Use manual setting if configured
		if (this.settings.dailyNotesFolder) {
			return {
				folder: this.settings.dailyNotesFolder,
				format: 'YYYY-MM-DD',
			};
		}

		// 2. Try Periodic Notes plugin (community plugin)
		const appWithInternals = this.app as AppWithInternals;
		const periodicNotes = appWithInternals.plugins?.getPlugin?.('periodic-notes');
		if (periodicNotes?.settings?.daily?.enabled) {
			const dailySettings = periodicNotes.settings.daily;
			return {
				folder: dailySettings.folder || '',
				format: dailySettings.format || 'YYYY-MM-DD',
			};
		}

		// 3. Try Daily Notes core plugin
		const internalPlugins = appWithInternals.internalPlugins;
		const dailyNotesPlugin = internalPlugins?.getPluginById?.('daily-notes');
		if (dailyNotesPlugin?.enabled) {
			const dailyNotesSettings = dailyNotesPlugin.instance?.options || {};
			return {
				folder: dailyNotesSettings.folder || '',
				format: dailyNotesSettings.format || 'YYYY-MM-DD',
			};
		}

		// 4. Default fallback
		return {
			folder: '',
			format: 'YYYY-MM-DD',
		};
	}

	getDailyNote(): TFile | null {
		return this.getDailyNoteForDate(new Date());
	}

	getDailyNoteForDate(date: Date): TFile | null {
		try {
			const config = this.getDailyNotesConfig();
			const formatted = this.formatDateWithPattern(date, config.format);

			// Try configured path first
			const expectedPath = config.folder
				? normalizePath(`${config.folder}/${formatted}.md`)
				: `${formatted}.md`;

			const dailyNote = this.app.vault.getAbstractFileByPath(expectedPath);
			if (dailyNote instanceof TFile) {
				return dailyNote;
			}

			// If manual folder is set, don't try fallbacks
			if (this.settings.dailyNotesFolder) {
				logger.debug('Daily note not found at configured path');
				return null;
			}

			// Fallback: search for common date formats and locations
			const formats = ['YYYY-MM-DD', 'DD-MM-YYYY', 'MM-DD-YYYY'];
			const folders = ['', 'Daily Notes', 'Notes/Daily Notes'];

			for (const folder of folders) {
				for (const format of formats) {
					const formatted = this.formatDateWithPattern(date, format);
					const path = folder ? normalizePath(`${folder}/${formatted}.md`) : `${formatted}.md`;
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						return file;
					}
				}
			}

			return null;
		} catch (error) {
			logger.error('Error getting daily note', error);
			return null;
		}
	}

	formatIncidentLink(incident: FullIncident, useWikilinks: boolean): string {
		if (useWikilinks) {
			// Use wikilink with alias for display
			const wikilinkPath = normalizePath(`${this.settings.incidentNotesFolder}/${incident.reference}`);
			return `- [[${wikilinkPath}|${incident.reference}: ${incident.name}]]`;
		}

		// Fallback to external link format
		return `- [${incident.reference}](${incident.url}): "${incident.name}" (${incident.status})`;
	}

	// Filter incidents that were active on a specific date
	filterIncidentsForDate(incidents: FullIncident[], date: Date): FullIncident[] {
		const dateStart = new Date(date);
		dateStart.setHours(0, 0, 0, 0);
		const dateEnd = new Date(date);
		dateEnd.setHours(23, 59, 59, 999);

		return incidents.filter(inc => {
			const createdAt = new Date(inc.created_at);
			const closedAt = inc.closed_at ? new Date(inc.closed_at) : null;

			// Incident was created before or on this date (created_at <= end_of_day)
			const createdBeforeOrOn = createdAt <= dateEnd;

			// Incident was still open on this date (no close date, or closed at >= start_of_day)
			const stillOpenOnDate = !closedAt || closedAt >= dateStart;

			return createdBeforeOrOn && stillOpenOnDate;
		});
	}

	// Format sync result for a specific date
	formatSyncResultForDate(result: SyncResult, date: Date, useWikilinks = true): string {
		const lines: string[] = [this.settings.sectionHeader, ''];

		// Check if this is today's note
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const targetDate = new Date(date);
		targetDate.setHours(0, 0, 0, 0);
		const isToday = today.getTime() === targetDate.getTime();

		// On-call section - only show for today's note (on-call is point-in-time data)
		if (this.settings.showOnCall && isToday) {
			if (result.onCall && result.onCall.schedules.length > 0) {
				lines.push('### On-Call');
				lines.push(`- On-call for: ${result.onCall.schedules.join(', ')}`);
				lines.push('');
			} else if (!this.settings.omitEmptySections) {
				lines.push('### On-Call');
				lines.push('_Not on-call today_');
				lines.push('');
			}
		}

		// Incidents section - incidents that were active on this date
		if (this.settings.showIncidents) {
			const incidentsOnDate = this.filterIncidentsForDate(result.fullIncidents, date);

			if (incidentsOnDate.length > 0) {
				lines.push('### Active Incidents');
				for (const incident of incidentsOnDate) {
					lines.push(this.formatIncidentLink(incident, useWikilinks));
				}
				lines.push('');
			} else if (!this.settings.omitEmptySections) {
				lines.push('### Active Incidents');
				lines.push("_No incidents you're leading_");
				lines.push('');
			}
		}

		// Remove trailing empty line if omitting empty sections and nothing was added
		if (lines.length === 2 && this.settings.omitEmptySections) {
			return '';
		}

		return lines.join('\n').trimEnd();
	}

	// Legacy method for backwards compat - uses today's date
	formatSyncResult(result: SyncResult, useWikilinks = true): string {
		return this.formatSyncResultForDate(result, new Date(), useWikilinks);
	}

	async updateDailyNote(result: SyncResult, date?: Date): Promise<boolean> {
		try {
			const targetDate = date || new Date();
			const dailyNote = this.getDailyNoteForDate(targetDate);
			if (!dailyNote) {
				logger.debug('No daily note found for target date');
				return false;
			}

			const sectionContent = this.formatSyncResultForDate(result, targetDate);

			// If nothing to show and omitting empty sections, remove the section entirely
			if (!sectionContent && this.settings.omitEmptySections) {
				await this.removeSectionFromNote(dailyNote);
				return true;
			}

			let content = await this.app.vault.read(dailyNote);
			const sectionHeaderText = this.settings.sectionHeader.replace(/^#+\s*/, '').trim();

			// Use MetadataCache to find existing headings
			const fileCache = this.app.metadataCache.getFileCache(dailyNote);
			const headings = fileCache?.headings || [];

			const existingHeading = headings.find(heading =>
				heading.heading.trim() === sectionHeaderText
			);

			if (existingHeading) {
				// Found existing section, replace content
				const lines = content.split('\n');
				const sectionLineNum = existingHeading.position.start.line;

				// Find the end of this section (next heading of same or higher level, or end of file)
				let endLineNum = lines.length;
				for (const heading of headings) {
					if (heading.position.start.line > sectionLineNum && heading.level <= existingHeading.level) {
						endLineNum = heading.position.start.line;
						break;
					}
				}

				const beforeSection = lines.slice(0, sectionLineNum).join('\n');
				const afterSection = lines.slice(endLineNum).join('\n');
				content = beforeSection + (beforeSection ? '\n' : '') + sectionContent + (afterSection ? '\n' : '') + afterSection;
			} else {
				// Section not found, append to end
				content += '\n\n' + sectionContent;
			}

			await this.app.vault.process(dailyNote, () => content);
			return true;
		} catch (error) {
			logger.error('Error updating daily note', error);
			return false;
		}
	}

	async removeSectionFromNote(dailyNote: TFile): Promise<void> {
		try {
			let content = await this.app.vault.read(dailyNote);
			const sectionHeaderText = this.settings.sectionHeader.replace(/^#+\s*/, '').trim();

			const fileCache = this.app.metadataCache.getFileCache(dailyNote);
			const headings = fileCache?.headings || [];

			const existingHeading = headings.find(heading =>
				heading.heading.trim() === sectionHeaderText
			);

			if (!existingHeading) {
				return; // Section doesn't exist, nothing to remove
			}

			const lines = content.split('\n');
			const sectionLineNum = existingHeading.position.start.line;

			// Find the end of this section
			let endLineNum = lines.length;
			for (const heading of headings) {
				if (heading.position.start.line > sectionLineNum && heading.level <= existingHeading.level) {
					endLineNum = heading.position.start.line;
					break;
				}
			}

			const beforeSection = lines.slice(0, sectionLineNum).join('\n');
			const afterSection = lines.slice(endLineNum).join('\n');
			content = (beforeSection + afterSection).replace(/\n{3,}/g, '\n\n').trim();

			await this.app.vault.process(dailyNote, () => content);
		} catch (error) {
			logger.error('Error removing section from daily note', error);
		}
	}

	async clearIncidentsSection(): Promise<boolean> {
		try {
			const dailyNote = this.getDailyNote();
			if (!dailyNote) {
				return false;
			}

			await this.removeSectionFromNote(dailyNote);
			return true;
		} catch (error) {
			logger.error('Error clearing incidents section', error);
			return false;
		}
	}

	async updateDailyNoteForDate(
		date: Date,
		result: SyncResult
	): Promise<boolean> {
		// Simply delegate to updateDailyNote with the specific date
		return this.updateDailyNote(result, date);
	}
}
