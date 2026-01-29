// incident.io API response types

export interface IncidentIOUser {
	id: string;
	name: string;
	email: string;
}

export interface IncidentStatus {
	id: string;
	name: string;
	category: 'live' | 'triage' | 'closed' | 'merged' | 'declined' | 'paused';
}

export interface IncidentSeverity {
	id: string;
	name: string;
}

export interface IncidentRoleAssignment {
	assignee: {
		id: string;
		name: string;
		email: string;
	};
	role: {
		id: string;
		name: string;
		role_type: 'lead' | 'reporter' | 'custom';
	};
}

export interface IncidentType {
	id: string;
	name: string;
}

export interface IncidentCustomField {
	custom_field: {
		id: string;
		name: string;
		field_type: string;
	};
	value_text?: string;
	value_single_select?: {
		value: string;
	};
	value_multi_select?: Array<{
		value: string;
	}>;
}

export interface Incident {
	id: string;
	reference: string;
	name: string;
	summary?: string;
	created_at: string;
	updated_at?: string;
	closed_at?: string;
	incident_status: IncidentStatus;
	severity: IncidentSeverity;
	incident_type?: IncidentType;
	incident_role_assignments: IncidentRoleAssignment[];
	custom_field_entries?: IncidentCustomField[];
}

export interface IncidentsResponse {
	incidents: Incident[];
}

export interface UsersResponse {
	users: IncidentIOUser[];
}

export interface Schedule {
	id: string;
	name: string;
}

export interface SchedulesResponse {
	schedules: Schedule[];
}

export interface ScheduleEntry {
	user: {
		id: string;
		name: string;
		email: string;
	};
	start_at: string;
	end_at: string;
}

export interface ScheduleEntriesResponse {
	schedule_entries: {
		final: ScheduleEntry[];
	};
}

// Timeline updates from /v2/incident_updates
export interface IncidentUpdate {
	id: string;
	created_at: string;
	message?: string;
	updater?: {
		id: string;
		name: string;
		email?: string;
	};
	new_incident_status?: {
		id: string;
		name: string;
		category: string;
	};
	new_severity?: {
		id: string;
		name: string;
	};
}

export interface IncidentUpdatesResponse {
	incident_updates: IncidentUpdate[];
}

// Follow-ups from /v2/follow_ups
export interface FollowUp {
	id: string;
	title: string;
	description?: string;
	status: 'outstanding' | 'completed' | 'deleted';
	assignee?: {
		id: string;
		name: string;
	};
	external_issue_reference?: {
		issue_name: string;
		issue_permalink: string;
		provider: string;
	};
	completed_at?: string;
	created_at: string;
}

export interface FollowUpsResponse {
	follow_ups: FollowUp[];
}

// Actions from /v2/actions
export interface IncidentAction {
	id: string;
	description?: string;
	status: 'outstanding' | 'completed' | 'deleted' | 'not_doing';
	assignee?: {
		id: string;
		name: string;
	};
	completed_at?: string;
	created_at: string;
}

export interface ActionsResponse {
	actions: IncidentAction[];
}

// Attachments from /v1/incident_attachments
export interface IncidentAttachment {
	id: string;
	resource: {
		resource_type: string;
		external_id?: string;
		title?: string;
		permalink: string;
	};
}

export interface AttachmentsResponse {
	incident_attachments: IncidentAttachment[];
}

// Timestamps from /v2/incident_timestamps
export interface IncidentTimestamp {
	id: string;
	name: string;
	value?: string;
}

export interface IncidentTimestampValue {
	incident_timestamp: {
		id: string;
		name: string;
		rank: number;
	};
	value?: {
		value: string;
	};
}

export interface TimestampValuesResponse {
	incident_timestamp_values: IncidentTimestampValue[];
}

// Plugin settings
export interface IncidentIOSyncSettings {
	// DEPRECATED: Only used for migration to SecretStorage
	apiKey?: string;
	// Name of the secret in SecretStorage that contains the API key
	apiKeyConfigured: boolean;
	userIdentifier: string;
	sectionHeader: string;
	autoSyncEnabled: boolean;
	autoSyncFrequency: number;
	showOnCall: boolean;
	showIncidents: boolean;
	omitEmptySections: boolean;
	// Daily notes settings
	dailyNotesFolder: string; // Empty = auto-detect from Daily Notes / Periodic Notes plugin
	// Incident notes settings
	incidentNotesFolder: string;
	historicalSyncDays: number; // 0 = only active incidents, >0 = sync last N days
	updatePreviousDailyNotes: boolean;
}

// Secret storage key for the API key
export const SECRET_KEY_API = 'incident-io-api-key';

export const DEFAULT_SETTINGS: IncidentIOSyncSettings = {
	apiKeyConfigured: false,
	userIdentifier: 'james',
	sectionHeader: '## Incidents',
	autoSyncEnabled: true,
	autoSyncFrequency: 300000, // 5 minutes
	showOnCall: true,
	showIncidents: true,
	omitEmptySections: true,
	// Daily notes defaults
	dailyNotesFolder: '', // Empty = auto-detect
	// Incident notes defaults
	incidentNotesFolder: 'Incidents',
	historicalSyncDays: 0, // 0 = only active, default to no historical
	updatePreviousDailyNotes: false,
};

// Full incident details (for separate incident notes)
export interface FullIncident {
	id: string;
	reference: string;
	name: string;
	summary?: string;
	created_at: string;
	updated_at?: string;
	closed_at?: string;
	status: string;
	statusCategory: 'live' | 'triage' | 'closed' | 'merged' | 'declined' | 'paused';
	severity: string;
	incidentType?: string;
	url: string;
	durationMinutes?: number;
	roles: Array<{
		role: string;
		roleType: 'lead' | 'reporter' | 'custom';
		assignee: string;
		isUser: boolean; // true if this is the current user
	}>;
	customFields: Array<{
		name: string;
		value: string;
	}>;
	timestamps: Array<{
		name: string;
		value: string;
	}>;
	updates: IncidentUpdate[];
	actions: IncidentAction[];
	followUps: FollowUp[];
	attachments: IncidentAttachment[];
}

// Frontmatter for incident note files
export interface IncidentNoteFrontmatter {
	incident_id: string;
	reference: string;
	created_at: string;
	updated_at?: string;
	closed_at?: string;
	status: string;
	severity: string;
	type?: string;
	url: string;
	duration_minutes?: number;
}

// Sync result types
export interface OnCallResult {
	schedules: string[];
}

export interface IncidentResult {
	reference: string;
	name: string;
	status: string;
	// New fields for linking to incident notes
	notePath?: string;
}

export interface SyncResult {
	onCall: OnCallResult | null;
	incidents: IncidentResult[];
	// Full incident data for creating separate notes
	fullIncidents: FullIncident[];
}
