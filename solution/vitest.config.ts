import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		pool: 'forks',
		globals: true,
		include: ['spec/**/*.spec.js'],
		testTimeout: 10000,
		coverage: {
			provider: 'v8',
			include: ['packages/*/src/**/*.js']
		},
		projects: [
			{
				extends: true,
				test: {
					name: 'parser',
					root: 'packages/parser',
					setupFiles: ['spec/setup.js']
				}
			},
			{ extends: true, test: { name: 'cli', root: 'packages/cli' } },
			{ extends: true, test: { name: 'db', root: 'packages/db' } },
			{ extends: true, test: { name: 'dbml', root: 'packages/dbml' } },
			{ extends: true, test: { name: 'postgres', root: 'packages/postgres' } }
		]
	}
})
