import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs'
import path from 'path'
import {
	padVersion,
	listSnapshots,
	readSnapshot,
	latestSnapshot,
	nextVersion,
	checksumOf,
	createSnapshot,
	pendingMigrations
} from '../src/snapshot.js'

const TMP = path.join('spec', '_tmp_snapshots')

const writeSnap = (dir, version, data = {}) => {
	const snapshotsDir = path.join(dir, 'snapshots')
	mkdirSync(snapshotsDir, { recursive: true })
	writeFileSync(
		path.join(snapshotsDir, `${padVersion(version)}.json`),
		JSON.stringify({
			version,
			tables: [],
			description: '',
			timestamp: '2026-01-01T00:00:00Z',
			...data
		})
	)
}

const writeMigration = (dir, from, to, { altered = [], dropped = [] } = {}) => {
	const migrationDir = path.join(dir, 'migrations', padVersion(to))
	mkdirSync(migrationDir, { recursive: true })
	const graph = { fromVersion: from, toVersion: to, altered, dropped }
	writeFileSync(path.join(migrationDir, 'graph.json'), JSON.stringify(graph))
}

beforeEach(() => {
	mkdirSync(TMP, { recursive: true })
})

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true })
})

describe('padVersion', () => {
	it('pads to 3 digits', () => {
		expect(padVersion(1)).toBe('001')
		expect(padVersion(12)).toBe('012')
		expect(padVersion(123)).toBe('123')
	})
})

describe('listSnapshots', () => {
	it('returns empty array when directory does not exist', () => {
		expect(listSnapshots(TMP)).toEqual([])
	})

	it('returns sorted list of snapshots', () => {
		writeSnap(TMP, 2, { description: 'second' })
		writeSnap(TMP, 1, { description: 'first' })
		const list = listSnapshots(TMP)
		expect(list).toHaveLength(2)
		expect(list[0].version).toBe(1)
		expect(list[1].version).toBe(2)
	})
})

describe('readSnapshot', () => {
	it('returns null when file does not exist', () => {
		expect(readSnapshot(1, TMP)).toBeNull()
	})

	it('reads snapshot by version', () => {
		writeSnap(TMP, 1, { description: 'test' })
		const snap = readSnapshot(1, TMP)
		expect(snap.version).toBe(1)
		expect(snap.description).toBe('test')
	})
})

describe('latestSnapshot', () => {
	it('returns null when no snapshots', () => {
		expect(latestSnapshot(TMP)).toBeNull()
	})

	it('returns the highest version snapshot', () => {
		writeSnap(TMP, 1)
		writeSnap(TMP, 2, { description: 'latest' })
		const snap = latestSnapshot(TMP)
		expect(snap.version).toBe(2)
	})
})

describe('nextVersion', () => {
	it('returns 1 when no snapshots', () => {
		expect(nextVersion(TMP)).toBe(1)
	})

	it('returns max+1', () => {
		writeSnap(TMP, 1)
		writeSnap(TMP, 2)
		expect(nextVersion(TMP)).toBe(3)
	})
})

describe('checksumOf', () => {
	it('returns a hex string', () => {
		const cs = checksumOf('hello')
		expect(cs).toMatch(/^[0-9a-f]{64}$/)
	})

	it('returns different values for different input', () => {
		expect(checksumOf('a')).not.toBe(checksumOf('b'))
	})
})

describe('createSnapshot', () => {
	it('creates first snapshot with no migration', async () => {
		const adapter = {
			parseTableSnapshot: (e) => ({
				name: e.name,
				schema: e.schema,
				columns: [],
				indexes: [],
				tableConstraints: []
			})
		}
		const entities = [
			{ type: 'table', name: 'public.users', schema: 'public', file: 'ddl/table/public/users.ddl' }
		]

		const result = await createSnapshot(adapter, entities, 'initial', { dir: TMP })

		expect(result.version).toBe(1)
		expect(result.migrationDir).toBeNull()
		expect(existsSync(path.join(TMP, 'snapshots', '001.json'))).toBe(true)
	})

	it('creates second snapshot with migration when tables differ', async () => {
		// Write first snapshot manually
		writeSnap(TMP, 1, {
			tables: [
				{ name: 'public.users', schema: 'public', columns: [], indexes: [], tableConstraints: [] }
			]
		})

		const adapter = {
			parseTableSnapshot: (e) => ({
				name: e.name,
				schema: e.schema,
				columns: [
					{ name: 'email', dataType: 'text', nullable: true, defaultValue: null, constraints: [] }
				],
				indexes: [],
				tableConstraints: []
			})
		}
		const entities = [{ type: 'table', name: 'public.users', schema: 'public', file: 'x.ddl' }]

		const result = await createSnapshot(adapter, entities, 'add email', { dir: TMP })

		expect(result.version).toBe(2)
		expect(result.migrationDir).toBeTruthy()
		expect(existsSync(path.join(TMP, 'migrations', '002', 'graph.json'))).toBe(true)
		const graph = JSON.parse(
			readFileSync(path.join(TMP, 'migrations', '002', 'graph.json'), 'utf-8')
		)
		expect(graph.altered).toContain('public.users')
		expect(existsSync(path.join(TMP, 'migrations', '002', 'public', 'users.sql'))).toBe(true)
		const sql = readFileSync(path.join(TMP, 'migrations', '002', 'public', 'users.sql'), 'utf-8')
		expect(sql).toContain('ADD COLUMN')
	})

	it('creates second snapshot with no migration when no changes', async () => {
		const tableData = {
			name: 'public.users',
			schema: 'public',
			columns: [],
			indexes: [],
			tableConstraints: []
		}
		writeSnap(TMP, 1, { tables: [tableData] })

		const adapter = {
			parseTableSnapshot: () => tableData
		}
		const entities = [{ type: 'table', name: 'public.users', schema: 'public', file: 'x.ddl' }]

		const result = await createSnapshot(adapter, entities, 'no change', { dir: TMP })
		expect(result.migrationDir).toBeNull()
		expect(existsSync(path.join(TMP, 'migrations', '002'))).toBe(false)
	})
})

describe('pendingMigrations', () => {
	it('returns empty array when no migrations dir', () => {
		expect(pendingMigrations(0, TMP)).toEqual([])
	})

	it('returns migrations after currentDbVersion', () => {
		writeMigration(TMP, 1, 2)
		writeMigration(TMP, 2, 3)
		// currentDbVersion=1 means versions 2 and 3 are both pending
		const pending = pendingMigrations(1, TMP)
		expect(pending).toHaveLength(2)
		expect(pending[0].toVersion).toBe(2)
		expect(pending[1].toVersion).toBe(3)
	})

	it('returns all migrations when db is at version 0', () => {
		writeMigration(TMP, 1, 2)
		writeMigration(TMP, 2, 3)
		const pending = pendingMigrations(0, TMP)
		expect(pending).toHaveLength(2)
		expect(pending[0].migrationDir).toBeDefined()
	})

	it('returns none when db is up to date', () => {
		writeMigration(TMP, 1, 2)
		writeMigration(TMP, 2, 3)
		expect(pendingMigrations(3, TMP)).toHaveLength(0)
	})

	it('attaches checksum to each migration', () => {
		writeMigration(TMP, 1, 2)
		const [m] = pendingMigrations(0, TMP)
		expect(m.checksum).toMatch(/^[0-9a-f]{64}$/)
	})
})
