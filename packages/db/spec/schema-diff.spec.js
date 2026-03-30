import { describe, it, expect } from 'vitest'
import { diffSnapshots, isEmptyDiff } from '../src/schema-diff.js'

const makeSnapshot = (version, tables) => ({ version, tables })

const makeTable = (name, schema, columns = [], indexes = [], tableConstraints = []) => ({
	name,
	schema,
	columns,
	indexes,
	tableConstraints
})

const makeCol = (name, dataType, nullable = true, defaultValue = null, constraints = []) => ({
	name,
	dataType,
	nullable,
	defaultValue,
	constraints
})

const makeIndex = (name, unique, columns) => ({
	name,
	unique,
	columns: columns.map((c) => (typeof c === 'string' ? { name: c, order: 'ASC' } : c))
})

describe('diffSnapshots', () => {
	it('reports no changes for identical snapshots', () => {
		const table = makeTable('public.users', 'public', [makeCol('id', 'uuid', false)])
		const snap = makeSnapshot(1, [table])
		const diff = diffSnapshots(snap, { ...snap, version: 2 })
		expect(isEmptyDiff(diff)).toBe(true)
	})

	it('detects added table', () => {
		const from = makeSnapshot(1, [])
		const to = makeSnapshot(2, [makeTable('public.users', 'public', [makeCol('id', 'uuid')])])
		const diff = diffSnapshots(from, to)
		expect(diff.addedTables).toHaveLength(1)
		expect(diff.addedTables[0].name).toBe('public.users')
		expect(diff.droppedTables).toHaveLength(0)
	})

	it('detects dropped table', () => {
		const from = makeSnapshot(1, [makeTable('public.users', 'public')])
		const to = makeSnapshot(2, [])
		const diff = diffSnapshots(from, to)
		expect(diff.droppedTables).toHaveLength(1)
		expect(diff.addedTables).toHaveLength(0)
	})

	it('detects added column on existing table', () => {
		const from = makeSnapshot(1, [makeTable('public.users', 'public', [makeCol('id', 'uuid')])])
		const to = makeSnapshot(2, [
			makeTable('public.users', 'public', [
				makeCol('id', 'uuid'),
				makeCol('email', 'varchar(255)', false)
			])
		])
		const diff = diffSnapshots(from, to)
		expect(diff.alteredTables).toHaveLength(1)
		const altered = diff.alteredTables[0]
		expect(altered.addedColumns).toHaveLength(1)
		expect(altered.addedColumns[0].name).toBe('email')
		expect(altered.droppedColumns).toHaveLength(0)
	})

	it('detects dropped column on existing table', () => {
		const from = makeSnapshot(1, [
			makeTable('public.users', 'public', [makeCol('id', 'uuid'), makeCol('legacy', 'text')])
		])
		const to = makeSnapshot(2, [makeTable('public.users', 'public', [makeCol('id', 'uuid')])])
		const diff = diffSnapshots(from, to)
		expect(diff.alteredTables[0].droppedColumns).toHaveLength(1)
		expect(diff.alteredTables[0].droppedColumns[0].name).toBe('legacy')
	})

	it('detects column type change', () => {
		const from = makeSnapshot(1, [
			makeTable('public.t', 'public', [makeCol('name', 'varchar(100)')])
		])
		const to = makeSnapshot(2, [makeTable('public.t', 'public', [makeCol('name', 'varchar(500)')])])
		const diff = diffSnapshots(from, to)
		const altered = diff.alteredTables[0].alteredColumns[0]
		expect(altered.column).toBe('name')
		expect(altered.changes[0]).toMatchObject({
			field: 'type',
			from: 'varchar(100)',
			to: 'varchar(500)'
		})
	})

	it('detects nullable change', () => {
		const from = makeSnapshot(1, [
			makeTable('public.t', 'public', [makeCol('email', 'text', true)])
		])
		const to = makeSnapshot(2, [makeTable('public.t', 'public', [makeCol('email', 'text', false)])])
		const diff = diffSnapshots(from, to)
		expect(diff.alteredTables[0].alteredColumns[0].changes[0]).toMatchObject({
			field: 'nullable',
			from: true,
			to: false
		})
	})

	it('detects added index', () => {
		const from = makeSnapshot(1, [makeTable('public.t', 'public', [makeCol('email', 'text')])])
		const to = makeSnapshot(2, [
			makeTable(
				'public.t',
				'public',
				[makeCol('email', 'text')],
				[makeIndex('idx_email', true, ['email'])]
			)
		])
		const diff = diffSnapshots(from, to)
		expect(diff.alteredTables[0].addedIndexes).toHaveLength(1)
		expect(diff.alteredTables[0].addedIndexes[0].name).toBe('idx_email')
	})

	it('detects dropped index', () => {
		const from = makeSnapshot(1, [
			makeTable(
				'public.t',
				'public',
				[makeCol('email', 'text')],
				[makeIndex('idx_email', true, ['email'])]
			)
		])
		const to = makeSnapshot(2, [makeTable('public.t', 'public', [makeCol('email', 'text')])])
		const diff = diffSnapshots(from, to)
		expect(diff.alteredTables[0].droppedIndexes).toHaveLength(1)
	})

	it('sets fromVersion and toVersion', () => {
		const diff = diffSnapshots(makeSnapshot(3, []), makeSnapshot(4, []))
		expect(diff.fromVersion).toBe(3)
		expect(diff.toVersion).toBe(4)
	})
})

describe('isEmptyDiff', () => {
	it('returns true when no changes', () => {
		const diff = diffSnapshots(makeSnapshot(1, []), makeSnapshot(2, []))
		expect(isEmptyDiff(diff)).toBe(true)
	})

	it('returns false when tables added', () => {
		const from = makeSnapshot(1, [])
		const to = makeSnapshot(2, [makeTable('public.t', 'public')])
		expect(isEmptyDiff(diffSnapshots(from, to))).toBe(false)
	})
})
