import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { IncidentIOSyncSettings, FullIncident, IncidentUpdate, FollowUp, IncidentAction, IncidentAttachment } from './types';
import { logger } from './logger';

export class IncidentNoteManager {
	private app: App;
	private settings: IncidentIOSyncSettings;

	constructor(app: App, settings: IncidentIOSyncSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: IncidentIOSyncSettings): void {
		this.settings = settings;
	}

	async ensureFolder(): Promise<TFolder | null> {
		const folderPath = this.settings.incidentNotesFolder;
		if (!folderPath) {
			return null;
		}

		const existing = this.app.vault.getAbstractFileByPath(folderPath);
		if (existing instanceof TFolder) {
			return existing;
		}

		try {
			await this.app.vault.createFolder(folderPath);
			return this.app.vault.getAbstractFileByPath(folderPath) as TFolder;
		} catch (error) {
			logger.error('Error creating incidents folder', error);
			return null;
		}
	}

	async findExistingNoteByIncidentId(incidentId: string): Promise<TFile | null> {
		const folderPath = this.settings.incidentNotesFolder;
		if (!folderPath) {
			return null;
		}

		const files = this.app.vault.getMarkdownFiles().filter(f =>
			f.path.startsWith(folderPath + '/')
		);

		for (const file of files) {
			const content = await this.app.vault.read(file);
			const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
			if (frontmatterMatch) {
				const idMatch = frontmatterMatch[1].match(/incident_id:\s*(.+)$/m);
				if (idMatch && idMatch[1].trim() === incidentId) {
					return file;
				}
			}
		}

		return null;
	}

	generateFilename(incident: FullIncident): string {
		// Use the reference as the filename (e.g., INC-123.md)
		return `${incident.reference}.md`;
	}

	getNotePath(incident: FullIncident): string {
		const filename = this.generateFilename(incident);
		return normalizePath(`${this.settings.incidentNotesFolder}/${filename}`);
	}

	/**
	 * Safely encode a value for YAML frontmatter.
	 * Values containing YAML special characters are JSON-encoded (quoted).
	 */
	private yamlSafeValue(value: string | number | undefined): string {
		if (value === undefined) {
			return '';
		}
		if (typeof value === 'number') {
			return String(value);
		}
		// If value contains YAML special chars or has leading/trailing whitespace, quote it
		if (/[:\#\[\]\{\}\n\r"'|>]/.test(value) || value.trim() !== value) {
			return JSON.stringify(value);
		}
		return value;
	}

	formatFrontmatter(incident: FullIncident): string {
		const lines = ['---'];

		// Always include these fields
		lines.push(`incident_id: ${this.yamlSafeValue(incident.id)}`);
		lines.push(`reference: ${this.yamlSafeValue(incident.reference)}`);
		lines.push(`name: ${this.yamlSafeValue(incident.name)}`);
		lines.push(`created_at: ${this.yamlSafeValue(incident.created_at)}`);
		lines.push(`status: ${this.yamlSafeValue(incident.status)}`);
		lines.push(`severity: ${this.yamlSafeValue(incident.severity)}`);
		lines.push(`url: ${this.yamlSafeValue(incident.url)}`);

		// Optional fields
		if (incident.updated_at) {
			lines.push(`updated_at: ${this.yamlSafeValue(incident.updated_at)}`);
		}

		if (incident.closed_at) {
			lines.push(`closed_at: ${this.yamlSafeValue(incident.closed_at)}`);
		}

		if (incident.incidentType) {
			lines.push(`type: ${this.yamlSafeValue(incident.incidentType)}`);
		}

		if (incident.durationMinutes !== undefined) {
			lines.push(`duration_minutes: ${incident.durationMinutes}`);
		}

		lines.push('---');

		return lines.join('\n');
	}

	formatIncidentContent(incident: FullIncident): string {
		const lines: string[] = [];

		// Frontmatter
		lines.push(this.formatFrontmatter(incident));
		lines.push('');

		// Title
		lines.push(`# ${incident.reference}: ${incident.name}`);
		lines.push('');

		// Summary as blockquote
		if (incident.summary) {
			lines.push(`> ${incident.summary}`);
			lines.push('');
		}

		// Overview table
		lines.push('## Overview');
		lines.push('');
		lines.push('| Field | Value |');
		lines.push('|-------|-------|');
		lines.push(`| **Status** | ${incident.status} |`);
		lines.push(`| **Severity** | ${incident.severity} |`);
		if (incident.incidentType) {
			lines.push(`| **Type** | ${incident.incidentType} |`);
		}
		if (incident.durationMinutes !== undefined) {
			lines.push(`| **Duration** | ${this.formatDuration(incident.durationMinutes)} |`);
		}
		lines.push(`| **Created** | ${this.formatDate(new Date(incident.created_at))} |`);
		if (incident.closed_at) {
			lines.push(`| **Resolved** | ${this.formatDate(new Date(incident.closed_at))} |`);
		}
		lines.push(`| **URL** | [View in incident.io](${incident.url}) |`);
		lines.push('');

		// Timestamps section (if any)
		if (incident.timestamps.length > 0) {
			lines.push('## Timestamps');
			lines.push('');
			for (const ts of incident.timestamps) {
				lines.push(`- **${ts.name}:** ${this.formatDate(new Date(ts.value))}`);
			}
			lines.push('');
		}

		// Roles section
		if (incident.roles.length > 0) {
			lines.push('## Roles');
			lines.push('');
			for (const role of incident.roles) {
				const youMarker = role.isUser ? ' (you)' : '';
				lines.push(`- **${role.role}:** ${role.assignee}${youMarker}`);
			}
			lines.push('');
		}

		// Custom fields section (if any)
		if (incident.customFields.length > 0) {
			lines.push('## Custom Fields');
			lines.push('');
			for (const field of incident.customFields) {
				lines.push(`- **${field.name}:** ${field.value}`);
			}
			lines.push('');
		}

		// Timeline section (chronological - oldest first)
		if (incident.updates.length > 0) {
			lines.push('## Timeline');
			lines.push('');

			// Sort updates chronologically (oldest first)
			const sortedUpdates = [...incident.updates].sort(
				(a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
			);

			for (const update of sortedUpdates) {
				this.formatUpdate(update, lines);
			}
		}

		// Actions section (if any)
		if (incident.actions.length > 0) {
			lines.push('## Actions');
			lines.push('');
			for (const action of incident.actions) {
				this.formatAction(action, lines);
			}
			lines.push('');
		}

		// Follow-ups section (if any)
		if (incident.followUps.length > 0) {
			lines.push('## Follow-ups');
			lines.push('');
			for (const followUp of incident.followUps) {
				this.formatFollowUp(followUp, lines);
			}
			lines.push('');
		}

		// Attachments section (if any)
		if (incident.attachments.length > 0) {
			lines.push('## Attachments');
			lines.push('');
			for (const attachment of incident.attachments) {
				this.formatAttachment(attachment, lines);
			}
			lines.push('');
		}

		// Last synced footer
		lines.push('---');
		lines.push(`*Last synced: ${this.formatDate(new Date())}*`);
		lines.push('');

		return lines.join('\n');
	}

	private formatUpdate(update: IncidentUpdate, lines: string[]): void {
		const date = new Date(update.created_at);
		lines.push(`### ${this.formatDate(date)}`);

		// Status/severity changes
		if (update.new_incident_status) {
			lines.push(`**Status changed:** → ${update.new_incident_status.name}`);
			lines.push('');
		}
		if (update.new_severity) {
			lines.push(`**Severity changed:** → ${update.new_severity.name}`);
			lines.push('');
		}

		// Message
		if (update.message) {
			lines.push(`> ${update.message.replace(/\n/g, '\n> ')}`);
		}

		// Author
		if (update.updater) {
			lines.push(`— *${update.updater.name}*`);
		}

		lines.push('');
	}

	private formatAction(action: IncidentAction, lines: string[]): void {
		const checkbox = action.status === 'completed' ? '[x]' : '[ ]';
		const assignee = action.assignee ? ` — *${action.assignee.name}*` : '';
		const description = action.description || 'Untitled action';
		lines.push(`- ${checkbox} ${description}${assignee}`);
	}

	private formatFollowUp(followUp: FollowUp, lines: string[]): void {
		const checkbox = followUp.status === 'completed' ? '[x]' : '[ ]';
		const assignee = followUp.assignee ? ` — *${followUp.assignee.name}*` : ' — *Unassigned*';

		// Include external link if available
		if (followUp.external_issue_reference?.issue_permalink) {
			lines.push(`- ${checkbox} [${followUp.title}](${followUp.external_issue_reference.issue_permalink})${assignee}`);
		} else {
			lines.push(`- ${checkbox} ${followUp.title}${assignee}`);
		}
	}

	private formatAttachment(attachment: IncidentAttachment, lines: string[]): void {
		const title = attachment.resource.title || attachment.resource.resource_type || 'Attachment';
		lines.push(`- [${title}](${attachment.resource.permalink})`);
	}

	private formatDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day} ${hours}:${minutes}`;
	}

	private formatDuration(minutes: number): string {
		if (minutes < 60) {
			return `${minutes}m`;
		}
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (mins === 0) {
			return `${hours}h`;
		}
		return `${hours}h ${mins}m`;
	}

	async createOrUpdateIncidentNote(incident: FullIncident): Promise<TFile | null> {
		// Ensure folder exists
		await this.ensureFolder();

		const notePath = this.getNotePath(incident);
		const content = this.formatIncidentContent(incident);

		// Try direct path lookup first (most common case - avoids iterating all files)
		const existingByPath = this.app.vault.getAbstractFileByPath(notePath);
		if (existingByPath instanceof TFile) {
			await this.app.vault.process(existingByPath, () => content);
			return existingByPath;
		}

		// Fallback: search by frontmatter ID (handles manually renamed files)
		const existingNote = await this.findExistingNoteByIncidentId(incident.id);
		if (existingNote) {
			await this.app.vault.process(existingNote, () => content);
			return existingNote;
		}

		// Create new note
		try {
			return await this.app.vault.create(notePath, content);
		} catch (error) {
			logger.error('Error creating incident note', error);
			return null;
		}
	}

	async syncIncidents(incidents: FullIncident[]): Promise<Map<string, string>> {
		// Returns a map of incident ID -> note path
		const notePathMap = new Map<string, string>();

		for (const incident of incidents) {
			const file = await this.createOrUpdateIncidentNote(incident);
			if (file) {
				notePathMap.set(incident.id, file.path);
			}
		}

		return notePathMap;
	}

	getWikilinkPath(incident: FullIncident): string {
		// Return path for wikilink without .md extension
		const filename = incident.reference;
		return normalizePath(`${this.settings.incidentNotesFolder}/${filename}`);
	}
}
