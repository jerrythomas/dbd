import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		pool: 'forks',
		globals: true,
		include: ['spec/**/*.spec.js'],
		testTimeout: 10000,
		coverage: {
			provider: 'v8',
			include: ['packages/*/src/**/*.js'],
			exclude: [
				'packages/cli/src/index.js',
				'packages/postgres/src/parser/parse-ddl.js',
				'packages/postgres/src/parser/transformers/ast.js'
			],
			thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 }
		},
		projects: [
			{
				extends: true,
				test: {
					name: 'postgres',
					root: 'packages/postgres',
					setupFiles: ['spec/parser/setup.js']
				}
			},
			{ extends: true, test: { name: 'cli', root: 'packages/cli' } },
			{ extends: true, test: { name: 'db', root: 'packages/db' } },
			{ extends: true, test: { name: 'dbml', root: 'packages/dbml' } }
		]
	}
})
