export { stripSchema, SqliteAdapter } from './sqlite-adapter.js'

import { SqliteAdapter } from './sqlite-adapter.js'

/**
 * Factory function called by @jerrythomas/dbd-db's createAdapter().
 *
 * @param {string} connectionString — file path to the SQLite database (e.g. './local.db')
 * @param {Object} [options] — { verbose, dryRun }
 * @returns {SqliteAdapter}
 */
export function createAdapter(connectionString, options = {}) {
	return new SqliteAdapter(connectionString, options)
}
