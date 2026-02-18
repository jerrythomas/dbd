import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		name: 'cli',
		globals: true,
		pool: 'forks',
		include: ['spec/**/*.spec.js'],
		testTimeout: 10000,
		coverage: {
			provider: 'v8',
			include: ['src/**/*.js'],
			thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 }
		}
	}
})
