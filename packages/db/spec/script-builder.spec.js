import { describe, it, expect } from 'vitest'
import { buildResetScript, buildGrantsScript } from '../src/script-builder.js'

describe('buildResetScript', () => {
  const roles = [
    { name: 'basic' },
    { name: 'advanced' }  // advanced depends on basic, so sorted: [basic, advanced]
  ]

  it('supabase target: drops user schemas, skips protected schemas', () => {
    const script = buildResetScript(['config', 'auth', 'staging'], [], 'supabase')
    expect(script).toContain('DROP SCHEMA IF EXISTS config CASCADE;')
    expect(script).toContain('DROP SCHEMA IF EXISTS staging CASCADE;')
    expect(script).not.toContain('auth')
  })

  it('supabase target: only protected schemas → returns empty string', () => {
    const script = buildResetScript(['auth', 'storage'], [], 'supabase')
    expect(script).toBe('')
  })

  it('supabase target: mix of protected and user schemas → only user schemas dropped', () => {
    const script = buildResetScript(['auth', 'config'], [], 'supabase')
    expect(script).not.toContain('auth')
    expect(script).toContain('DROP SCHEMA IF EXISTS config CASCADE;')
  })

  it('supabase target: roles are not dropped', () => {
    const script = buildResetScript(['config'], roles, 'supabase')
    expect(script).not.toContain('DROP ROLE')
  })

  it('postgres target: drops all schemas', () => {
    const script = buildResetScript(['config', 'auth', 'staging'], [], 'postgres')
    expect(script).toContain('DROP SCHEMA IF EXISTS config CASCADE;')
    expect(script).toContain('DROP SCHEMA IF EXISTS auth CASCADE;')
    expect(script).toContain('DROP SCHEMA IF EXISTS staging CASCADE;')
  })

  it('postgres target: drops roles in reverse dependency order', () => {
    const script = buildResetScript(['config'], roles, 'postgres')
    expect(script).toContain('DROP ROLE IF EXISTS basic;')
    expect(script).toContain('DROP ROLE IF EXISTS advanced;')
    // advanced (index 1) reversed → dropped before basic (index 0)
    const advancedPos = script.indexOf('DROP ROLE IF EXISTS advanced;')
    const basicPos = script.indexOf('DROP ROLE IF EXISTS basic;')
    expect(advancedPos).toBeLessThan(basicPos)
  })

  it('empty schemas array: returns empty string', () => {
    expect(buildResetScript([], [], 'supabase')).toBe('')
    expect(buildResetScript([], [], 'postgres')).toBe('')
  })

  it('defaults to supabase target', () => {
    const script = buildResetScript(['auth', 'config'], [])
    expect(script).not.toContain('auth')
    expect(script).toContain('config')
  })
})

describe('buildGrantsScript', () => {
  const schemaGrants = [
    {
      name: 'config',
      grants: {
        anon: ['usage', 'select'],
        service_role: ['usage', 'all']
      }
    }
  ]

  it('supabase target: generates GRANT USAGE for usage perm', () => {
    const script = buildGrantsScript(schemaGrants, 'supabase')
    expect(script).toContain('GRANT USAGE ON SCHEMA config TO anon;')
    expect(script).toContain('GRANT USAGE ON SCHEMA config TO service_role;')
  })

  it('supabase target: generates GRANT ON ALL TABLES for table-level perms', () => {
    const script = buildGrantsScript(schemaGrants, 'supabase')
    expect(script).toContain('GRANT SELECT ON ALL TABLES IN SCHEMA config TO anon;')
    expect(script).toContain('GRANT ALL ON ALL TABLES IN SCHEMA config TO service_role;')
  })

  it('supabase target: generates ALTER DEFAULT PRIVILEGES for table-level perms', () => {
    const script = buildGrantsScript(schemaGrants, 'supabase')
    expect(script).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA config GRANT SELECT ON TABLES TO anon;'
    )
    expect(script).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA config GRANT ALL ON TABLES TO service_role;'
    )
  })

  it('postgres target: returns empty string', () => {
    expect(buildGrantsScript(schemaGrants, 'postgres')).toBe('')
  })

  it('empty schemaGrants array: returns empty string', () => {
    expect(buildGrantsScript([], 'supabase')).toBe('')
  })

  it('schema without grants: skipped', () => {
    const script = buildGrantsScript([], 'supabase')
    expect(script).toBe('')
  })

  it('defaults to supabase target', () => {
    const script = buildGrantsScript(schemaGrants)
    expect(script).toContain('GRANT USAGE ON SCHEMA config TO anon;')
  })

  it('all table-level permission types are uppercased in output', () => {
    const grants = [{ name: 'api', grants: { anon: ['insert', 'update', 'delete'] } }]
    const script = buildGrantsScript(grants, 'supabase')
    expect(script).toContain('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA api TO anon;')
  })
})
