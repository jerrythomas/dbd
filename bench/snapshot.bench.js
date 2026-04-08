/**
 * Snapshot & diff benchmarks — measures schema comparison and migration SQL generation.
 *
 * Covers:
 *   - Diff two identical snapshots (empty diff)
 *   - Diff two snapshots with column additions (v1 → v2)
 *   - Diff two snapshots with multiple table changes (v2 → v3)
 *   - Generate migration SQL from a diff
 *   - isEmptyDiff check
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { bench, describe } from 'vitest'
import { diffSnapshots, isEmptyDiff } from '../packages/db/src/schema-diff.js'
import { generateMigrationSQL } from '../packages/db/src/migration-generator.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const snapshotsDir = join(__dirname, '../example/snapshots')

const snap1 = JSON.parse(readFileSync(join(snapshotsDir, '001.json'), 'utf-8'))
const snap2 = JSON.parse(readFileSync(join(snapshotsDir, '002.json'), 'utf-8'))
const snap3 = JSON.parse(readFileSync(join(snapshotsDir, '003.json'), 'utf-8'))

// Pre-compute diffs for the SQL generation benchmarks
const diff1to2 = diffSnapshots(snap1, snap2)
const diff2to3 = diffSnapshots(snap2, snap3)

describe('diffSnapshots', () => {
	bench('identical snapshots (empty diff)', () => {
		diffSnapshots(snap1, snap1)
	})

	bench('v1 → v2 (column additions across 3 tables)', () => {
		diffSnapshots(snap1, snap2)
	})

	bench('v2 → v3 (1 column addition)', () => {
		diffSnapshots(snap2, snap3)
	})
})

describe('isEmptyDiff', () => {
	bench('non-empty diff', () => {
		isEmptyDiff(diff1to2)
	})

	bench('empty diff (identical snapshots)', () => {
		isEmptyDiff(diffSnapshots(snap1, snap1))
	})
})

describe('generateMigrationSQL', () => {
	bench('v1 → v2 (3 tables altered)', () => {
		generateMigrationSQL(diff1to2)
	})

	bench('v2 → v3 (1 table altered)', () => {
		generateMigrationSQL(diff2to3)
	})
})
