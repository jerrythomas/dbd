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
