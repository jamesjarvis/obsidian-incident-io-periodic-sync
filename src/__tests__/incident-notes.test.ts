import { describe, it, expect } from 'vitest';
import { yamlSafeValue, formatDate, formatDuration } from '../incident-notes';

describe('yamlSafeValue', () => {
	it('returns empty string for undefined', () => {
		expect(yamlSafeValue(undefined)).toBe('');
	});

	it('converts numbers to strings', () => {
		expect(yamlSafeValue(123)).toBe('123');
		expect(yamlSafeValue(0)).toBe('0');
		expect(yamlSafeValue(-5)).toBe('-5');
		expect(yamlSafeValue(3.14)).toBe('3.14');
	});

	it('returns plain string unchanged when no special chars', () => {
		expect(yamlSafeValue('simple text')).toBe('simple text');
		expect(yamlSafeValue('Hello World')).toBe('Hello World');
	});

	it('quotes strings containing colons', () => {
		const result = yamlSafeValue('key: value');
		expect(result).toBe('"key: value"');
	});

	it('quotes strings containing hash symbols', () => {
		const result = yamlSafeValue('test #comment');
		expect(result).toBe('"test #comment"');
	});

	it('quotes strings containing brackets', () => {
		expect(yamlSafeValue('array [1,2,3]')).toBe('"array [1,2,3]"');
		expect(yamlSafeValue('object {a: b}')).toBe('"object {a: b}"');
	});

	it('quotes strings containing newlines', () => {
		expect(yamlSafeValue('line1\nline2')).toBe('"line1\\nline2"');
		expect(yamlSafeValue('line1\rline2')).toBe('"line1\\rline2"');
	});

	it('quotes strings containing quote characters', () => {
		expect(yamlSafeValue('say "hello"')).toBe('"say \\"hello\\""');
		expect(yamlSafeValue("it's")).toBe('"it\'s"');
	});

	it('quotes strings containing pipe or greater-than', () => {
		expect(yamlSafeValue('a | b')).toBe('"a | b"');
		expect(yamlSafeValue('a > b')).toBe('"a > b"');
	});

	it('quotes strings with leading whitespace', () => {
		expect(yamlSafeValue('  leading')).toBe('"  leading"');
		// Tab is escaped by JSON.stringify
		expect(yamlSafeValue('\tleading')).toBe('"\\tleading"');
	});

	it('quotes strings with trailing whitespace', () => {
		expect(yamlSafeValue('trailing  ')).toBe('"trailing  "');
	});
});

describe('formatDate', () => {
	it('formats date as YYYY-MM-DD HH:MM', () => {
		const date = new Date(2024, 0, 15, 14, 30); // Jan 15, 2024 14:30
		expect(formatDate(date)).toBe('2024-01-15 14:30');
	});

	it('pads single digit months with zero', () => {
		const date = new Date(2024, 0, 5, 9, 5); // Jan 5, 2024 09:05
		expect(formatDate(date)).toBe('2024-01-05 09:05');
	});

	it('pads single digit days with zero', () => {
		const date = new Date(2024, 11, 3, 8, 7); // Dec 3, 2024 08:07
		expect(formatDate(date)).toBe('2024-12-03 08:07');
	});

	it('pads single digit hours with zero', () => {
		const date = new Date(2024, 5, 15, 5, 30);
		expect(formatDate(date)).toBe('2024-06-15 05:30');
	});

	it('pads single digit minutes with zero', () => {
		const date = new Date(2024, 5, 15, 10, 5);
		expect(formatDate(date)).toBe('2024-06-15 10:05');
	});

	it('handles midnight correctly', () => {
		const date = new Date(2024, 5, 15, 0, 0);
		expect(formatDate(date)).toBe('2024-06-15 00:00');
	});

	it('handles end of day correctly', () => {
		const date = new Date(2024, 5, 15, 23, 59);
		expect(formatDate(date)).toBe('2024-06-15 23:59');
	});
});

describe('formatDuration', () => {
	it('formats minutes under 60 as Xm', () => {
		expect(formatDuration(0)).toBe('0m');
		expect(formatDuration(1)).toBe('1m');
		expect(formatDuration(30)).toBe('30m');
		expect(formatDuration(59)).toBe('59m');
	});

	it('formats exact hours as Xh', () => {
		expect(formatDuration(60)).toBe('1h');
		expect(formatDuration(120)).toBe('2h');
		expect(formatDuration(180)).toBe('3h');
	});

	it('formats hours and minutes as Xh Ym', () => {
		expect(formatDuration(61)).toBe('1h 1m');
		expect(formatDuration(90)).toBe('1h 30m');
		expect(formatDuration(150)).toBe('2h 30m');
	});

	it('handles large durations', () => {
		expect(formatDuration(1440)).toBe('24h'); // 24 hours
		expect(formatDuration(1500)).toBe('25h'); // 25 hours
		expect(formatDuration(1441)).toBe('24h 1m');
	});
});
