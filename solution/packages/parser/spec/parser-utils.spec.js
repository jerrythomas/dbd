// dbd/packages/parser/spec/parser-utils.spec.js
import { describe, it, expect, vi } from 'vitest'
import {
	lookupTableDDL,
	lookupValueTableDDL,
	gendersViewDDL,
	importJsonbProcedureDDL
} from './fixtures/ddl-samples.js'
import { SQLParser, validateDDL } from '../src/parser-utils.js'

// Tests for the SQLParser class
describe('SQLParser Utility', () => {
	const parser = new SQLParser()

	describe('Basic parsing', () => {
		it('should parse SQL without errors', () => {
			expect(() => parser.parse(lookupTableDDL)).not.toThrow()
			expect(() => parser.parse(gendersViewDDL)).not.toThrow()
			expect(() => parser.parse(importJsonbProcedureDDL)).not.toThrow()
		})

		it.skip('should handle syntax errors gracefully', () => {
			const invalidSQL = 'CREATE TABLE missing_semicolon (id int'
			// This SQL is missing a closing parenthesis, should throw
			expect(() => parser.validateDDL(invalidSQL)).toHaveProperty('valid', false)
		})
	})

	describe('Table extraction', () => {
		it('should extract table definitions correctly', () => {
			const ast = parser.parse(lookupTableDDL)
			const tables = parser.extractTableDefinitions(ast)

			expect(tables.length).toBe(1)
			expect(tables[0].name).toBe('lookups')
			expect(tables[0].columns.length).toBe(7)

			// Check id column
			const idColumn = tables[0].columns.find((c) => c.name === 'id')
			expect(idColumn).toBeDefined()
			expect(idColumn.dataType).toContain('uuid')
			expect(idColumn.nullable).toBe(false)
			expect(idColumn.constraints.some((c) => c.type === 'PRIMARY KEY')).toBe(true)

			// Check comments
			expect(tables[0].comments.table).toContain('Generic lookup table')
			expect(tables[0].comments.columns).toBeDefined()
			expect(tables[0].comments.columns['id']).toContain('Unique identifier')
		})

		it('should extract foreign key relationships', () => {
			const ast = parser.parse(lookupValueTableDDL)
			const tables = parser.extractTableDefinitions(ast)

			expect(tables.length).toBe(1)
			expect(tables[0].name).toBe('lookup_values')

			// Check lookup_id column with FK constraint
			const lookupIdColumn = tables[0].columns.find((c) => c.name === 'lookup_id')
			expect(lookupIdColumn).toBeDefined()
			expect(lookupIdColumn.constraints.some((c) => c.type === 'FOREIGN KEY')).toBe(true)

			const fkConstraint = lookupIdColumn.constraints.find((c) => c.type === 'FOREIGN KEY')
			expect(fkConstraint.table).toBe('lookups')
		})
	})

	describe('View extraction', () => {
		it.skip('should extract view definitions correctly', () => {
			const ast = parser.parse(gendersViewDDL)
			const views = parser.extractViewDefinitions(ast)

			expect(views.length).toBe(1)
			expect(views[0].name).toBe('genders')
			expect(views[0].replace).toBe(true)

			// Check columns
			expect(views[0].columns.length).toBe(3)
			expect(views[0].columns[0].name).toBe('id')
			expect(views[0].columns[0].source.table).toBe('lv')

			// Check dependencies
			expect(views[0].dependencies.length).toBe(2)
			expect(views[0].dependencies[0].name).toBe('lookups')
			expect(views[0].dependencies[0].alias).toBe('lkp')
			expect(views[0].dependencies[1].name).toBe('lookup_values')
			expect(views[0].dependencies[1].alias).toBe('lv')
		})
	})

	describe('Procedure extraction', () => {
		it.skip('should extract procedure definitions correctly', () => {
			const ast = parser.parse(importJsonbProcedureDDL)
			const procedures = parser.extractProcedureDefinitions(ast)

			expect(procedures.length).toBe(1)
			expect(procedures[0].name).toBe('import_jsonb_to_table')
			expect(procedures[0].language).toBe('plpgsql')

			// Check parameters
			expect(procedures[0].parameters.length).toBe(2)
			expect(procedures[0].parameters[0].name).toBe('source')
			expect(procedures[0].parameters[0].dataType).toBe('varchar')
			expect(procedures[0].parameters[1].name).toBe('target')

			// Check body extraction
			expect(procedures[0].body).toContain('begin')
			expect(procedures[0].body).toContain('end')

			// Check table references
			expect(procedures[0].tableReferences).toContain('information_schema.columns')
		})
	})

	describe('Full schema extraction', () => {
		it('should extract a complete schema from multiple statements', () => {
			// Combine multiple DDL statements to test full schema extraction
			const combinedDDL = `
        ${lookupTableDDL}
        
        ${lookupValueTableDDL}
        
        ${gendersViewDDL}
      `

			const schema = parser.extractSchema(combinedDDL)

			expect(schema.tables.length).toBe(2)
			expect(schema.views.length).toBe(1)
			expect(schema.procedures.length).toBe(0)

			// Check relationships between objects
			const lookupValuesTable = schema.tables.find((t) => t.name === 'lookup_values')
			expect(lookupValuesTable).toBeDefined()

			const fkColumn = lookupValuesTable.columns.find((c) => c.name === 'lookup_id')
			expect(fkColumn).toBeDefined()

			const fkConstraint = fkColumn.constraints.find((c) => c.type === 'FOREIGN KEY')
			expect(fkConstraint).toBeDefined()
			expect(fkConstraint.table).toBe('lookups')

			// Check that view references the tables
			const gendersView = schema.views[0]
			const lookupsDep = gendersView.dependencies.find((d) => d.name === 'lookups')
			const lookupValuesDep = gendersView.dependencies.find((d) => d.name === 'lookup_values')

			expect(lookupsDep).toBeDefined()
			expect(lookupValuesDep).toBeDefined()
		})
	})
})

describe('validateDDL function', () => {
	it('should return valid true for correct SQL', () => {
		const result = validateDDL('CREATE TABLE test (id int);')
		expect(result.valid).toBe(true)
	})

	it('should return valid false with message for incorrect SQL', () => {
		const result = validateDDL('CREATE TABLE test (id int')
		expect(result.valid).toBe(false)
		expect(result.message).toBeDefined()
	})
})
