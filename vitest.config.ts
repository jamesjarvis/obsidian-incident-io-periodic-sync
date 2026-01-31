import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
	},
	resolve: {
		alias: {
			// Mock obsidian module for testing - provides empty stubs
			obsidian: new URL('./src/__mocks__/obsidian.ts', import.meta.url).pathname,
		},
	},
});
