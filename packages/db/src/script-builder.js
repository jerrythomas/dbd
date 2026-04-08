const SUPABASE_PROTECTED = [
	'auth',
	'storage',
	'realtime',
	'supabase_functions',
	'_realtime',
	'supabase_migrations',
	'pgbouncer',
	'vault',
	'graphql',
	'graphql_public'
]

/**
 * Builds a SQL script that drops all design.yaml schemas (and roles for postgres target).
 *
 * @param {string[]} schemas - Schema names from config.schemas
 * @param {Object[]} roles - Role objects with .name, pre-sorted by dependency
 * @param {'supabase'|'postgres'} [target='supabase'] - Target platform
 * @returns {string} SQL script (empty string if nothing to drop)
 */
export function buildResetScript(schemas, roles, target = 'supabase') {
	if (target === 'supabase') {
		return schemas
			.filter((s) => !SUPABASE_PROTECTED.includes(s))
			.map((s) => `DROP SCHEMA IF EXISTS ${s} CASCADE;`)
			.join('\n')
	}

	const dropSchemas = schemas.map((s) => `DROP SCHEMA IF EXISTS ${s} CASCADE;`)
	const dropRoles = [...roles].reverse().map((r) => `DROP ROLE IF EXISTS ${r.name};`)
	return [...dropSchemas, ...dropRoles].join('\n')
}

/**
 * Builds a SQL script that applies schema grants and (for Supabase) exposes schemas via PostgREST.
 *
 * Explicit schemaGrants apply to all targets.
 * supabaseSchemas get USAGE granted to anon/authenticated/service_role and are exposed via
 * pgrst.db_schemas (supabase target only).
 *
 * @param {{ name: string, grants: Object }[]} schemaGrants - From config.schemaGrants
 * @param {string[]} [supabaseSchemas=[]] - Schema names to expose via PostgREST
 * @param {'supabase'|'postgres'} [target='supabase'] - Target platform
 * @returns {string} SQL script (empty string if nothing to grant)
 */
export function buildGrantsScript(schemaGrants, supabaseSchemas = [], target = 'supabase') {
	const grantLines = schemaGrants.flatMap(({ name, grants }) =>
		Object.entries(grants).flatMap(([role, perms]) => {
			const lines = []
			if (perms.includes('usage')) lines.push(`GRANT USAGE ON SCHEMA ${name} TO ${role};`)
			const tablePerms = perms.filter((p) => p !== 'usage').map((p) => p.toUpperCase())
			if (tablePerms.length) {
				lines.push(`GRANT ${tablePerms.join(', ')} ON ALL TABLES IN SCHEMA ${name} TO ${role};`)
				lines.push(
					`ALTER DEFAULT PRIVILEGES IN SCHEMA ${name} GRANT ${tablePerms.join(', ')} ON TABLES TO ${role};`
				)
			}
			return lines
		})
	)

	const supabaseLines = []
	if (target === 'supabase' && supabaseSchemas.length) {
		for (const name of supabaseSchemas) {
			supabaseLines.push(`GRANT USAGE ON SCHEMA ${name} TO anon, authenticated, service_role;`)
		}
		supabaseLines.push(
			`ALTER ROLE authenticator SET pgrst.db_schemas TO '${supabaseSchemas.join(', ')}';`
		)
		supabaseLines.push(`NOTIFY pgrst, 'reload config';`)
		supabaseLines.push(`NOTIFY pgrst, 'reload schema';`)
	}

	if (!grantLines.length && !supabaseLines.length) return ''
	return [...grantLines, ...supabaseLines].join('\n')
}
