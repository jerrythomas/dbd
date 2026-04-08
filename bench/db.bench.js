/**
 * Database operation benchmarks — compares PsqlAdapter vs PgAdapter.
 *
 * Requires a running PostgreSQL instance.
 * Set DATABASE_URL before running (e.g. postgres://user@localhost/mydb).
 *
 * Operations are idempotent or resetting, so vitest bench can iterate them:
 *   - apply:  CREATE OR REPLACE / CREATE IF NOT EXISTS — safe to re-run
 *   - import: truncates staging table before each load
 *   - export: reads from DB, writes to export/ folder
 *
 * Run:
 *   DATABASE_URL=postgres://... bun run bench:db
 */

import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { bench, describe, beforeAll, afterAll } from 'vitest'
import { using } from '../packages/cli/src/design.js'
import { PsqlAdapter } from '../packages/postgres/src/psql-adapter.js'
import { PgAdapter } from '../packages/postgres/src/pg-adapter.js'
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

const PROJECT = 'example'

// Share adapter instances across all bench iterations — each new PgAdapter opens a
// connection pool, so creating one per iteration would exhaust connection slots fast.
const psqlAdapter = DATABASE_URL ? new PsqlAdapter(DATABASE_URL, { project: PROJECT }) : null
const pgAdapter = DATABASE_URL ? new PgAdapter(DATABASE_URL, { project: PROJECT }) : null

const usingPsql = (file) => using(file, DATABASE_URL, 'prod', { adapter: psqlAdapter })
const usingPg = (file) => using(file, DATABASE_URL, 'prod', { adapter: pgAdapter })

// --- Apply ---

describeIfDb('apply — full schema (PsqlAdapter vs PgAdapter)', () => {
	beforeAll(async () => {
		const d = await usingPg('design.yaml')
		await d.apply()
	})

	bench(
		'psql: apply full schema',
		async () => {
			const d = await usingPsql('design.yaml')
			await d.apply()
		},
		DB_BENCH_OPTS
	)

	bench(
		'pg:   apply full schema',
		async () => {
			const d = await usingPg('design.yaml')
			await d.apply()
		},
		DB_BENCH_OPTS
	)
})

describeIfDb('apply — single entity (PsqlAdapter vs PgAdapter)', () => {
	bench(
		'psql: apply staging.lookup_values',
		async () => {
			const d = await usingPsql('design.yaml')
			await d.apply('staging.lookup_values')
		},
		DB_BENCH_OPTS
	)

	bench(
		'pg:   apply staging.lookup_values',
		async () => {
			const d = await usingPg('design.yaml')
			await d.apply('staging.lookup_values')
		},
		DB_BENCH_OPTS
	)
})

// --- Import ---

describeIfDb('import — truncate + reload (PsqlAdapter vs PgAdapter)', () => {
	beforeAll(async () => {
		const d = await usingPg('design.yaml')
		await d.apply()
	})

	bench(
		'psql: import staging.lookup_values',
		async () => {
			const d = await usingPsql('design.yaml')
			await d.importData('staging.lookup_values')
		},
		DB_BENCH_OPTS
	)

	bench(
		'pg:   import staging.lookup_values',
		async () => {
			const d = await usingPg('design.yaml')
			await d.importData('staging.lookup_values')
		},
		DB_BENCH_OPTS
	)

	bench(
		'psql: import staging.lookups',
		async () => {
			const d = await usingPsql('design.yaml')
			await d.importData('staging.lookups')
		},
		DB_BENCH_OPTS
	)

	bench(
		'pg:   import staging.lookups',
		async () => {
			const d = await usingPg('design.yaml')
			await d.importData('staging.lookups')
		},
		DB_BENCH_OPTS
	)
})

// --- Export ---

describeIfDb('export (PsqlAdapter vs PgAdapter)', () => {
	beforeAll(async () => {
		const d = await usingPg('design.yaml')
		await d.apply()
		await d.importData()
	})

	afterAll(async () => {
		await rimraf(join(exampleDir, 'export'))
		// Close the pg pool so the process can exit cleanly
		if (pgAdapter) await pgAdapter.disconnect()
	})

	bench(
		'psql: export all tables',
		async () => {
			const d = await usingPsql('design.yaml')
			await d.exportData()
		},
		DB_BENCH_OPTS
	)

	bench(
		'pg:   export all tables',
		async () => {
			const d = await usingPg('design.yaml')
			await d.exportData()
		},
		DB_BENCH_OPTS
	)
})
