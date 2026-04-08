const TYPE_MAP = {
	text: 'v.string()',
	varchar: 'v.string()',
	char: 'v.string()',
	citext: 'v.string()',
	uuid: 'v.string()',
	name: 'v.string()',
	bpchar: 'v.string()',

	int: 'v.number()',
	int2: 'v.number()',
	int4: 'v.number()',
	int8: 'v.number()',
	integer: 'v.number()',
	bigint: 'v.number()',
	smallint: 'v.number()',
	serial: 'v.number()',
	bigserial: 'v.number()',
	smallserial: 'v.number()',

	float4: 'v.number()',
	float8: 'v.number()',
	real: 'v.number()',
	numeric: 'v.number()',
	decimal: 'v.number()',
	money: 'v.number()',
	'double precision': 'v.number()',

	boolean: 'v.boolean()',
	bool: 'v.boolean()',

	json: 'v.any()',
	jsonb: 'v.any()',

	timestamp: 'v.string()',
	timestamptz: 'v.string()',
	'timestamp without time zone': 'v.string()',
	'timestamp with time zone': 'v.string()',
	date: 'v.string()',
	time: 'v.string()',
	timetz: 'v.string()',
	'time without time zone': 'v.string()',
	'time with time zone': 'v.string()',
	interval: 'v.string()',

	bytea: 'v.bytes()'
}

/**
 * Convert a SQL type string to a Convex validator string.
 *
 * @param {string|null|undefined} sqlType - e.g. 'text', 'integer[]', 'varchar(255)'
 * @returns {string} e.g. 'v.string()', 'v.array(v.number())'
 */
export function sqlTypeToConvex(sqlType) {
	if (!sqlType) return 'v.any()'

	// Strip length/precision specs: varchar(255), numeric(10,2)
	const clean = sqlType
		.toLowerCase()
		.replace(/\(\s*\d+(?:\s*,\s*\d+)?\s*\)/, '')
		.trim()

	// Handle array types: text[], integer[]
	if (clean.endsWith('[]')) {
		const inner = sqlTypeToConvex(clean.slice(0, -2))
		return `v.array(${inner})`
	}

	// Strip pg_catalog. prefix from pgsql-parser output
	const withoutCatalog = clean.replace(/^pg_catalog\./, '')

	return TYPE_MAP[withoutCatalog] ?? TYPE_MAP[clean] ?? 'v.any()'
}

/**
 * Convert a parsed column definition to a Convex validator string,
 * wrapping in v.optional() if the column is nullable.
 *
 * @param {{ dataType: string, nullable: boolean }} column
 * @returns {string}
 */
export function columnToValidator(column) {
	const base = sqlTypeToConvex(column.dataType)
	return column.nullable ? `v.optional(${base})` : base
}
