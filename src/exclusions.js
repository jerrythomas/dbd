let cache = {
	internal: [],
	ignore: []
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
			'if'

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
			'^lo_' // Large object functions
			// And others as specific to PostgreSQL's extensions and unique functionalities
		],
		entities: [
			'varying',
			'now',
			'current_date',
			'current_time',
			'current_timestamp',
			'localtime',
			'localtimestamp',
			'string_agg',
			'unnest',
			'initcap',
			'extract',
			'conflict'
			// 'cte'
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
	return internals.ansii.entities.includes(input)
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
	return matched
}

/**
 * Checks if the input is a known extension function
 *
 * @param {string} input - The input to check
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
	return matched
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

	if (cache.ignore.includes(lowerInput)) return false
	if (cache.internal.includes(lowerInput)) return true

	let matched =
		isAnsiiSQL(lowerInput) ||
		isPostgres(lowerInput) ||
		isExtension(lowerInput, installed)

	if (matched) {
		cache.internal.push(input)
	} else if (installed.length > 0) {
		// todo: ensure that metadata calls includes extensions so that we can cache the negative result
		cache.ignore.push(input)
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
		ignore: []
	}
}
