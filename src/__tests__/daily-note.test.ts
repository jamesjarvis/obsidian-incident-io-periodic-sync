import { describe, it, expect } from 'vitest';
import { filterIncidentsForDate } from '../daily-note';
import { FullIncident } from '../types';

describe('filterIncidentsForDate', () => {
	const createIncident = (overrides: Partial<FullIncident>): FullIncident => ({
		id: '123',
		reference: 'INC-123',
		name: 'Test Incident',
		created_at: '2024-01-15T10:00:00Z',
		status: 'Active',
		statusCategory: 'live',
		severity: 'High',
		url: 'https://app.incident.io/incidents/INC-123',
		roles: [],
		customFields: [],
		timestamps: [],
		updates: [],
		actions: [],
		followUps: [],
		attachments: [],
		...overrides,
	});

	it('returns empty array for empty input', () => {
		const result = filterIncidentsForDate([], new Date('2024-01-15'));
		expect(result).toEqual([]);
	});

	it('includes incident created and closed on the same day', () => {
		const incidents = [
			createIncident({
				created_at: '2024-01-15T09:00:00Z',
				closed_at: '2024-01-15T17:00:00Z',
			}),
		];

		const result = filterIncidentsForDate(incidents, new Date('2024-01-15'));
		expect(result).toHaveLength(1);
	});

	it('includes incident that spans multiple days', () => {
		const incident = createIncident({
			created_at: '2024-01-14T10:00:00Z',
			closed_at: '2024-01-16T10:00:00Z',
		});

		// Should be included for all three days
		expect(filterIncidentsForDate([incident], new Date('2024-01-14'))).toHaveLength(1);
		expect(filterIncidentsForDate([incident], new Date('2024-01-15'))).toHaveLength(1);
		expect(filterIncidentsForDate([incident], new Date('2024-01-16'))).toHaveLength(1);
	});

	it('includes open incident (no close date)', () => {
		const incidents = [
			createIncident({
				created_at: '2024-01-10T10:00:00Z',
				closed_at: undefined,
			}),
		];

		// Should be included for any date after creation
		expect(filterIncidentsForDate(incidents, new Date('2024-01-10'))).toHaveLength(1);
		expect(filterIncidentsForDate(incidents, new Date('2024-01-15'))).toHaveLength(1);
		expect(filterIncidentsForDate(incidents, new Date('2024-01-20'))).toHaveLength(1);
	});

	it('excludes incident created after the target date', () => {
		const incidents = [
			createIncident({
				created_at: '2024-01-20T10:00:00Z',
				closed_at: '2024-01-21T10:00:00Z',
			}),
		];

		const result = filterIncidentsForDate(incidents, new Date('2024-01-15'));
		expect(result).toHaveLength(0);
	});

	it('excludes incident closed before the target date', () => {
		const incidents = [
			createIncident({
				created_at: '2024-01-10T10:00:00Z',
				closed_at: '2024-01-14T10:00:00Z',
			}),
		];

		const result = filterIncidentsForDate(incidents, new Date('2024-01-15'));
		expect(result).toHaveLength(0);
	});

	it('includes incident closed at exact start of day boundary', () => {
		const incidents = [
			createIncident({
				created_at: '2024-01-10T10:00:00Z',
				closed_at: '2024-01-15T00:00:00Z', // Midnight at start of Jan 15
			}),
		];

		const result = filterIncidentsForDate(incidents, new Date('2024-01-15'));
		expect(result).toHaveLength(1);
	});

	it('includes incident created at exact end of day boundary', () => {
		const incidents = [
			createIncident({
				created_at: '2024-01-15T23:59:59Z',
				closed_at: '2024-01-16T10:00:00Z',
			}),
		];

		const result = filterIncidentsForDate(incidents, new Date('2024-01-15'));
		expect(result).toHaveLength(1);
	});

	it('filters multiple incidents correctly', () => {
		const incidents = [
			createIncident({
				id: '1',
				reference: 'INC-1',
				created_at: '2024-01-14T10:00:00Z',
				closed_at: '2024-01-15T10:00:00Z', // Active on Jan 14-15
			}),
			createIncident({
				id: '2',
				reference: 'INC-2',
				created_at: '2024-01-15T10:00:00Z',
				closed_at: '2024-01-16T10:00:00Z', // Active on Jan 15-16
			}),
			createIncident({
				id: '3',
				reference: 'INC-3',
				created_at: '2024-01-16T10:00:00Z', // Active from Jan 16
				closed_at: undefined,
			}),
			createIncident({
				id: '4',
				reference: 'INC-4',
				created_at: '2024-01-10T10:00:00Z',
				closed_at: '2024-01-12T10:00:00Z', // Already closed before Jan 15
			}),
		];

		const result = filterIncidentsForDate(incidents, new Date('2024-01-15'));
		expect(result).toHaveLength(2);
		expect(result.map(i => i.reference)).toContain('INC-1');
		expect(result.map(i => i.reference)).toContain('INC-2');
	});
});
