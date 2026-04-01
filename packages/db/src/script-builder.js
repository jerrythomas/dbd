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
 * Builds a SQL script that applies schema grants for Supabase PostgREST roles.
 * No-op for postgres target.
 *
 * @param {{ name: string, grants: Object }[]} schemaGrants - From config.schemaGrants
 * @param {'supabase'|'postgres'} [target='supabase'] - Target platform
 * @returns {string} SQL script (empty string if nothing to grant)
 */
export function buildGrantsScript(schemaGrants, target = 'supabase') {
	if (target !== 'supabase') return ''

	const grantLines = schemaGrants
		.flatMap(({ name, grants }) =>
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
		.join('\n')

	if (!grantLines) return ''

	const exposedSchemas = schemaGrants.map((s) => s.name).join(', ')
	return [
		grantLines,
		`ALTER ROLE authenticator SET pgrst.db_schemas TO '${exposedSchemas}';`,
		`NOTIFY pgrst, 'reload config';`,
		`NOTIFY pgrst, 'reload schema';`
	].join('\n')
}
