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
		this.#options = { verbose: false, dryRun: false, project: '', ...options }
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

	get project() {
		return this.#options.project || ''
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

	/**
	 * Parse a table entity's DDL file and return structured snapshot data.
	 * Used for snapshot creation and schema diffing.
	 *
	 * @param {Object} entity - Entity with { file, name, schema }
	 * @returns {{ name: string, schema: string, columns: Array, indexes: Array, tableConstraints: Array }}
	 */
	parseTableSnapshot(entity) {
		return {
			name: entity.name,
			schema: entity.schema,
			columns: [],
			indexes: [],
			tableConstraints: []
		}
	}

	// --- Migration tracking ---

	/**
	 * Ensure the _dbd_migrations tracking table exists in the database.
	 * @returns {Promise<void>}
	 */
	async ensureMigrationsTable() {
		throw new Error('not implemented')
	}

	/**
	 * Get the current applied migration version from the database.
	 * @returns {Promise<number>} Current version, or 0 if no migrations applied yet
	 */
	async getDbVersion() {
		throw new Error('not implemented')
	}

	/**
	 * Apply a migration SQL script and record it in _dbd_migrations.
	 * Must execute in a transaction: rolls back on failure.
	 *
	 * @param {number} version - Migration version number
	 * @param {string} sql - Migration SQL to execute
	 * @param {string} description - Human-readable description
	 * @param {string} checksum - SHA-256 hex of the migration SQL
	 * @returns {Promise<void>}
	 */
	async applyMigration(version, sql, description, checksum) {
		throw new Error('not implemented')
	}

	// --- Utility ---

	log(message, level = 'info') {
		if (this.verbose) {
			const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
			fn(message)
		}
	}
}
