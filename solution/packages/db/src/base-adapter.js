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

	// --- Parsing operations ---

	/**
	 * One-time parser initialization (e.g., load WASM modules).
	 * Called once before parsing begins.
	 * @returns {Promise<void>}
	 */
	async initParser() {
		// Default: no initialization needed
	}

	/**
	 * Parse SQL DDL and extract entity identity, search paths, and references.
	 *
	 * @param {string} sql - SQL DDL content
	 * @param {Object} [options] - Parser options
	 * @returns {{ entity: Object, searchPaths: string[], references: Array }}
	 */
	parseScript(sql, options = {}) {
		throw new Error('not implemented')
	}

	/**
	 * Read an entity's DDL file, identify entity, extract dependencies.
	 *
	 * @param {Object} entity - Entity with { file, schema, type, name }
	 * @returns {Object} Enriched entity with { ...entity, searchPaths, references, errors }
	 */
	parseEntityScript(entity) {
		throw new Error('not implemented')
	}

	/**
	 * Classify a reference name as internal builtin, extension, or unknown.
	 *
	 * @param {string} name - Reference name
	 * @param {string[]} [installedExtensions] - List of installed extensions
	 * @returns {string|null} 'internal', 'extension', or null
	 */
	classifyReference(name, installedExtensions = []) {
		return null
	}

	// --- Utility ---

	log(message, level = 'info') {
		if (this.verbose) {
			const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
			fn(message)
		}
	}
}
