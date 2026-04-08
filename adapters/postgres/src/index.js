import { PsqlAdapter } from './psql-adapter.js'
import { PgAdapter } from './pg-adapter.js'

export { PsqlAdapter, PgAdapter }

/**
 * Factory function called by @jerrythomas/dbd-db's createAdapter().
 *
 * Uses the programmatic PgAdapter (postgres.js library) by default.
 * Pass `driver: 'psql'` in options to use the CLI-based PsqlAdapter instead.
 *
 * @param {string} connectionString — PostgreSQL connection URL
 * @param {Object} [options] — { verbose, dryRun, driver: 'pg' | 'psql' }
 * @returns {PgAdapter|PsqlAdapter}
 */
export function createAdapter(connectionString, options = {}) {
	const { driver = 'pg', ...adapterOptions } = options
	return driver === 'psql'
		? new PsqlAdapter(connectionString, adapterOptions)
		: new PgAdapter(connectionString, adapterOptions)
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
