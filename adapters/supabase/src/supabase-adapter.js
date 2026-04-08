import { PgAdapter } from '@jerrythomas/dbd-postgres-adapter'

/**
 * Supabase-managed schemas that exist by default in every Supabase project.
 * DBD skips `CREATE SCHEMA` for these — they are not user-managed.
 */
const MANAGED_SCHEMAS = new Set([
	'auth',
	'storage',
	'realtime',
	'graphql_public',
	'supabase_functions',
	'extensions',
	'pgbouncer',
	'pgsodium',
	'vault'
])

/**
 * Extensions that Supabase pre-installs in every project.
 * DBD skips `CREATE EXTENSION` for these — they are already present.
 */
const PREINSTALLED_EXTENSIONS = new Set([
	'plpgsql',
	'uuid-ossp',
	'pgcrypto',
	'pgjwt',
	'pg_graphql',
	'pgsodium',
	'supabase_vault',
	'pg_stat_statements',
	'pgaudit',
	'pg_tle'
])

/**
 * PostgreSQL adapter for Supabase projects.
 *
 * Extends PgAdapter and skips DDL that Supabase manages internally:
 * - Schema creation for built-in schemas (auth, storage, realtime, …)
 * - Extension installation for pre-installed extensions
 *
 * All other operations (tables, views, functions, import, export) delegate
 * to PgAdapter unchanged.
 */
export class SupabaseAdapter extends PgAdapter {
	async applyEntity(entity, options = {}) {
		if (entity.type === 'schema' && MANAGED_SCHEMAS.has(entity.name)) {
			this.log(`Skipping Supabase-managed schema: ${entity.name}`)
			return
		}
		if (entity.type === 'extension' && PREINSTALLED_EXTENSIONS.has(entity.name)) {
			this.log(`Skipping Supabase pre-installed extension: ${entity.name}`)
			return
		}
		return super.applyEntity(entity, options)
	}
}
