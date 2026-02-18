/**
 * SQL Parser Error Handler
 * @module utils/error-handler
 */

/**
 * Configuration for error handling
 */
let config = {
	logToConsole: false, // Silent by default for test environments
	collectErrors: true,
	throwOnError: false
}

/**
 * Collection of errors encountered during parsing
 */
const parsingErrors = []

/**
 * Configure the error handler
 * @param {Object} options - Configuration options
 * @param {boolean} [options.logToConsole=true] - Whether to log errors to console
 * @param {boolean} [options.collectErrors=true] - Whether to collect errors in memory
 * @param {boolean} [options.throwOnError=false] - Whether to throw exceptions on errors
 */
export const configure = (options = {}) => {
	config = {
		...config,
		...options
	}
}

/**
 * Handle a parsing error
 * @param {Error|string} error - Error object or message
 * @param {string} statement - SQL statement that caused the error
 * @param {string} context - Context in which the error occurred
 * @returns {Object} Error information object
 */
export const handleParsingError = (error, statement, context = '') => {
	const errorMsg = error instanceof Error ? error.message : error
	const preview = statement ? statement.slice(0, 100) + (statement.length > 100 ? '...' : '') : ''

	const errorInfo = {
		message: errorMsg,
		preview,
		context,
		timestamp: new Date(),
		type: 'PARSING_ERROR'
	}

	if (config.logToConsole) {
		console.warn(`Warning: Could not parse statement${context ? ' in ' + context : ''}: ${preview}`)
		console.warn(`Error: ${errorMsg}`)
	}

	if (config.collectErrors) {
		parsingErrors.push(errorInfo)
	}

	if (config.throwOnError) {
		throw new Error(`SQL Parsing Error: ${errorMsg}`)
	}

	return errorInfo
}

/**
 * Get all collected parsing errors
 * @returns {Array} Array of error information objects
 */
export const getErrors = () => {
	return [...parsingErrors]
}

/**
 * Clear all collected parsing errors
 */
export const clearErrors = () => {
	parsingErrors.length = 0
}

/**
 * Disable console output for tests
 */
export const silentForTests = () => {
	configure({ logToConsole: false })
}

/**
 * Enable console output
 */
export const enableConsoleOutput = () => {
	configure({ logToConsole: true })
}

/**
 * Wrap a parser function with error handling
 * @param {Function} parserFn - Parser function to wrap
 * @param {string} context - Context for error reporting
 * @returns {Function} Wrapped function that handles errors
 */
export const withErrorHandling = (parserFn, context) => {
	return (statement, ...args) => {
		try {
			return parserFn(statement, ...args)
		} catch (error) {
			handleParsingError(error, statement, context)
			return null
		}
	}
}

/**
 * Run a function with specific error handling config
 * @param {Function} fn - Function to run
 * @param {Object} tempConfig - Temporary configuration to use
 * @returns {*} Result of the function
 */
export const withConfig = (fn, tempConfig) => {
	const originalConfig = { ...config }
	try {
		configure(tempConfig)
		return fn()
	} finally {
		configure(originalConfig)
	}
}

export default {
	configure,
	handleParsingError,
	getErrors,
	clearErrors,
	silentForTests,
	enableConsoleOutput,
	withErrorHandling,
	withConfig
}
