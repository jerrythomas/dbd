/**
 * Temporary re-export shim — parser code has moved to @jerrythomas/dbd-postgres.
 * This file will be deleted in Batch 4 when packages/parser is removed entirely.
 */
export {
	parseSchema,
	validate,
	extractTables,
	extractViews,
	extractProcedures,
	extractIndexes,
	SQLParser,
	extractDependencies
} from '@jerrythomas/dbd-postgres-adapter'
