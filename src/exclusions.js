let cache = {
	internal: [],
	extension: []
}

export const extensions = {
	'uuid-ossp': { patterns: ['^uuid_'] },
	cube: { patterns: ['^cube(_.*)?'] },
	timescaledb: { entities: ['create_hypertable', 'time_bucket'] },
	pgcrypto: { entities: ['gen_salt', 'crypt', 'md5'] }
}
export const internals = {
	ansii: {
		entities: [
			// Common ANSI SQL standard functions
			'avg',
			'count',
			'min',
			'max',
			'sum',
			'upper',
			'lower',
			'substring',
			'trim',
			'getdate',
			'datepart',
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
			'varbinary'

			// And many more as needed...
		]
	},
	postgres: {
		patterns: [
			'^information_schema.',
			'^pg_', // Functions and system administration queries
			'^array_', // Array processing functions
			'^string_to_', // Various conversion functions
			'^to_', // Casting and conversion functions
			'^date_', // Date processing functions
			'^time_', // Time processing functions
			'^json_', // JSON processing functions
			'^jsonb_', // JSON processing functions
			'^xml_', // XML processing functions
			'^regexp_', // Regular expression functions
			'^lo_', // Large object functions
			'^current_' // current_setting, date, time, timestamp, user etc
			// And others as specific to PostgreSQL's extensions and unique functionalities
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
			'date_part'
			// Add more specific functions as necessary
		]
	}
}

/**
 * Checks if the input is a known ANSI SQL function
 *
 * @param {string} input - The input to check, expected to be in lowercase
 * @returns {boolean} - True if the input is a known ANSI SQL function
 */
export function isAnsiiSQL(input) {
	return internals.ansii.entities.includes(input) ? 'internal' : null
}

/**
 * Checks if the input is a known PostgreSQL function
 *
 * @param {string} input - The input to check, expected to be in lowercase
 * @returns {boolean} - True if the input is a known PostgreSQL function
 */
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
 * Checks if the input is a known extension function
 *
 * @param {string} input - The input to check
 * @param {string} schema - The schema in which extension is expected to be found
 * @param {string[]} installed - The list of installed extensions
 * @returns {boolean} - True if the input is a known extension function
 */
export function isExtension(input, installed = []) {
	let matched = false
	for (let i = 0; i < installed.length && !matched; i++) {
		const extension = extensions[installed[i]]
		if (Array.isArray(extension.entities)) {
			matched = extension.entities.includes(input)
		}
		if (!matched && Array.isArray(extension.patterns)) {
			for (let j = 0; j < extension.patterns.length && !matched; j++) {
				let regex = new RegExp(extension.patterns[j])
				matched = regex.test(input)
			}
		}
	}

	return matched ? 'extension' : null
}

/**
 * Checks if the input is a known internal or extension and caches the result
 *
 * @param {string} input - The input to check
 * @param {string[]} installed - The list of installed extensions
 * @returns {boolean} - True if the input is a known internal or extension
 */
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

/**
 * Returns the current cached internal or ignore list
 *
 * @returns {object} - The current cache object
 */
export function getCache() {
	return cache
}

/**
 * Resets the internal and ignore cache lists
 */
export function resetCache() {
	cache = {
		internal: [],
		extension: []
	}
}
