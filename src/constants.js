export const typesWithSchema = [
	'table',
	'view',
	'function',
	'procedure',
	'import'
]
export const typesWithoutSchema = ['role', 'schema', 'extension']
export const allowedTypes = [...typesWithSchema, ...typesWithoutSchema]
export const defaultExportOptions = { format: 'csv' }
export const defaultImportOptions = {
	format: 'csv',
	nullValue: '',
	truncate: true
}

export const internalKeywords = new Set([
	'varchar',
	'integer',
	'bigint',
	'int',
	'interval',
	'float',
	'double',
	'now',
	'coalesce',
	'rank',
	'row_number',
	'dense_rank',
	'current_date',
	'current_time',
	'current_timestamp',
	'over',
	'partition',
	'by',
	'values',
	'count',
	'string_agg',
	'split_part',
	'format',
	'jsonb_to_record',
	'first_value',
	'last_value',
	'lag',
	'lead',
	'percent_rank',
	'cume_dist',
	'exists',
	'set'
])

export const excludePatterns = ['information_schema'].map(
	(x) => new RegExp(x, 'gi')
)
