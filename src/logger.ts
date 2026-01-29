/**
 * Simple logger utility with consistent prefix formatting.
 */
export class Logger {
	constructor(private prefix: string) {}

	debug(message: string, ...args: unknown[]): void {
		console.debug(`[${this.prefix}] ${message}`, ...args);
	}

	info(message: string, ...args: unknown[]): void {
		console.log(`[${this.prefix}] ${message}`, ...args);
	}

	warn(message: string, ...args: unknown[]): void {
		console.warn(`[${this.prefix}] ${message}`, ...args);
	}

	error(message: string, error?: unknown): void {
		console.error(`[${this.prefix}] ${message}`, error);
	}
}

// Shared logger instance for the plugin
export const logger = new Logger('incident-io-sync');
