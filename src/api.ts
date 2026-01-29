import { requestUrl } from 'obsidian';
import { logger } from './logger';
import {
	IncidentIOUser,
	Incident,
	IncidentsResponse,
	UsersResponse,
	Schedule,
	SchedulesResponse,
	ScheduleEntriesResponse,
	OnCallResult,
	IncidentResult,
	SyncResult,
	FullIncident,
	IncidentUpdate,
	IncidentUpdatesResponse,
	FollowUp,
	FollowUpsResponse,
	IncidentAction,
	ActionsResponse,
	IncidentAttachment,
	AttachmentsResponse,
	TimestampValuesResponse,
} from './types';

export interface HistoricalSyncOptions {
	days: number;
}

const API_BASE_V2 = 'https://api.incident.io/v2';
const API_BASE_V1 = 'https://api.incident.io/v1';

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30000;
const REQUEST_TIMEOUT_MS = 30000;

export class IncidentIOAPI {
	private apiKey: string;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	// Add jitter to prevent thundering herd
	private addJitter(baseMs: number): number {
		// Add ±25% jitter
		const jitterFactor = 0.75 + Math.random() * 0.5;
		return Math.round(baseMs * jitterFactor);
	}

	// Calculate backoff with exponential increase and jitter
	private calculateBackoff(attempt: number, retryAfterHeader?: string): number {
		// If server tells us how long to wait, respect that (with some jitter)
		if (retryAfterHeader) {
			const retryAfterSeconds = parseInt(retryAfterHeader, 10);
			if (!isNaN(retryAfterSeconds)) {
				return this.addJitter(retryAfterSeconds * 1000);
			}
		}

		// Exponential backoff: 500ms, 1s, 2s, 4s, 8s... capped at MAX_BACKOFF_MS
		const exponentialMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
		const cappedMs = Math.min(exponentialMs, MAX_BACKOFF_MS);
		return this.addJitter(cappedMs);
	}

	private async request<T>(endpoint: string, version: 'v1' | 'v2' = 'v2'): Promise<T> {
		const baseUrl = version === 'v1' ? API_BASE_V1 : API_BASE_V2;
		const url = `${baseUrl}${endpoint}`;

		let lastError: Error | null = null;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				const response = await requestUrl({
					url,
					method: 'GET',
					headers: {
						'Authorization': `Bearer ${this.apiKey}`,
						'Content-Type': 'application/json',
					},
					throw: false, // Don't throw on non-2xx, we'll handle it
					timeout: REQUEST_TIMEOUT_MS,
				});

				// Success
				if (response.status >= 200 && response.status < 300) {
					return response.json as T;
				}

				// Rate limited - retry with backoff
				if (response.status === 429) {
					const retryAfter = response.headers?.['retry-after'];
					const backoffMs = this.calculateBackoff(attempt, retryAfter);
					logger.debug(`Rate limited (429), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
					await this.delay(backoffMs);
					continue;
				}

				// Server errors (5xx) - retry with backoff
				if (response.status >= 500) {
					const backoffMs = this.calculateBackoff(attempt);
					logger.debug(`Server error (${response.status}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
					await this.delay(backoffMs);
					continue;
				}

				// Client errors (4xx except 429) - don't retry, throw immediately
				throw new Error(`API request failed with status ${response.status}: ${url}`);

			} catch (error) {
				// Network errors - retry with backoff
				if (error instanceof Error && !error.message.includes('API request failed')) {
					lastError = error;
					const backoffMs = this.calculateBackoff(attempt);
					logger.debug(`Network error, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
					await this.delay(backoffMs);
					continue;
				}
				throw error;
			}
		}

		throw lastError || new Error(`Max retries (${MAX_RETRIES}) exceeded for: ${url}`);
	}

	async testConnection(): Promise<{ success: boolean; error?: string; user?: IncidentIOUser }> {
		try {
			const response = await this.request<UsersResponse>('/users');
			if (response.users && response.users.length > 0) {
				return { success: true, user: response.users[0] };
			}
			return { success: false, error: 'No users found in response' };
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return { success: false, error: message };
		}
	}

	async getUsers(): Promise<IncidentIOUser[]> {
		const response = await this.request<UsersResponse>('/users');
		return response.users || [];
	}

	async findUser(identifier: string): Promise<IncidentIOUser | null> {
		const users = await this.getUsers();
		const lowerIdentifier = identifier.toLowerCase();
		return users.find(u =>
			u.email.toLowerCase().includes(lowerIdentifier) ||
			u.name.toLowerCase().includes(lowerIdentifier)
		) || null;
	}

	async getActiveIncidents(): Promise<Incident[]> {
		const response = await this.request<IncidentsResponse>('/incidents');
		return (response.incidents || []).filter(
			inc => inc.incident_status.category === 'live' ||
				inc.incident_status.category === 'triage'
		);
	}

	async getUserIncidents(userId: string): Promise<Incident[]> {
		const incidents = await this.getActiveIncidents();
		return incidents.filter(inc =>
			(inc.incident_role_assignments || []).some(
				role => role?.assignee?.id === userId && role?.role?.role_type === 'lead'
			)
		);
	}

	private formatDateForApi(date: Date): string {
		// incident.io API expects YYYY-MM-DD format
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	async getAllIncidentsPaginated(filters?: { createdAfter?: Date; activeOnly?: boolean }): Promise<Incident[]> {
		const allIncidents: Incident[] = [];
		let cursor: string | undefined;
		const pageSize = 250; // Max allowed by API

		// Build filter params
		const params = new URLSearchParams();
		params.set('page_size', String(pageSize));

		if (filters?.createdAfter) {
			params.set('created_at[gte]', this.formatDateForApi(filters.createdAfter));
		}

		if (filters?.activeOnly) {
			params.set('status_category[one_of]', 'live,triage');
		}

		const baseUrl = `/incidents?${params.toString()}`;

		do {
			let url = baseUrl;
			if (cursor) {
				url += `&after=${encodeURIComponent(cursor)}`;
			}

			const response = await this.request<IncidentsResponse & { pagination_meta?: { after?: string } }>(url);

			const incidents = response.incidents || [];
			allIncidents.push(...incidents);

			logger.debug(`Fetched page with ${incidents.length} incidents (total: ${allIncidents.length})`);

			// Get cursor for next page
			cursor = response.pagination_meta?.after;

			// Safety: stop if we got fewer results than page size (last page)
			if (incidents.length < pageSize) {
				break;
			}
		} while (cursor);

		return allIncidents;
	}

	async getUserIncidentsWithHistory(
		userId: string,
		options?: HistoricalSyncOptions
	): Promise<Incident[]> {
		// Build API filters
		const filters: { createdAfter?: Date; activeOnly?: boolean } = {};

		if (options?.days) {
			// Historical sync: filter by date
			const cutoffDate = new Date();
			cutoffDate.setDate(cutoffDate.getDate() - options.days);
			filters.createdAfter = cutoffDate;
		} else {
			// Active only: filter by status at API level
			filters.activeOnly = true;
		}

		// Fetch incidents with API-level filtering
		const allIncidents = await this.getAllIncidentsPaginated(filters);

		logger.debug(`Fetched ${allIncidents.length} incidents from API`);

		// Filter to incidents where user has ANY role assignment
		const userIncidents = allIncidents.filter(inc =>
			(inc.incident_role_assignments || []).some(
				role => role?.assignee?.id === userId
			)
		);

		logger.debug(`${userIncidents.length} incidents involve user`);

		return userIncidents;
	}

	buildBasicFullIncident(incident: Incident, userId: string): FullIncident {
		const roles = (incident.incident_role_assignments || [])
			.filter(assignment => assignment?.role && assignment?.assignee)
			.map(assignment => ({
				role: assignment.role.name || 'Unknown',
				roleType: assignment.role.role_type || 'custom',
				assignee: assignment.assignee.name || 'Unknown',
				isUser: assignment.assignee.id === userId,
			}));

		const statusCategory = incident.incident_status?.category || 'closed';

		// Parse custom fields
		const customFields = (incident.custom_field_entries || [])
			.filter(entry => entry?.custom_field?.name)
			.map(entry => {
				let value = '';
				if (entry.value_text) {
					value = entry.value_text;
				} else if (entry.value_single_select?.value) {
					value = entry.value_single_select.value;
				} else if (entry.value_multi_select?.length) {
					value = entry.value_multi_select.map(v => v.value).join(', ');
				}
				return {
					name: entry.custom_field.name,
					value,
				};
			})
			.filter(field => field.value); // Only include fields with values

		// Calculate duration if closed
		let durationMinutes: number | undefined;
		if (incident.closed_at && incident.created_at) {
			const created = new Date(incident.created_at);
			const closed = new Date(incident.closed_at);
			durationMinutes = Math.round((closed.getTime() - created.getTime()) / (1000 * 60));
		}

		return {
			id: incident.id,
			reference: incident.reference,
			name: incident.name || 'Untitled Incident',
			summary: incident.summary,
			created_at: incident.created_at,
			updated_at: incident.updated_at,
			closed_at: incident.closed_at,
			status: incident.incident_status?.name || 'Unknown',
			statusCategory,
			severity: incident.severity?.name || 'Unknown',
			incidentType: incident.incident_type?.name,
			url: `https://app.incident.io/incidents/${incident.reference}`,
			durationMinutes,
			roles,
			customFields,
			timestamps: [],
			updates: [],
			actions: [],
			followUps: [],
			attachments: [],
		};
	}

	// Check if error is a 404 (endpoint not available)
	private is404Error(error: unknown): boolean {
		if (error instanceof Error) {
			return error.message.includes('404') || error.message.includes('status 404');
		}
		return false;
	}

	// Fetch incident updates (timeline)
	async getIncidentUpdates(incidentId: string): Promise<IncidentUpdate[]> {
		try {
			const response = await this.request<IncidentUpdatesResponse>(
				`/incident_updates?incident_id=${incidentId}`
			);
			return response.incident_updates || [];
		} catch (error) {
			// Only log non-404 errors (404 means endpoint not available)
			if (!this.is404Error(error)) {
				logger.error('Error fetching updates for incident', error);
			}
			return [];
		}
	}

	// Fetch follow-ups
	async getIncidentFollowUps(incidentId: string): Promise<FollowUp[]> {
		try {
			const response = await this.request<FollowUpsResponse>(
				`/follow_ups?incident_id=${incidentId}`
			);
			return (response.follow_ups || []).filter(fu => fu.status !== 'deleted');
		} catch (error) {
			if (!this.is404Error(error)) {
				logger.error('Error fetching follow-ups for incident', error);
			}
			return [];
		}
	}

	// Fetch actions
	async getIncidentActions(incidentId: string): Promise<IncidentAction[]> {
		try {
			const response = await this.request<ActionsResponse>(
				`/actions?incident_id=${incidentId}`
			);
			return (response.actions || []).filter(a => a.status !== 'deleted');
		} catch (error) {
			if (!this.is404Error(error)) {
				logger.error('Error fetching actions for incident', error);
			}
			return [];
		}
	}

	// Fetch attachments (v1 endpoint)
	async getIncidentAttachments(incidentId: string): Promise<IncidentAttachment[]> {
		try {
			const response = await this.request<AttachmentsResponse>(
				`/incident_attachments?incident_id=${incidentId}`,
				'v1'
			);
			return response.incident_attachments || [];
		} catch (error) {
			if (!this.is404Error(error)) {
				logger.error('Error fetching attachments for incident', error);
			}
			return [];
		}
	}

	// Fetch timestamp values for an incident
	async getIncidentTimestamps(incidentId: string): Promise<Array<{ name: string; value: string }>> {
		try {
			const response = await this.request<TimestampValuesResponse>(
				`/incident_timestamp_values?incident_id=${incidentId}`
			);
			return (response.incident_timestamp_values || [])
				.filter(tv => tv.value?.value)
				.map(tv => ({
					name: tv.incident_timestamp.name,
					value: tv.value!.value,
				}))
				.sort((a, b) => new Date(a.value).getTime() - new Date(b.value).getTime());
		} catch (error) {
			// 404s are expected if org doesn't have timestamps configured
			if (!this.is404Error(error)) {
				logger.error('Error fetching timestamps for incident', error);
			}
			return [];
		}
	}

	// Orchestrator: fetch all details for an incident
	async getFullIncidentDetails(
		incident: Incident,
		userId: string
	): Promise<FullIncident> {
		logger.debug(`Fetching full details for incident...`);

		// Build basic incident first
		const fullIncident = this.buildBasicFullIncident(incident, userId);

		// Fetch all additional details in parallel
		const [updates, followUps, actions, attachments, timestamps] = await Promise.all([
			this.getIncidentUpdates(incident.id),
			this.getIncidentFollowUps(incident.id),
			this.getIncidentActions(incident.id),
			this.getIncidentAttachments(incident.id),
			this.getIncidentTimestamps(incident.id),
		]);

		fullIncident.updates = updates;
		fullIncident.followUps = followUps;
		fullIncident.actions = actions;
		fullIncident.attachments = attachments;
		fullIncident.timestamps = timestamps;

		// Extract closed_at from timeline if not in incident data
		// The /v2/incidents endpoint doesn't return closed_at, but we can find it
		// in the timeline when the status changed to "closed"
		if (!fullIncident.closed_at && fullIncident.statusCategory === 'closed') {
			const closedUpdate = updates.find(u =>
				u.new_incident_status?.category === 'closed'
			);
			if (closedUpdate) {
				fullIncident.closed_at = closedUpdate.created_at;
				// Recalculate duration now we have closed_at
				const created = new Date(fullIncident.created_at);
				const closed = new Date(closedUpdate.created_at);
				fullIncident.durationMinutes = Math.round((closed.getTime() - created.getTime()) / (1000 * 60));
			}
		}

		return fullIncident;
	}

	async getSchedules(): Promise<Schedule[]> {
		const response = await this.request<SchedulesResponse>('/schedules');
		return response.schedules || [];
	}

	async getScheduleEntries(scheduleId: string, now: string): Promise<ScheduleEntriesResponse> {
		return this.request<ScheduleEntriesResponse>(
			`/schedule_entries?schedule_id=${scheduleId}&entry_window_start=${now}&entry_window_end=${now}`
		);
	}

	async getOnCallSchedules(userEmail: string): Promise<OnCallResult> {
		const schedules = await this.getSchedules();
		const now = new Date().toISOString();

		// Fetch all schedule entries in parallel
		const scheduleChecks = await Promise.all(
			schedules.map(async (schedule) => {
				try {
					const entries = await this.getScheduleEntries(schedule.id, now);
					const finalEntries = entries.schedule_entries?.final || [];

					const isOnCall = finalEntries.some(
						entry => entry.user?.email?.toLowerCase() === userEmail.toLowerCase()
					);

					return isOnCall ? schedule.name : null;
				} catch (error) {
					logger.error('Error checking schedule', error);
					return null;
				}
			})
		);

		const onCallSchedules = scheduleChecks.filter((name): name is string => name !== null);

		return { schedules: onCallSchedules };
	}

	// Process items in parallel batches with controlled concurrency
	// Uses Promise.allSettled to not fail entire batch on single failure
	private async processInBatches<T, R>(
		items: T[],
		batchSize: number,
		processor: (item: T) => Promise<R>,
		onProgress?: (completed: number, total: number) => void
	): Promise<R[]> {
		const results: R[] = [];

		for (let i = 0; i < items.length; i += batchSize) {
			const batch = items.slice(i, i + batchSize);

			// Use allSettled to not fail entire batch on single failure
			const settledResults = await Promise.allSettled(batch.map(processor));

			for (const result of settledResults) {
				if (result.status === 'fulfilled') {
					results.push(result.value);
				} else {
					logger.warn(`Batch item failed: ${result.reason}`);
				}
			}

			if (onProgress) {
				onProgress(Math.min(i + batchSize, items.length), items.length);
			}

			// Small delay between batches to be kind to the API
			if (i + batchSize < items.length) {
				await this.delay(50);
			}
		}

		return results;
	}

	async syncData(userIdentifier: string, historicalOptions?: HistoricalSyncOptions): Promise<SyncResult> {
		const user = await this.findUser(userIdentifier);
		if (!user) {
			throw new Error(`Could not find user matching: ${userIdentifier}`);
		}

		logger.info('Starting sync for user');

		const [onCall, incidents] = await Promise.all([
			this.getOnCallSchedules(user.email),
			historicalOptions
				? this.getUserIncidentsWithHistory(user.id, historicalOptions)
				: this.getUserIncidents(user.id),
		]);

		logger.info(`Found ${incidents.length} incidents to process`);

		// Build basic results immediately
		const incidentResults: IncidentResult[] = incidents.map(incident => ({
			reference: incident.reference,
			name: incident.name,
			status: incident.incident_status.name,
		}));

		// Fetch full details in parallel batches (5 incidents at a time)
		// Each incident fetches 5 endpoints in parallel internally, so 5 incidents = up to 25 concurrent requests
		const BATCH_SIZE = 5;

		const fullIncidents = await this.processInBatches(
			incidents,
			BATCH_SIZE,
			(incident) => this.getFullIncidentDetails(incident, user.id),
			(completed, total) => {
				logger.debug(`Processed ${completed}/${total} incidents`);
			}
		);

		logger.info('Sync complete');

		return {
			onCall: onCall.schedules.length > 0 ? onCall : null,
			incidents: incidentResults,
			fullIncidents,
		};
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
