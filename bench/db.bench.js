/**
 * Database operation benchmarks — measures apply, import, and export via PgAdapter.
 *
 * Requires a running PostgreSQL instance.
 * Set DATABASE_URL before running (e.g. postgres://user@localhost/mydb).
 *
 * Operations are idempotent or resetting, so vitest bench can iterate them:
 *   - apply:  CREATE OR REPLACE / CREATE IF NOT EXISTS — safe to re-run
 *   - import: truncates staging table before each load
 *   - export: reads from DB, writes to export/ folder
 *
 * Adapter: PgAdapter (postgres.js library, no subprocess)
 * Compare to psql baseline: bench-results-db.json from before the pg adapter switch.
 *
 * Run:
 *   DATABASE_URL=postgres://... bun run bench:db
 */

import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { bench, describe, beforeAll, afterAll } from 'vitest'
import { using } from '../packages/cli/src/design.js'
import { rimraf } from 'rimraf'

const __dirname = dirname(fileURLToPath(import.meta.url))
const exampleDir = join(__dirname, '../example')

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
	console.warn('DATABASE_URL not set — skipping DB benchmarks')
}

// tinybench warmup runs bench functions before beforeAll hooks fire, so set cwd
// at module level so relative paths (design.yaml, ddl/) resolve correctly.
if (DATABASE_URL) {
	process.chdir(exampleDir)
}

const describeIfDb = DATABASE_URL ? describe : describe.skip

// DB operations are slow (~100ms–2s each). Use explicit iterations so vitest bench
// can still collect meaningful samples without running for many minutes.
const DB_BENCH_OPTS = { iterations: 5, warmupIterations: 1 }

describeIfDb('dbd apply (full schema, idempotent)', () => {
	beforeAll(async () => {
		// Warm up: ensure schema exists before measuring
		const d = await using('design.yaml', DATABASE_URL)
		await d.apply()
	})

	bench(
		'apply — full schema (CREATE IF NOT EXISTS)',
		async () => {
			const d = await using('design.yaml', DATABASE_URL)
			await d.apply()
		},
		DB_BENCH_OPTS
	)

	bench(
		'apply — single entity (staging.lookup_values)',
		async () => {
			const d = await using('design.yaml', DATABASE_URL)
			await d.apply('staging.lookup_values')
		},
		DB_BENCH_OPTS
	)
})

describeIfDb('dbd import (truncate + reload)', () => {
	beforeAll(async () => {
		const d = await using('design.yaml', DATABASE_URL)
		await d.apply()
	})

	bench(
		'import — staging.lookup_values',
		async () => {
			const d = await using('design.yaml', DATABASE_URL)
			await d.importData('staging.lookup_values')
		},
		DB_BENCH_OPTS
	)

	bench(
		'import — staging.lookups (CSV + procedure)',
		async () => {
			const d = await using('design.yaml', DATABASE_URL)
			await d.importData('staging.lookups')
		},
		DB_BENCH_OPTS
	)
})

describeIfDb('dbd export', () => {
	beforeAll(async () => {
		const d = await using('design.yaml', DATABASE_URL)
		await d.apply()
		await d.importData()
	})

	afterAll(async () => {
		await rimraf(join(exampleDir, 'export'))
	})

	bench(
		'export — all configured tables',
		async () => {
			const d = await using('design.yaml', DATABASE_URL)
			await d.exportData()
		},
		DB_BENCH_OPTS
	)
})
