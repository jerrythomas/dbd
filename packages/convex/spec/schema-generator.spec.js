import { describe, it, expect } from 'vitest'
import { resolveTableName, generateSchemaTs } from '../src/schema-generator.js'

const makeTable = (schema, tableName, columns = []) => ({
  type: 'table',
  name: `${schema}.${tableName}`,
  schema,
  columns,
  constraints: [],
  errors: [],
  warnings: []
})

const basicColumns = [
  {
    name: 'id',
    dataType: 'uuid',
    nullable: false,
    constraints: [{ type: 'PRIMARY KEY' }],
    defaultValue: 'gen_random_uuid()'
  },
  { name: 'label', dataType: 'text', nullable: false, constraints: [], defaultValue: null },
  { name: 'notes', dataType: 'text', nullable: true, constraints: [], defaultValue: null }
]

describe('resolveTableName', () => {
  it('strips schema by default', () => {
    expect(resolveTableName(makeTable('public', 'users'))).toBe('users')
    expect(resolveTableName(makeTable('config', 'features'))).toBe('features')
  })

  it('strips schema when schemaPrefix is false', () => {
    expect(resolveTableName(makeTable('config', 'features'), { schemaPrefix: false })).toBe(
      'features'
    )
  })

  it('prepends schema_ when schemaPrefix is true', () => {
    expect(resolveTableName(makeTable('config', 'features'), { schemaPrefix: true })).toBe(
      'config_features'
    )
  })

  it('skips public schema by default when schemaPrefix is true', () => {
    expect(resolveTableName(makeTable('public', 'users'), { schemaPrefix: true })).toBe('users')
  })

  it('respects custom schemaPrefixSkip list', () => {
    const config = { schemaPrefix: true, schemaPrefixSkip: ['staging'] }
    expect(resolveTableName(makeTable('staging', 'orders'), config)).toBe('orders')
    expect(resolveTableName(makeTable('public', 'users'), config)).toBe('public_users')
  })
})

describe('generateSchemaTs', () => {
  it('filters to table entities only', () => {
    const entities = [
      makeTable('public', 'users', basicColumns),
      {
        type: 'view',
        name: 'public.active_users',
        schema: 'public',
        columns: basicColumns,
        errors: []
      },
      { type: 'function', name: 'public.get_user', schema: 'public', errors: [] }
    ]
    const { content } = generateSchemaTs(entities)
    expect(content).toContain('users:')
    expect(content).not.toContain('active_users:')
    expect(content).not.toContain('get_user:')
  })

  it('drops primary key columns', () => {
    const { content } = generateSchemaTs([makeTable('public', 'users', basicColumns)])
    expect(content).not.toContain('id:')
    expect(content).toContain('label:')
    expect(content).toContain('notes:')
  })

  it('uses v.optional() for nullable columns', () => {
    const { content } = generateSchemaTs([makeTable('public', 'users', basicColumns)])
    expect(content).toContain('notes: v.optional(v.string())')
    expect(content).toContain('label: v.string()')
  })

  it('generates valid schema.ts structure', () => {
    const { content } = generateSchemaTs([makeTable('public', 'users', basicColumns)])
    expect(content).toContain('import { defineSchema, defineTable } from "convex/server"')
    expect(content).toContain('import { v } from "convex/values"')
    expect(content).toContain('export default defineSchema({')
    expect(content).toContain('users: defineTable({')
  })

  it('handles schemaPrefix config', () => {
    const { content } = generateSchemaTs([makeTable('config', 'features', basicColumns)], {
      schemaPrefix: true
    })
    expect(content).toContain('config_features: defineTable({')
  })

  it('detects and warns on table name collisions', () => {
    const entities = [
      makeTable('public', 'orders', basicColumns),
      makeTable('staging', 'orders', basicColumns)
    ]
    const { content, warnings } = generateSchemaTs(entities)
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('collision')
    expect(content).toContain('orders_staging: defineTable({')
  })

  it('returns empty schema for no table entities', () => {
    const { content, warnings } = generateSchemaTs([])
    expect(content).toContain('export default defineSchema({')
    expect(warnings).toEqual([])
  })
})
