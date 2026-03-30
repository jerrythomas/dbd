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
		testTimeout: 120000,
		benchmark: {
			include: ['bench/db*.bench.js'],
			outputFile: { json: 'bench-results-db.json' }
		}
	}
})
