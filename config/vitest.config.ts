import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

export default defineConfig({
	test: {
		root,
		pool: 'forks',
		globals: true,
		include: ['spec/**/*.spec.js'],
		testTimeout: 10000,
		coverage: {
			provider: 'v8',
			reporter: ['lcov', 'text'],
			include: ['packages/*/src/**/*.js', 'adapters/*/src/**/*.js'],
			exclude: ['packages/cli/src/index.js', 'adapters/postgres/src/parser/parse-ddl.js'],
			thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 }
		},
		projects: [
			{
				extends: true,
				test: {
					name: 'postgres',
					root: resolve(__dirname, '../adapters/postgres'),
					setupFiles: ['spec/parser/setup.js']
				}
			},
			{
				extends: true,
				test: {
					name: 'supabase',
					root: resolve(__dirname, '../adapters/supabase')
				}
			},
			{ extends: true, test: { name: 'cli', root: resolve(__dirname, '../packages/cli') } },
			{ extends: true, test: { name: 'db', root: resolve(__dirname, '../packages/db') } },
			{ extends: true, test: { name: 'dbml', root: resolve(__dirname, '../packages/dbml') } },
			{
				extends: true,
				test: {
					name: 'convex',
					root: resolve(__dirname, '../adapters/convex')
				}
			},
			{
				extends: true,
				test: {
					name: 'sqlite',
					root: resolve(__dirname, '../adapters/sqlite')
				}
			}
		]
	}
})
