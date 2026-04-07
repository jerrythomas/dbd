import { describe, it, expect } from 'vitest'
import { buildResetScript, buildGrantsScript } from '../src/script-builder.js'

describe('buildResetScript', () => {
	const roles = [
		{ name: 'basic' },
		{ name: 'advanced' } // advanced depends on basic, so sorted: [basic, advanced]
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

	describe('explicit grants (all targets)', () => {
		it('generates GRANT USAGE for usage perm', () => {
			const script = buildGrantsScript(schemaGrants, [], 'supabase')
			expect(script).toContain('GRANT USAGE ON SCHEMA config TO anon;')
			expect(script).toContain('GRANT USAGE ON SCHEMA config TO service_role;')
		})

		it('generates GRANT ON ALL TABLES for table-level perms', () => {
			const script = buildGrantsScript(schemaGrants, [], 'supabase')
			expect(script).toContain('GRANT SELECT ON ALL TABLES IN SCHEMA config TO anon;')
			expect(script).toContain('GRANT ALL ON ALL TABLES IN SCHEMA config TO service_role;')
		})

		it('generates ALTER DEFAULT PRIVILEGES for table-level perms', () => {
			const script = buildGrantsScript(schemaGrants, [], 'supabase')
			expect(script).toContain(
				'ALTER DEFAULT PRIVILEGES IN SCHEMA config GRANT SELECT ON TABLES TO anon;'
			)
			expect(script).toContain(
				'ALTER DEFAULT PRIVILEGES IN SCHEMA config GRANT ALL ON TABLES TO service_role;'
			)
		})

		it('applies to postgres target', () => {
			const script = buildGrantsScript(schemaGrants, [], 'postgres')
			expect(script).toContain('GRANT USAGE ON SCHEMA config TO anon;')
			expect(script).toContain('GRANT ALL ON ALL TABLES IN SCHEMA config TO service_role;')
		})

		it('postgres target: no pgrst lines', () => {
			const script = buildGrantsScript(schemaGrants, [], 'postgres')
			expect(script).not.toContain('pgrst')
			expect(script).not.toContain('authenticator')
		})

		it('all table-level permission types are uppercased in output', () => {
			const grants = [{ name: 'api', grants: { anon: ['insert', 'update', 'delete'] } }]
			const script = buildGrantsScript(grants, [], 'supabase')
			expect(script).toContain('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA api TO anon;')
		})

		it('schema with empty grants object: produces no output', () => {
			const script = buildGrantsScript([{ name: 'config', grants: {} }], [], 'supabase')
			expect(script).toBe('')
		})
	})

	describe('supabase schema exposure', () => {
		it('grants USAGE to anon, authenticated, service_role for each schema', () => {
			const script = buildGrantsScript([], ['core', 'api'], 'supabase')
			expect(script).toContain('GRANT USAGE ON SCHEMA core TO anon, authenticated, service_role;')
			expect(script).toContain('GRANT USAGE ON SCHEMA api TO anon, authenticated, service_role;')
		})

		it('sets pgrst.db_schemas to the supabase schema list', () => {
			const script = buildGrantsScript([], ['core', 'api'], 'supabase')
			expect(script).toContain("ALTER ROLE authenticator SET pgrst.db_schemas TO 'core, api';")
		})

		it('notifies pgrst to reload', () => {
			const script = buildGrantsScript([], ['core'], 'supabase')
			expect(script).toContain("NOTIFY pgrst, 'reload config';")
			expect(script).toContain("NOTIFY pgrst, 'reload schema';")
		})

		it('postgres target: supabase schemas produce no output', () => {
			const script = buildGrantsScript([], ['core', 'api'], 'postgres')
			expect(script).toBe('')
		})

		it('pgrst lines appear after grant lines', () => {
			const script = buildGrantsScript([], ['core'], 'supabase')
			const grantPos = script.indexOf('GRANT USAGE ON SCHEMA core')
			const pgrstPos = script.indexOf('ALTER ROLE authenticator')
			expect(grantPos).toBeLessThan(pgrstPos)
		})
	})

	describe('combined explicit grants + supabase exposure', () => {
		it('includes both explicit grants and supabase USAGE grants', () => {
			const script = buildGrantsScript(schemaGrants, ['core'], 'supabase')
			expect(script).toContain('GRANT USAGE ON SCHEMA config TO anon;')
			expect(script).toContain('GRANT USAGE ON SCHEMA core TO anon, authenticated, service_role;')
		})

		it('pgrst.db_schemas uses supabase list, not schemaGrants', () => {
			const script = buildGrantsScript(schemaGrants, ['core'], 'supabase')
			expect(script).toContain("ALTER ROLE authenticator SET pgrst.db_schemas TO 'core';")
			expect(script).not.toContain('config, core')
		})
	})

	describe('empty inputs', () => {
		it('no grants and no supabase schemas: returns empty string', () => {
			expect(buildGrantsScript([], [], 'supabase')).toBe('')
			expect(buildGrantsScript([], [], 'postgres')).toBe('')
		})

		it('defaults to supabase target', () => {
			const script = buildGrantsScript(schemaGrants)
			expect(script).toContain('GRANT USAGE ON SCHEMA config TO anon;')
		})
	})
})
