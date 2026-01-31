import { describe, it, expect } from 'vitest';
import { calculateBackoff, BACKOFF_CONFIG } from '../api';

describe('calculateBackoff', () => {
	// Use a no-op jitter function for predictable testing
	const noJitter = (ms: number) => ms;

	it('returns exponential backoff without jitter', () => {
		// Attempt 0: 500ms * 2^0 = 500ms
		expect(calculateBackoff(0, undefined, noJitter)).toBe(500);

		// Attempt 1: 500ms * 2^1 = 1000ms
		expect(calculateBackoff(1, undefined, noJitter)).toBe(1000);

		// Attempt 2: 500ms * 2^2 = 2000ms
		expect(calculateBackoff(2, undefined, noJitter)).toBe(2000);

		// Attempt 3: 500ms * 2^3 = 4000ms
		expect(calculateBackoff(3, undefined, noJitter)).toBe(4000);

		// Attempt 4: 500ms * 2^4 = 8000ms
		expect(calculateBackoff(4, undefined, noJitter)).toBe(8000);
	});

	it('caps backoff at MAX_BACKOFF_MS', () => {
		// Attempt 6: 500ms * 2^6 = 32000ms, capped at 30000ms
		expect(calculateBackoff(6, undefined, noJitter)).toBe(BACKOFF_CONFIG.MAX_BACKOFF_MS);

		// Attempt 10: Should still be capped
		expect(calculateBackoff(10, undefined, noJitter)).toBe(BACKOFF_CONFIG.MAX_BACKOFF_MS);
	});

	it('respects retryAfterHeader when provided', () => {
		// Server says wait 5 seconds
		expect(calculateBackoff(0, '5', noJitter)).toBe(5000);

		// Server says wait 60 seconds
		expect(calculateBackoff(0, '60', noJitter)).toBe(60000);
	});

	it('ignores invalid retryAfterHeader and uses exponential backoff', () => {
		expect(calculateBackoff(1, 'invalid', noJitter)).toBe(1000);
		expect(calculateBackoff(1, '', noJitter)).toBe(1000);
	});

	it('applies jitter when using default jitter function', () => {
		// Call multiple times and verify results are within expected range
		const results: number[] = [];
		for (let i = 0; i < 100; i++) {
			results.push(calculateBackoff(0));
		}

		// Base is 500ms, jitter is ±25%, so range is 375-625ms
		const minExpected = 500 * 0.75; // 375
		const maxExpected = 500 * 1.25; // 625

		const allInRange = results.every((r) => r >= minExpected && r <= maxExpected);
		expect(allInRange).toBe(true);

		// Verify there's some variation (not all the same)
		const uniqueValues = new Set(results);
		expect(uniqueValues.size).toBeGreaterThan(1);
	});

	it('applies jitter to retryAfterHeader value', () => {
		const results: number[] = [];
		for (let i = 0; i < 100; i++) {
			results.push(calculateBackoff(0, '10')); // 10 seconds = 10000ms
		}

		// Base is 10000ms, jitter is ±25%, so range is 7500-12500ms
		const minExpected = 10000 * 0.75;
		const maxExpected = 10000 * 1.25;

		const allInRange = results.every((r) => r >= minExpected && r <= maxExpected);
		expect(allInRange).toBe(true);
	});

	it('exposes correct config values', () => {
		expect(BACKOFF_CONFIG.MAX_RETRIES).toBe(5);
		expect(BACKOFF_CONFIG.INITIAL_BACKOFF_MS).toBe(500);
		expect(BACKOFF_CONFIG.MAX_BACKOFF_MS).toBe(30000);
	});
});
