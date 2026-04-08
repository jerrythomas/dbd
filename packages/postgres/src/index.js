import { PsqlAdapter } from './psql-adapter.js'
import { PgAdapter } from './pg-adapter.js'

export { PsqlAdapter, PgAdapter }

/**
 * Factory function called by @jerrythomas/dbd-db's createAdapter().
 *
 * Uses the programmatic PgAdapter (postgres.js library) by default.
 * PsqlAdapter is still available for direct use if needed.
 *
 * @param {string} connectionString — PostgreSQL connection URL
 * @param {Object} [options] — { verbose, dryRun }
 * @returns {PgAdapter}
 */
export function createAdapter(connectionString, options = {}) {
	return new PgAdapter(connectionString, options)
}

// Re-export parser API for direct usage
export {
	parseSchema,
	validate,
	extractTables,
	extractViews,
	extractProcedures,
	extractIndexes,
	SQLParser,
	extractDependencies
} from './parser/index.js'

// Re-export reference classifier API
export {
	isInternal,
	isAnsiiSQL,
	isPostgres,
	isExtension,
	matchesKnownExtension,
	resetCache,
	getCache,
	internals,
	extensions
} from './reference-classifier.js'
