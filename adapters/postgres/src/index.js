import { PsqlAdapter } from './psql-adapter.js'

export { PsqlAdapter }

/**
 * Factory function called by @jerrythomas/dbd-db's createAdapter().
 *
 * @param {string} connectionString — PostgreSQL connection URL
 * @param {Object} [options] — { verbose, dryRun }
 * @returns {PsqlAdapter}
 */
export function createAdapter(connectionString, options = {}) {
	return new PsqlAdapter(connectionString, options)
}
