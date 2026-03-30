/**
 * Snapshot management — file I/O for versioned schema snapshots.
 *
 * Snapshots live in <project>/snapshots/001.json, 002.json, ...
 * Each snapshot captures the full table/index structure at a point in time.
 * Migration SQL is generated alongside each snapshot (except the first).
 */
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
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
	const { diffSnapshots, isEmptyDiff, generateMigrationSQL } =
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

	// Generate per-table migration SQL files under migrations/<version>/
	const previous = version > 1 ? readSnapshot(version - 1, dir) : null
	if (!previous) {
		return { version, migrationDir: null, snapshot }
	}

	const diff = diffSnapshots(previous, snapshot)
	if (isEmptyDiff(diff)) {
		return { version, migrationDir: null, snapshot }
	}

	const migrationDir = path.join(dir, MIGRATIONS_DIR, padVersion(version))
	mkdirSync(migrationDir, { recursive: true })

	// Write graph.json — records the apply order and which tables are altered/dropped
	const graph = {
		fromVersion: version - 1,
		toVersion: version,
		altered: (diff.alteredTables || []).map((t) => t.name),
		dropped: (diff.droppedTables || []).map((t) => t.name)
	}
	const graphFile = path.join(migrationDir, 'graph.json')
	writeFileSync(graphFile, JSON.stringify(graph, null, 2))

	// Write per-table ALTER SQL files mirroring the DDL folder structure
	for (const alteredTable of diff.alteredTables || []) {
		const parts = alteredTable.name.split('.')
		const schema = parts.length > 1 ? parts[0] : null
		const tableName = parts[parts.length - 1]
		const tableDir = schema ? path.join(migrationDir, schema) : migrationDir
		mkdirSync(tableDir, { recursive: true })
		const singleDiff = {
			...diff,
			addedTables: [],
			droppedTables: [],
			alteredTables: [alteredTable]
		}
		writeFileSync(path.join(tableDir, `${tableName}.sql`), generateMigrationSQL(singleDiff))
	}

	// Write per-table DROP SQL files
	for (const droppedTable of diff.droppedTables || []) {
		const parts = droppedTable.name.split('.')
		const schema = parts.length > 1 ? parts[0] : null
		const tableName = parts[parts.length - 1]
		const tableDir = schema ? path.join(migrationDir, schema) : migrationDir
		mkdirSync(tableDir, { recursive: true })
		const dropDiff = { ...diff, addedTables: [], alteredTables: [], droppedTables: [droppedTable] }
		writeFileSync(path.join(tableDir, `${tableName}.drop.sql`), generateMigrationSQL(dropDiff))
	}

	return { version, migrationDir, snapshot }
}

/**
 * List pending migrations (versions after currentDbVersion).
 * Each migration lives in migrations/<version>/ with a graph.json and per-table SQL files.
 * The graph.json records apply order; SQL files mirror the DDL folder structure.
 *
 * @param {number} currentDbVersion
 * @param {string} [dir]
 * @returns {Array<{ fromVersion, toVersion, migrationDir, altered, dropped, checksum }>}
 */
export const pendingMigrations = (currentDbVersion, dir = '.') => {
	const migrationsDir = path.join(dir, MIGRATIONS_DIR)
	if (!existsSync(migrationsDir)) return []

	return readdirSync(migrationsDir)
		.filter((f) => {
			if (!/^\d{3}$/.test(f)) return false
			return statSync(path.join(migrationsDir, f)).isDirectory()
		})
		.map((f) => {
			const toVersion = parseInt(f, 10)
			const migrationDir = path.join(migrationsDir, f)
			const graphFile = path.join(migrationDir, 'graph.json')
			if (!existsSync(graphFile)) return null
			const content = readFileSync(graphFile, 'utf-8')
			const graph = JSON.parse(content)
			return {
				fromVersion: graph.fromVersion,
				toVersion,
				migrationDir,
				altered: graph.altered || [],
				dropped: graph.dropped || [],
				checksum: checksumOf(content)
			}
		})
		.filter(Boolean)
		.filter(({ toVersion }) => toVersion > currentDbVersion)
		.sort((a, b) => a.toVersion - b.toVersion)
}
