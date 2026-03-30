import { describe, it, expect } from 'vitest'
import { generateMigrationSQL } from '../src/migration-generator.js'

const makeCol = (name, dataType, nullable = true, defaultValue = null, constraints = []) => ({
	name,
	dataType,
	nullable,
	defaultValue,
	constraints
})

const makeIndex = (name, unique, cols) => ({
	name,
	unique,
	columns: cols.map((c) => ({ name: c, order: 'ASC' }))
})

describe('generateMigrationSQL', () => {
	it('generates header comment', () => {
		const sql = generateMigrationSQL({
			fromVersion: 1,
			toVersion: 2,
			addedTables: [],
			droppedTables: [],
			alteredTables: []
		})
		expect(sql).toContain('Migration: version 1 → 2')
	})

	it('generates CREATE TABLE for added table', () => {
		const diff = {
			fromVersion: 1,
			toVersion: 2,
			addedTables: [
				{
					name: 'public.users',
					schema: 'public',
					columns: [
						makeCol('id', 'uuid', false, null, [{ type: 'PRIMARY KEY' }]),
						makeCol('email', 'varchar(255)', false)
					],
					indexes: [],
					tableConstraints: []
				}
			],
			droppedTables: [],
			alteredTables: []
		}
		const sql = generateMigrationSQL(diff)
		expect(sql).toContain('CREATE TABLE IF NOT EXISTS')
		expect(sql).toContain('"users"')
		expect(sql).toContain('"id"')
		expect(sql).toContain('uuid NOT NULL PRIMARY KEY')
		expect(sql).toContain('"email"')
	})

	it('generates ALTER TABLE ADD COLUMN', () => {
		const diff = {
			fromVersion: 1,
			toVersion: 2,
			addedTables: [],
			droppedTables: [],
			alteredTables: [
				{
					name: 'public.users',
					schema: 'public',
					addedColumns: [makeCol('phone', 'text')],
					droppedColumns: [],
					alteredColumns: [],
					addedIndexes: [],
					droppedIndexes: [],
					addedFKs: [],
					droppedFKs: []
				}
			]
		}
		const sql = generateMigrationSQL(diff)
		expect(sql).toContain('ALTER TABLE "public"."users" ADD COLUMN "phone" text')
	})

	it('generates ALTER TABLE DROP COLUMN with warning', () => {
		const diff = {
			fromVersion: 1,
			toVersion: 2,
			addedTables: [],
			droppedTables: [],
			alteredTables: [
				{
					name: 'public.users',
					schema: 'public',
					addedColumns: [],
					droppedColumns: [makeCol('legacy', 'text')],
					alteredColumns: [],
					addedIndexes: [],
					droppedIndexes: [],
					addedFKs: [],
					droppedFKs: []
				}
			]
		}
		const sql = generateMigrationSQL(diff)
		expect(sql).toContain('DROP COLUMN "legacy"')
		expect(sql).toContain('WARNING')
	})

	it('generates CREATE INDEX and DROP INDEX', () => {
		const diff = {
			fromVersion: 1,
			toVersion: 2,
			addedTables: [],
			droppedTables: [],
			alteredTables: [
				{
					name: 'public.users',
					schema: 'public',
					addedColumns: [],
					droppedColumns: [],
					alteredColumns: [],
					addedIndexes: [makeIndex('idx_email', true, ['email'])],
					droppedIndexes: [makeIndex('idx_old', false, ['old'])],
					addedFKs: [],
					droppedFKs: []
				}
			]
		}
		const sql = generateMigrationSQL(diff)
		expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "idx_email"')
		expect(sql).toContain('DROP INDEX IF EXISTS "idx_old"')
	})

	it('generates ALTER COLUMN TYPE with warning', () => {
		const diff = {
			fromVersion: 1,
			toVersion: 2,
			addedTables: [],
			droppedTables: [],
			alteredTables: [
				{
					name: 'public.users',
					schema: 'public',
					addedColumns: [],
					droppedColumns: [],
					alteredColumns: [
						{
							column: 'name',
							changes: [{ field: 'type', from: 'varchar(100)', to: 'varchar(500)' }]
						}
					],
					addedIndexes: [],
					droppedIndexes: [],
					addedFKs: [],
					droppedFKs: []
				}
			]
		}
		const sql = generateMigrationSQL(diff)
		expect(sql).toContain('ALTER COLUMN "name" TYPE varchar(500)')
		expect(sql).toContain('WARNING')
	})

	it('generates DROP TABLE with warning for dropped tables', () => {
		const diff = {
			fromVersion: 1,
			toVersion: 2,
			addedTables: [],
			droppedTables: [{ name: 'public.old_table', schema: 'public', columns: [] }],
			alteredTables: []
		}
		const sql = generateMigrationSQL(diff)
		expect(sql).toContain('DROP TABLE IF EXISTS "public"."old_table"')
		expect(sql).toContain('WARNING')
	})

	it('generates ADD FK CONSTRAINT', () => {
		const diff = {
			fromVersion: 1,
			toVersion: 2,
			addedTables: [],
			droppedTables: [],
			alteredTables: [
				{
					name: 'public.orders',
					schema: 'public',
					addedColumns: [],
					droppedColumns: [],
					alteredColumns: [],
					addedIndexes: [],
					droppedIndexes: [],
					addedFKs: [
						{
							name: 'orders_user_fk',
							columns: ['user_id'],
							refSchema: 'public',
							refTable: 'users',
							refColumns: ['id']
						}
					],
					droppedFKs: []
				}
			]
		}
		const sql = generateMigrationSQL(diff)
		expect(sql).toContain(
			'CONSTRAINT "orders_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id")'
		)
	})
})
