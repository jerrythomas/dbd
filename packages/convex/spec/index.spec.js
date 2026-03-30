import { describe, it, expect } from 'vitest'
import {
	sqlTypeToConvex,
	columnToValidator,
	resolveTableName,
	generateSchemaTs,
	buildImportArgs,
	convexImportCommand,
	seedTable
} from '../src/index.js'

describe('@jerrythomas/dbd-convex public API', () => {
	it('exports sqlTypeToConvex', () => {
		expect(typeof sqlTypeToConvex).toBe('function')
		expect(sqlTypeToConvex('text')).toBe('v.string()')
	})

	it('exports columnToValidator', () => {
		expect(typeof columnToValidator).toBe('function')
		expect(columnToValidator({ dataType: 'text', nullable: false })).toBe('v.string()')
		expect(columnToValidator({ dataType: 'text', nullable: true })).toBe('v.optional(v.string())')
	})

	it('exports resolveTableName', () => {
		expect(typeof resolveTableName).toBe('function')
		expect(resolveTableName({ name: 'public.users', schema: 'public' })).toBe('users')
	})

	it('exports generateSchemaTs', () => {
		expect(typeof generateSchemaTs).toBe('function')
		const { content, warnings } = generateSchemaTs([])
		expect(content).toContain('export default defineSchema(')
		expect(warnings).toEqual([])
	})

	it('exports buildImportArgs', () => {
		expect(typeof buildImportArgs).toBe('function')
		expect(buildImportArgs('users', 'data.csv', 'csv', false)).toEqual([
			'convex',
			'import',
			'--table',
			'users',
			'--format',
			'csv',
			'data.csv'
		])
	})

	it('exports convexImportCommand', () => {
		expect(typeof convexImportCommand).toBe('function')
		expect(convexImportCommand('users', 'data.csv', 'csv', false)).toBe(
			'npx convex import --table users --format csv data.csv'
		)
	})

	it('exports seedTable', () => {
		expect(typeof seedTable).toBe('function')
	})
})
