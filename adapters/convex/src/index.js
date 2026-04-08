export { sqlTypeToConvex, columnToValidator } from './sql-type-map.js'
export { generateSchemaTs, resolveTableName } from './schema-generator.js'
export { buildImportArgs, convexImportCommand, seedTable } from './data-seeder.js'
export { ConvexAdapter } from './convex-adapter.js'

import { ConvexAdapter } from './convex-adapter.js'

/**
 * Factory function called by @jerrythomas/dbd-db's createAdapter().
 *
 * @param {string} connectionString — unused for Convex (no DB connection)
 * @param {Object} [options] — { verbose, dryRun, project, env, convex }
 * @returns {ConvexAdapter}
 */
export function createAdapter(connectionString, options = {}) {
	return new ConvexAdapter(connectionString, options)
}
