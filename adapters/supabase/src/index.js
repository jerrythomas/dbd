import { SupabaseAdapter } from './supabase-adapter.js'

export { SupabaseAdapter }

/**
 * Factory function called by @jerrythomas/dbd-db's createAdapter().
 *
 * @param {string} connectionString — PostgreSQL connection URL (Supabase project URL)
 * @param {Object} [options] — { verbose, dryRun, project }
 * @returns {SupabaseAdapter}
 */
export function createAdapter(connectionString, options = {}) {
	return new SupabaseAdapter(connectionString, options)
}
