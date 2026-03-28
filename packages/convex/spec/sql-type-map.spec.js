import { describe, it, expect } from 'vitest'
import { sqlTypeToConvex, columnToValidator } from '../src/sql-type-map.js'

describe('sqlTypeToConvex', () => {
	it('maps text types to v.string()', () => {
		expect(sqlTypeToConvex('text')).toBe('v.string()')
		expect(sqlTypeToConvex('varchar')).toBe('v.string()')
		expect(sqlTypeToConvex('varchar(255)')).toBe('v.string()')
		expect(sqlTypeToConvex('uuid')).toBe('v.string()')
		expect(sqlTypeToConvex('citext')).toBe('v.string()')
		expect(sqlTypeToConvex('name')).toBe('v.string()')
	})

	it('maps integer types to v.number()', () => {
		expect(sqlTypeToConvex('integer')).toBe('v.number()')
		expect(sqlTypeToConvex('int')).toBe('v.number()')
		expect(sqlTypeToConvex('int4')).toBe('v.number()')
		expect(sqlTypeToConvex('int8')).toBe('v.number()')
		expect(sqlTypeToConvex('bigint')).toBe('v.number()')
		expect(sqlTypeToConvex('serial')).toBe('v.number()')
		expect(sqlTypeToConvex('bigserial')).toBe('v.number()')
		expect(sqlTypeToConvex('smallint')).toBe('v.number()')
	})

	it('maps float/decimal types to v.number()', () => {
		expect(sqlTypeToConvex('float4')).toBe('v.number()')
		expect(sqlTypeToConvex('float8')).toBe('v.number()')
		expect(sqlTypeToConvex('numeric')).toBe('v.number()')
		expect(sqlTypeToConvex('numeric(10,2)')).toBe('v.number()')
		expect(sqlTypeToConvex('decimal')).toBe('v.number()')
		expect(sqlTypeToConvex('money')).toBe('v.number()')
		expect(sqlTypeToConvex('real')).toBe('v.number()')
	})

	it('maps boolean to v.boolean()', () => {
		expect(sqlTypeToConvex('boolean')).toBe('v.boolean()')
		expect(sqlTypeToConvex('bool')).toBe('v.boolean()')
	})

	it('maps json/jsonb to v.any()', () => {
		expect(sqlTypeToConvex('json')).toBe('v.any()')
		expect(sqlTypeToConvex('jsonb')).toBe('v.any()')
	})

	it('maps timestamp/date/time types to v.string()', () => {
		expect(sqlTypeToConvex('timestamp')).toBe('v.string()')
		expect(sqlTypeToConvex('timestamptz')).toBe('v.string()')
		expect(sqlTypeToConvex('date')).toBe('v.string()')
		expect(sqlTypeToConvex('time')).toBe('v.string()')
		expect(sqlTypeToConvex('timetz')).toBe('v.string()')
	})

	it('maps bytea to v.bytes()', () => {
		expect(sqlTypeToConvex('bytea')).toBe('v.bytes()')
	})

	it('maps array types to v.array(inner)', () => {
		expect(sqlTypeToConvex('text[]')).toBe('v.array(v.string())')
		expect(sqlTypeToConvex('integer[]')).toBe('v.array(v.number())')
		expect(sqlTypeToConvex('boolean[]')).toBe('v.array(v.boolean())')
	})

	it('strips pg_catalog. prefix', () => {
		expect(sqlTypeToConvex('pg_catalog.int4')).toBe('v.number()')
		expect(sqlTypeToConvex('pg_catalog.text')).toBe('v.string()')
	})

	it('returns v.any() for unknown types', () => {
		expect(sqlTypeToConvex('unknown_type')).toBe('v.any()')
		expect(sqlTypeToConvex(null)).toBe('v.any()')
		expect(sqlTypeToConvex(undefined)).toBe('v.any()')
	})
})

describe('columnToValidator', () => {
	it('returns bare validator for non-nullable column', () => {
		const col = { dataType: 'text', nullable: false, constraints: [] }
		expect(columnToValidator(col)).toBe('v.string()')
	})

	it('wraps in v.optional() for nullable column', () => {
		const col = { dataType: 'text', nullable: true, constraints: [] }
		expect(columnToValidator(col)).toBe('v.optional(v.string())')
	})

	it('handles nullable integer array', () => {
		const col = { dataType: 'integer[]', nullable: true, constraints: [] }
		expect(columnToValidator(col)).toBe('v.optional(v.array(v.number()))')
	})
})
