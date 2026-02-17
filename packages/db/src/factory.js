/**
 * Adapter factory — dynamic import of database adapters.
 *
 * Each adapter package exports a `createAdapter(connectionString, options)` function.
 * The factory maps database type names to their package loaders.
 */

const ADAPTERS = {
	postgres: () => import('@jerrythomas/dbd-postgres-adapter'),
	postgresql: () => import('@jerrythomas/dbd-postgres-adapter')
}

export const SUPPORTED_DATABASES = Object.keys(ADAPTERS)

/**
 * Create an adapter instance for the given database type.
 *
 * @param {string} type — database type (e.g. 'postgres')
 * @param {string} connectionString — database connection URL
 * @param {Object} [options] — adapter options ({ verbose, dryRun })
 * @returns {Promise<BaseDatabaseAdapter>}
 */
export async function createAdapter(type, connectionString, options = {}) {
	const loader = ADAPTERS[type.toLowerCase()]
	if (!loader) {
		throw new Error(`Unsupported database: ${type}. Supported: ${SUPPORTED_DATABASES.join(', ')}`)
	}
	const mod = await loader()
	return mod.createAdapter(connectionString, options)
}

/**
 * Get information about a registered adapter.
 *
 * @param {string} type — database type
 * @returns {{ type: string, supported: boolean }}
 */
export function getAdapterInfo(type) {
	const key = type.toLowerCase()
	return {
		type: key,
		supported: key in ADAPTERS
	}
}
