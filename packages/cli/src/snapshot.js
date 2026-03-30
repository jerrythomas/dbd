/**
 * Snapshot management — file I/O for versioned schema snapshots.
 *
 * Snapshots live in <project>/snapshots/001.json, 002.json, ...
 * Each snapshot captures the full table/index structure at a point in time.
 * Migration SQL is generated alongside each snapshot (except the first).
 */
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

const SNAPSHOTS_DIR = 'snapshots'
const MIGRATIONS_DIR = 'migrations'
const VERSION_PAD = 3

/**
 * Zero-pad a version number.
 * @param {number} n
 * @returns {string} e.g. "003"
 */
export const padVersion = (n) => String(n).padStart(VERSION_PAD, '0')

/**
 * List all snapshots in the snapshots directory.
 * @param {string} [dir] - Project root (defaults to cwd)
 * @returns {Array<{ version: number, file: string, description: string, timestamp: string }>}
 */
export const listSnapshots = (dir = '.') => {
	const snapshotsDir = path.join(dir, SNAPSHOTS_DIR)
	if (!existsSync(snapshotsDir)) return []

	return readdirSync(snapshotsDir)
		.filter((f) => /^\d{3}\.json$/.test(f))
		.map((f) => {
			const version = parseInt(f.replace('.json', ''), 10)
			const file = path.join(snapshotsDir, f)
			try {
				const { description, timestamp } = JSON.parse(readFileSync(file, 'utf-8'))
				return { version, file, description: description || '', timestamp: timestamp || '' }
			} catch {
				return { version, file, description: '', timestamp: '' }
			}
		})
		.sort((a, b) => a.version - b.version)
}

/**
 * Read a specific snapshot from disk.
 * @param {number} version
 * @param {string} [dir]
 * @returns {Object|null} Snapshot object or null if not found
 */
export const readSnapshot = (version, dir = '.') => {
	const file = path.join(dir, SNAPSHOTS_DIR, `${padVersion(version)}.json`)
	if (!existsSync(file)) return null
	try {
		return JSON.parse(readFileSync(file, 'utf-8'))
	} catch {
		return null
	}
}

/**
 * Get the latest snapshot, or null if none exist.
 * @param {string} [dir]
 * @returns {Object|null}
 */
export const latestSnapshot = (dir = '.') => {
	const snapshots = listSnapshots(dir)
	if (snapshots.length === 0) return null
	return readSnapshot(snapshots[snapshots.length - 1].version, dir)
}

/**
 * Compute SHA-256 hex digest of a string.
 * @param {string} content
 * @returns {string}
 */
export const checksumOf = (content) => createHash('sha256').update(content).digest('hex')

/**
 * Determine the next snapshot version number.
 * @param {string} [dir]
 * @returns {number}
 */
export const nextVersion = (dir = '.') => {
	const snapshots = listSnapshots(dir)
	return snapshots.length === 0 ? 1 : snapshots[snapshots.length - 1].version + 1
}

/**
 * Create a new snapshot from the current entity set.
 * Parses all table entities using the adapter, serializes to JSON,
 * and generates a migration SQL file if a previous snapshot exists.
 *
 * @param {Object} adapter - Database adapter with parseTableSnapshot()
 * @param {Array} entities - All project entities (filtered to tables internally)
 * @param {string} description - Human-readable snapshot description
 * @param {Object} [opts]
 * @param {string} [opts.dir] - Project root directory (default: '.')
 * @param {{ diffSnapshots, generateMigrationSQL }} [opts.diff] - Injected diff functions (for testability)
 * @returns {{ version: number, migrationFile: string|null, migrationSQL: string|null, snapshot: Object }}
 */
export const createSnapshot = async (adapter, entities, description, opts = {}) => {
	const { dir = '.', diff: diffModule } = opts
	const { diffSnapshots, generateMigrationSQL, isEmptyDiff } =
		diffModule ?? (await import('@jerrythomas/dbd-db'))

	const tableEntities = entities.filter(
		(e) => e.type === 'table' && (!e.errors || e.errors.length === 0)
	)
	const tables = tableEntities.map((e) => adapter.parseTableSnapshot(e))

	const version = nextVersion(dir)
	const snapshot = {
		version,
		description: description || '',
		timestamp: new Date().toISOString(),
		tables
	}

	mkdirSync(path.join(dir, SNAPSHOTS_DIR), { recursive: true })
	const snapshotFile = path.join(dir, SNAPSHOTS_DIR, `${padVersion(version)}.json`)
	writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2))

	// Generate migration SQL if this isn't the first snapshot
	const previous = version > 1 ? readSnapshot(version - 1, dir) : null
	if (!previous) {
		return { version, migrationFile: null, migrationSQL: null, snapshot }
	}

	const diff = diffSnapshots(previous, snapshot)
	if (isEmptyDiff(diff)) {
		return { version, migrationFile: null, migrationSQL: null, snapshot }
	}

	const migrationSQL = generateMigrationSQL(diff)
	mkdirSync(path.join(dir, MIGRATIONS_DIR), { recursive: true })
	const migrationFile = path.join(
		dir,
		MIGRATIONS_DIR,
		`${padVersion(version - 1)}-to-${padVersion(version)}.sql`
	)
	writeFileSync(migrationFile, migrationSQL)

	return { version, migrationFile, migrationSQL, snapshot }
}

/**
 * List pending migration files (versions after currentDbVersion).
 * @param {number} currentDbVersion
 * @param {string} [dir]
 * @returns {Array<{ fromVersion: number, toVersion: number, file: string, checksum: string }>}
 */
export const pendingMigrations = (currentDbVersion, dir = '.') => {
	const migrationsDir = path.join(dir, MIGRATIONS_DIR)
	if (!existsSync(migrationsDir)) return []

	return readdirSync(migrationsDir)
		.filter((f) => /^\d{3}-to-\d{3}\.sql$/.test(f))
		.map((f) => {
			const match = f.match(/^(\d{3})-to-(\d{3})\.sql$/)
			const fromVersion = parseInt(match[1], 10)
			const toVersion = parseInt(match[2], 10)
			const file = path.join(migrationsDir, f)
			const sql = readFileSync(file, 'utf-8')
			return { fromVersion, toVersion, file, sql, checksum: checksumOf(sql) }
		})
		.filter(({ toVersion }) => toVersion > currentDbVersion)
		.sort((a, b) => a.toVersion - b.toVersion)
}
