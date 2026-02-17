/**
 * DbReferenceCache — Lazy-loaded cache for database entity resolution.
 *
 * When dbd inspect finds unresolved references, this module queries the
 * database to verify whether they actually exist (e.g., extension functions).
 * Results are cached per connection URL in ~/.config/dbd/cache/.
 */
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CACHE_DIR = join(homedir(), '.config', 'dbd', 'cache')

/**
 * Create a cache key from a connection URL.
 * Uses SHA-256 hash to avoid filesystem issues with special characters.
 */
function cacheKey(connectionUrl) {
	return createHash('sha256').update(connectionUrl).digest('hex').slice(0, 16)
}

export class DbReferenceCache {
	#entities = new Map()
	#adapter
	#connectionUrl
	#cacheFile
	#dirty = false

	constructor(adapter, connectionUrl) {
		this.#adapter = adapter
		this.#connectionUrl = connectionUrl
		this.#cacheFile = join(CACHE_DIR, `${cacheKey(connectionUrl)}.json`)
	}

	/**
	 * Load cached entities from disk.
	 */
	load() {
		try {
			if (existsSync(this.#cacheFile)) {
				const data = JSON.parse(readFileSync(this.#cacheFile, 'utf-8'))
				if (data.entities) {
					for (const [name, entry] of Object.entries(data.entities)) {
						this.#entities.set(name, entry)
					}
				}
			}
		} catch {
			// Cache file corrupt or unreadable — start fresh
		}
	}

	/**
	 * Save cached entities to disk.
	 */
	save() {
		if (!this.#dirty) return

		try {
			mkdirSync(CACHE_DIR, { recursive: true })
			const data = {
				timestamp: new Date().toISOString(),
				entities: Object.fromEntries(this.#entities)
			}
			writeFileSync(this.#cacheFile, JSON.stringify(data, null, 2))
		} catch {
			// Cache write failed — not critical
		}
	}

	/**
	 * Resolve an entity name. Checks cache first, then queries the database.
	 *
	 * @param {string} name - Entity name (qualified or unqualified)
	 * @param {string[]} searchPaths - Schema search paths
	 * @returns {Promise<{name: string, schema: string, type: string}|null>}
	 */
	async resolve(name, searchPaths) {
		// Check in-memory cache
		const cached = this.#entities.get(name)
		if (cached !== undefined) {
			return cached // null means "verified not found"
		}

		// Query database
		const result = await this.#adapter.resolveEntity(name, searchPaths)
		this.#entities.set(name, result)
		this.#dirty = true
		return result
	}

	/**
	 * Clear the in-memory cache.
	 */
	clear() {
		this.#entities.clear()
		this.#dirty = true
	}

	/**
	 * Number of cached entries.
	 */
	get size() {
		return this.#entities.size
	}
}
