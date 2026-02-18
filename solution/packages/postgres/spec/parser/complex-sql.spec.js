// dbd/packages/parser/spec/complex-sql.spec.js
import { describe, it, expect } from 'vitest'
import { extractSchema, validateDDL } from '../../src/parser/index-functional.js'
import errorHandler from '../../src/parser/utils/error-handler.js'

describe('SQL Parser - Complex SQL Statements', () => {
	// Make sure we don't see warnings in the console during tests
	beforeEach(() => {
		errorHandler.configure({ logToConsole: false })
		errorHandler.clearErrors()
	})

	const complexSQL = `
    create table if not exists config.lookup_values (
      id                       uuid primary key default uuid_generate_v4()
    , lookup_id                uuid references config.lookups(id)
    , value                    varchar(255)
    , sequence                 integer
    , is_active                boolean default true
    , is_hidden                boolean default false
    , details                  jsonb
    , description              text
    , modified_on              timestamp with time zone not null default now()
    , modified_by              varchar
    );

    create unique index if not exists config.lookup_values_ukey on config.lookup_values(lookup_id, value);

    comment on table config.lookup_values IS
    'Different values associated with various lookups.
    - Used to store predefined values for different lookup categories.
    - Each value is associated with a specific lookup.';

    comment on column config.lookup_values.id IS
    'Unique identifier for the lookup value. Ensures each value can be uniquely identified.';
  `

	describe('Validation', () => {
		it('should validate the complex SQL as valid', () => {
			const result = validateDDL(complexSQL)
			expect(result.valid).toBe(true)
		})
	})

	describe('Schema Extraction', () => {
		it('should extract table definition with correct columns', () => {
			const schema = extractSchema(complexSQL)

			// Verify table was extracted
			expect(schema.tables.length).toBeGreaterThanOrEqual(1)
			const table = schema.tables.find((t) => t.name === 'lookup_values')
			expect(table).toBeDefined()
			expect(table.schema).toBe('config')

			// Check columns
			expect(table.columns.length).toBe(10)
			expect(table.columns[0].name).toBe('id')
			expect(table.columns[0].dataType).toContain('uuid')

			// Check constraints
			const idColumn = table.columns.find((c) => c.name === 'id')
			expect(idColumn.constraints.some((c) => c.type === 'PRIMARY KEY')).toBe(true)

			// Check foreign key
			const lookupIdColumn = table.columns.find((c) => c.name === 'lookup_id')
			expect(lookupIdColumn).toBeDefined()
			expect(
				lookupIdColumn.constraints.some((c) => c.type === 'FOREIGN KEY' && c.table === 'lookups')
			).toBe(true)
		})

		it('should extract the unique index', () => {
			const schema = extractSchema(complexSQL)

			// Verify index was extracted
			expect(schema.indexes.length).toBeGreaterThanOrEqual(1)
			const index = schema.indexes.find((i) => i.name === 'lookup_values_ukey')
			expect(index).toBeDefined()
			expect(index.schema).toBe('config')
			expect(index.table).toBe('lookup_values')
			expect(index.unique).toBe(true)

			// Check index columns
			expect(index.columns.length).toBe(2)
			expect(index.columns[0].name).toBe('lookup_id')
			expect(index.columns[1].name).toBe('value')
		})

		it('should extract table and column comments', () => {
			const schema = extractSchema(complexSQL)

			const table = schema.tables.find((t) => t.name === 'lookup_values')

			// Table comment
			expect(table.comments).toBeDefined()
			expect(table.comments.table).toContain('Different values associated with various lookups')

			// Column comment
			const idColumn = table.columns.find((c) => c.name === 'id')
			expect(idColumn.comment).toContain('Unique identifier')
		})
	})
})
