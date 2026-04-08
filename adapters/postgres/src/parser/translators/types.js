/**
 * Type resolution utilities for pgsql-parser AST nodes.
 * @module translators/types
 */

export const PG_TYPE_MAP = {
	int2: 'smallint',
	int4: 'int',
	int8: 'bigint',
	float4: 'real',
	float8: 'double precision',
	bool: 'boolean',
	varchar: 'varchar',
	bpchar: 'char',
	numeric: 'numeric',
	text: 'text',
	uuid: 'uuid',
	jsonb: 'jsonb',
	json: 'json',
	timestamp: 'timestamp',
	timestamptz: 'timestamptz',
	date: 'date',
	time: 'time',
	timetz: 'timetz',
	interval: 'interval',
	bytea: 'bytea',
	serial: 'serial',
	serial4: 'serial',
	serial8: 'bigserial',
	bigserial: 'bigserial',
	oid: 'oid',
	inet: 'inet',
	cidr: 'cidr',
	macaddr: 'macaddr',
	xml: 'xml',
	money: 'money',
	bit: 'bit',
	varbit: 'varbit',
	point: 'point',
	line: 'line',
	lseg: 'lseg',
	box: 'box',
	path: 'path',
	polygon: 'polygon',
	circle: 'circle',
	tsvector: 'tsvector',
	tsquery: 'tsquery'
}

/**
 * Convert a pgsql-parser typeName node to a human-readable type string.
 * e.g. [{String:{sval:"pg_catalog"}},{String:{sval:"int4"}}] → "int"
 */
export const resolveTypeName = (typeName) => {
	const names = typeName.names.map((n) => n.String?.sval).filter(Boolean)
	const baseName = names.length > 1 && names[0] === 'pg_catalog' ? names[1] : names.join('.')
	let resolved = PG_TYPE_MAP[baseName] || baseName

	if (typeName.typmods && typeName.typmods.length > 0) {
		const mods = typeName.typmods.map((tm) => tm.A_Const?.ival?.ival ?? 0)
		if (mods.length > 0) resolved += `(${mods.join(',')})`
	}

	if (typeName.arrayBounds && typeName.arrayBounds.length > 0) {
		resolved += '[]'
	}

	return resolved
}

/**
 * Extract the literal value from an A_Const node.
 * Handles pgsql-parser v17 double-nested wrappers.
 * @returns {number|string|boolean|undefined} Literal value, or undefined if the subtype is unrecognised.
 */
const resolveAConstDefault = (ac) => {
	if (ac.ival !== undefined && typeof ac.ival === 'object') return ac.ival.ival ?? 0
	if (ac.sval?.sval !== undefined) return ac.sval.sval
	if (ac.fval?.fval !== undefined) return ac.fval.fval
	if (ac.boolval !== undefined && typeof ac.boolval === 'object') return ac.boolval.boolval ?? false
	// undefined = no A_Const subtype recognised — caller falls through
}

/**
 * Extract a default value expression from a Constraint node's raw_expr.
 * Handles pgsql-parser v17 double-nested wrappers.
 */
export const resolveDefaultExpr = (rawExpr) => {
	if (rawExpr.A_Const) {
		const val = resolveAConstDefault(rawExpr.A_Const)
		if (val !== undefined) return val
	}

	if (rawExpr.FuncCall) {
		const funcName = rawExpr.FuncCall.funcname
			?.map((n) => n.String?.sval)
			.filter(Boolean)
			.join('.')
		return `${funcName}()`
	}

	if (rawExpr.TypeCast) {
		return resolveDefaultExpr(rawExpr.TypeCast.arg)
	}

	return '[EXPRESSION]'
}
