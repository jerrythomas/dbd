/**
 * Reference classifier — identifies internal SQL builtins and database extensions.
 *
 * Extracted from packages/cli/src/references.js.
 * PostgreSQL-specific: knows about PG builtins, ANSI SQL, and common extensions.
 */

// --- Classification cache ---

let cache = {
	internal: [],
	extension: []
}

export function getCache() {
	return cache
}

export function resetCache() {
	cache = {
		internal: [],
		extension: []
	}
}

// --- Extension patterns ---

export const extensions = {
	'uuid-ossp': { patterns: ['^uuid_'] },
	cube: { patterns: ['^cube(_.*)?'] },
	timescaledb: { entities: ['create_hypertable', 'time_bucket'] },
	pgcrypto: { entities: ['gen_salt', 'crypt', 'md5'] },
	postgis: { patterns: ['^st_', '^geom_', '^geog'] },
	pg_trgm: { entities: ['similarity'] },
	vector: { entities: ['vector', 'gin', 'hnsw', 'ivfflat'] },
	pgmq: { patterns: ['^pgmq_', '^pgmq\\.'] },
	pg_cron: { patterns: ['^cron\\.'] },
	dblink: { entities: ['dblink', 'dblink_exec', 'dblink_connect', 'dblink_disconnect'] },
	pg_background: { entities: ['pg_background_launch', 'pg_background_result'] }
}

// --- Internal SQL patterns ---

export const internals = {
	ansii: {
		entities: [
			'avg',
			'count',
			'min',
			'max',
			'abs',
			'sum',
			'floor',
			'where',
			'ceil',
			'random',
			'upper',
			'lower',
			'substring',
			'substr',
			'trim',
			'getdate',
			'datepart',
			'greatest',
			'least',
			'datediff',
			'cast',
			'convert',
			'coalesce',
			'rank',
			'row_number',
			'dense_rank',
			'over',
			'partition',
			'by',
			'list',
			'values',
			'count',
			'string_agg',
			'split_part',
			'format',
			'first_value',
			'last_value',
			'lag',
			'lead',
			'percent_rank',
			'cume_dist',
			'exists',
			'set',
			'varchar',
			'join',
			'inner',
			'outer',
			'in',
			'on',
			'from',
			'as',
			'replace',
			'key',
			'least',
			'replace',
			'initcap',
			'check',
			'using',
			'unique',
			'and',
			'or',
			'nullif',
			'if',
			'array',
			'tinyint',
			'bigint',
			'double',
			'bit',
			'varbinary',
			'btree',
			'int',
			'numeric',
			'bytea',
			'table',
			'column',
			'trunc',
			'geometry',
			'vector',
			'gin',
			'for',
			'threshold',
			'length',
			'decimal',
			'position',
			'not',
			'date',
			'round',
			'when',
			'record',
			'between',
			'columns',
			'default',
			'system',
			'user'
		]
	},
	postgres: {
		patterns: [
			'^information_schema.',
			'^pg_',
			'^array_',
			'^string_to_',
			'^to_',
			'^date_',
			'^time_',
			'^json_',
			'^jsonb_',
			'^xml_',
			'^regexp_',
			'^lo_',
			'^current_'
		],
		entities: [
			'varying',
			'now',
			'localtime',
			'localtimestamp',
			'string_agg',
			'unnest',
			'initcap',
			'extract',
			'conflict',
			'date_part',
			'return',
			'enum'
		]
	}
}

// --- Detection functions ---

export function isAnsiiSQL(input) {
	return internals.ansii.entities.includes(input) ? 'internal' : null
}

export function isPostgres(input) {
	let matched = internals.postgres.entities.includes(input)
	if (!matched) {
		for (let i = 0; i < internals.postgres.patterns.length && !matched; i++) {
			let regex = new RegExp(internals.postgres.patterns[i])
			matched = regex.test(input)
		}
	}
	return matched ? 'internal' : null
}

/**
 * Check if an input matches an extension's entities or patterns.
 */
const extensionMatchesInput = (extension, input) => {
	if (Array.isArray(extension.entities) && extension.entities.includes(input)) return true
	if (Array.isArray(extension.patterns)) {
		return extension.patterns.some((pattern) => new RegExp(pattern).test(input))
	}
	return false
}

export function isExtension(input, installed = []) {
	for (const extKey of installed) {
		const extension = extensions[extKey]
		if (extension && extensionMatchesInput(extension, input)) return 'extension'
	}
	return null
}

export function matchesKnownExtension(input) {
	const lowerInput = input.toLowerCase()
	for (const [extName, extension] of Object.entries(extensions)) {
		if (Array.isArray(extension.entities) && extension.entities.includes(lowerInput)) {
			return extName
		}
		if (Array.isArray(extension.patterns)) {
			for (const pattern of extension.patterns) {
				if (new RegExp(pattern).test(lowerInput)) return extName
			}
		}
	}
	return null
}

export function isInternal(input, installed = []) {
	const lowerInput = input.toLowerCase()

	if (cache.internal.includes(lowerInput)) return 'internal'
	if (cache.extension.includes(lowerInput)) return 'extension'

	let matched =
		isAnsiiSQL(lowerInput) || isPostgres(lowerInput) || isExtension(lowerInput, installed)

	if (matched === 'internal') {
		cache.internal.push(lowerInput)
	} else if (matched === 'extension') {
		cache.extension.push(lowerInput)
	}

	return matched
}
