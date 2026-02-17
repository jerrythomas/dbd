/**
 * BaseDatabaseAdapter — Abstract database adapter interface.
 *
 * Subclasses (e.g. PostgreSQLAdapter) must implement the abstract methods.
 * Methods marked with "not implemented" will throw if called without override.
 */
export class BaseDatabaseAdapter {
	#connectionString
	#options

	constructor(connectionString, options = {}) {
		this.#connectionString = connectionString
		this.#options = { verbose: false, dryRun: false, ...options }
	}

	get connectionString() {
		return this.#connectionString
	}

	get options() {
		return { ...this.#options }
	}

	get verbose() {
		return this.#options.verbose
	}

	get dryRun() {
		return this.#options.dryRun
	}

	// --- Connection lifecycle ---

	async connect() {
		throw new Error('not implemented')
	}

	async disconnect() {
		throw new Error('not implemented')
	}

	async testConnection() {
		try {
			const info = await this.inspect()
			return info.connected === true
		} catch {
			return false
		}
	}

	// --- Core operations ---

	async executeScript(script, options = {}) {
		throw new Error('not implemented')
	}

	async applyEntity(entity, options = {}) {
		throw new Error('not implemented')
	}

	async applyEntities(entities, options = {}) {
		for (const entity of entities) {
			await this.applyEntity(entity, options)
		}
	}

	// --- Data operations ---

	async importData(entity, options = {}) {
		throw new Error('not implemented')
	}

	async exportData(entity, options = {}) {
		throw new Error('not implemented')
	}

	async batchImport(entities, options = {}) {
		for (const entity of entities) {
			await this.importData(entity, options)
		}
	}

	async batchExport(entities, options = {}) {
		for (const entity of entities) {
			await this.exportData(entity, options)
		}
	}

	// --- Inspection ---

	async inspect() {
		throw new Error('not implemented')
	}

	/**
	 * Resolve an entity name against the database catalog.
	 * Returns the entity's metadata if found, null otherwise.
	 *
	 * @param {string} name - Entity name (qualified or unqualified)
	 * @param {string[]} searchPaths - Schema search paths
	 * @returns {Promise<{name: string, schema: string, type: string}|null>}
	 */
	async resolveEntity(name, searchPaths = ['public']) {
		return null // Default: not implemented
	}

	// --- Utility ---

	log(message, level = 'info') {
		if (this.verbose) {
			const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
			fn(message)
		}
	}
}
