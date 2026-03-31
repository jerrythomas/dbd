import { readFileSync, createReadStream, createWriteStream, mkdirSync } from 'fs'
import { dirname, sep } from 'path'
import { pipeline } from 'node:stream/promises'
import { BaseDatabaseAdapter } from '@jerrythomas/dbd-db'
import {
	extractDependencies,
	extractTables,
	extractIndexes,
	extractViewDefinitions,
	parse
} from './parser/index-functional.js'
import { initParser } from './parser/parsers/sql.js'
import { isInternal } from './reference-classifier.js'
import postgres from 'postgres'

/**
 * Build a dry-run log message for an entity.
 */
const buildDryRunMessage = (entity) => {
	const using =
		entity.file || entity.type === 'extension' ? ` using "${entity.file || entity.schema}"` : ''
	return `[dry-run] ${entity.type} => ${entity.name}${using}`
}

/**
 * Return a double-quoted, escaped PostgreSQL identifier for a qualified name.
 * e.g. "staging.lookup_values" → '"staging"."lookup_values"'
 */
const quoteIdentifier = (name) => {
	const parts = name.split('.')
	return parts.map((p) => `"${p.replace(/"/g, '""')}"`).join('.')
}

/**
 * PostgreSQL adapter that uses the `postgres` library (porsager/postgres).
 *
 * Uses a persistent connection pool — faster than shelling out to psql.
 * All SQL is executed via prepared statements or unsafe() for DDL/COPY.
 */
export class PgAdapter extends BaseDatabaseAdapter {
	#client = null

	get #db() {
		if (!this.#client) {
			this.#client = postgres(this.connectionString, {
				max: 5,
				onnotice: () => {} // suppress NOTICE messages
			})
		}
		return this.#client
	}

	async connect() {
		await this.#db`SELECT 1`
		this.log('PgAdapter: connected')
	}

	async disconnect() {
		if (this.#client) {
			await this.#client.end()
			this.#client = null
		}
		this.log('PgAdapter: disconnected')
	}

	async testConnection() {
		try {
			await this.#db`SELECT 1`
			return true
		} catch {
			return false
		}
	}

	async inspect() {
		try {
			const [{ version }] = await this.#db`SELECT version()`
			return { connected: true, version }
		} catch {
			return { connected: false, version: null }
		}
	}

	async executeScript(script, options = {}) {
		if (this.dryRun || options.dryRun) {
			this.log(`[dry-run] Would execute: ${script.slice(0, 100)}...`)
			return
		}
		this.log(`Executing script (${script.length} bytes)`)
		// Reset search_path after execution — DDL scripts may SET search_path to a
		// project schema, which would otherwise affect subsequent queries on this connection.
		await this.#db.unsafe(script + '\nRESET search_path;')
	}

	async executeFile(file, options = {}) {
		if (this.dryRun || options.dryRun) {
			this.log(`[dry-run] Would execute file: ${file}`)
			return
		}
		this.log(`Executing file: ${file}`)
		const script = readFileSync(file, 'utf-8')
		await this.#db.unsafe(script + '\nRESET search_path;')
	}

	async applyEntity(entity, options = {}) {
		const { ddlFromEntity } = await import('@jerrythomas/dbd-db')

		if (entity.errors && entity.errors.length > 0) {
			this.log(`Skipping ${entity.name} (has errors)`, 'warn')
			return
		}

		if (this.dryRun || options.dryRun) {
			this.log(buildDryRunMessage(entity))
			return
		}

		console.info(`Applying ${entity.type}: ${entity.name}`)

		if (entity.file) {
			await this.executeFile(entity.file, options)
		} else {
			const ddl = ddlFromEntity(entity)
			if (ddl) await this.executeScript(ddl, options)
		}
	}

	async importData(entity, options = {}) {
		if (entity.errors && entity.errors.length > 0) {
			this.log(`Skipping import of ${entity.name} (has errors)`, 'warn')
			return
		}

		if (this.dryRun || options.dryRun) {
			this.log(`[dry-run] Would import: ${entity.name}`)
			return
		}

		this.log(`Importing ${entity.name}`)

		if (entity.truncate) {
			try {
				await this.#db.unsafe(`TRUNCATE TABLE ${quoteIdentifier(entity.name)}`)
			} catch {
				await this.#db.unsafe(`DELETE FROM ${quoteIdentifier(entity.name)}`)
			}
		}

		if (['json', 'jsonl'].includes(entity.format)) {
			await this.#db`CREATE TABLE IF NOT EXISTS _temp (data jsonb)`
			const writeStream = await this.#db.unsafe(`COPY _temp FROM STDIN`).writable()
			await pipeline(createReadStream(entity.file), writeStream)
			await this.#db.unsafe(
				`CALL staging.import_jsonb_to_table('_temp', '${entity.name.replace(/'/g, "''")}')`
			)
			await this.#db`DROP TABLE IF EXISTS _temp`
		} else {
			const delimiter = entity.format === 'tsv' ? '\t' : ','
			const nullValue = (entity.nullValue ?? '').replace(/'/g, "''")
			const escapedDelimiter = delimiter.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
			const copySQL = `COPY ${quoteIdentifier(entity.name)} FROM STDIN WITH (FORMAT CSV, DELIMITER '${escapedDelimiter}', NULL '${nullValue}', HEADER true)`
			const writeStream = await this.#db.unsafe(copySQL).writable()
			await pipeline(createReadStream(entity.file), writeStream)
		}
	}

	async exportData(entity, options = {}) {
		if (this.dryRun || options.dryRun) {
			this.log(`[dry-run] Would export: ${entity.name}`)
			return
		}

		this.log(`Exporting ${entity.name}`)

		const filePath = `export/${entity.name.replace('.', sep)}.${entity.format || 'csv'}`
		mkdirSync(dirname(filePath), { recursive: true })

		let copySQL
		if (['json', 'jsonl'].includes(entity.format)) {
			copySQL = `COPY (SELECT row_to_json(t) FROM ${quoteIdentifier(entity.name)} t) TO STDOUT`
		} else {
			const delimiter = entity.format === 'tsv' ? '\t' : ','
			const escapedDelimiter = delimiter.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
			copySQL = `COPY (SELECT * FROM ${quoteIdentifier(entity.name)}) TO STDOUT WITH (FORMAT CSV, DELIMITER '${escapedDelimiter}', HEADER true)`
		}

		const readStream = await this.#db.unsafe(copySQL).readable()
		await pipeline(readStream, createWriteStream(filePath))
	}

	async resolveEntity(name, searchPaths = ['public']) {
		const parts = name.split('.')
		const schemas = parts.length > 1 ? [parts[0]] : searchPaths
		const entityName = parts.length > 1 ? parts[1] : parts[0]

		for (const schema of schemas) {
			const result = await this.#queryEntity(schema, entityName)
			if (result) return result
		}
		return null
	}

	async #queryEntity(schema, name) {
		// Check relations (tables, views, materialized views)
		const relRows = await this.#db`
      SELECT c.relname, n.nspname, c.relkind
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema} AND c.relname = ${name} AND c.relkind IN ('r','v','m')
      LIMIT 1`
		if (relRows.length > 0) {
			const { relname, nspname, relkind } = relRows[0]
			const typeMap = { r: 'table', v: 'view', m: 'view' }
			return { name: `${nspname}.${relname}`, schema: nspname, type: typeMap[relkind] || 'table' }
		}

		// Check routines (functions, procedures)
		const procRows = await this.#db`
      SELECT p.proname, n.nspname, p.prokind
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = ${schema} AND p.proname = ${name}
      LIMIT 1`
		if (procRows.length > 0) {
			const { proname, nspname, prokind } = procRows[0]
			const typeMap = { f: 'function', p: 'procedure', a: 'function', w: 'function' }
			return {
				name: `${nspname}.${proname}`,
				schema: nspname,
				type: typeMap[prokind] || 'function'
			}
		}

		return null
	}

	async ensureMigrationsTable() {
		// Use public schema explicitly — DDL files may SET search_path to a project schema,
		// which would cause unqualified _dbd_migrations to resolve to the wrong schema.
		await this.#db.unsafe(`
      CREATE TABLE IF NOT EXISTS public._dbd_migrations (
        project     text NOT NULL DEFAULT '',
        version     integer NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now(),
        description text,
        checksum    text NOT NULL,
        PRIMARY KEY (project, version)
      )`)
	}

	async clearProjectMigrations() {
		try {
			await this.#db`DELETE FROM public._dbd_migrations WHERE project = ${this.project}`
		} catch {
			// Table doesn't exist yet — nothing to clear
		}
	}

	async getDbVersion() {
		try {
			const [{ version }] = await this.#db`
        SELECT COALESCE(MAX(version), 0) AS version
        FROM public._dbd_migrations
        WHERE project = ${this.project}`
			return Number(version) || 0
		} catch {
			return 0
		}
	}

	async applyMigration(version, migrationSql, description, checksum) {
		await this.#db.begin(async (tx) => {
			if (migrationSql.trim()) await tx.unsafe(migrationSql)
			await tx`
        INSERT INTO public._dbd_migrations (project, version, description, checksum)
        VALUES (${this.project}, ${version}, ${description || ''}, ${checksum})`
		})
	}

	// --- Parsing operations (pure JS — no psql dependency) ---

	async initParser() {
		await initParser()
	}

	parseScript(sql, options = {}) {
		return extractDependencies(sql, options)
	}

	parseEntityScript(entity) {
		const content = readFileSync(entity.file, 'utf-8')
		try {
			return this.#parseEntityAST(entity, content)
		} catch (err) {
			return {
				...entity,
				searchPaths: [],
				references: [],
				errors: [`Failed to parse: ${err.message}`]
			}
		}
	}

	classifyReference(name, installedExtensions = []) {
		return isInternal(name, installedExtensions)
	}

	parseTableSnapshot(entity) {
		const content = readFileSync(entity.file, 'utf-8')
		try {
			const ast = parse(content)
			const tables = extractTables(ast)
			const indexes = extractIndexes(ast)
			const table = tables[0] ?? { columns: [], constraints: [] }
			const tableIndexes = indexes.map(({ name, unique, columns }) => ({ name, unique, columns }))
			return {
				name: entity.name,
				schema: entity.schema,
				columns: table.columns ?? [],
				indexes: tableIndexes,
				tableConstraints: table.constraints ?? []
			}
		} catch {
			return {
				name: entity.name,
				schema: entity.schema,
				columns: [],
				indexes: [],
				tableConstraints: []
			}
		}
	}

	parseViewColumns(entity) {
		const content = readFileSync(entity.file, 'utf-8')
		try {
			const views = extractViewDefinitions(content)
			return views[0]?.columns.map((c) => c.name) ?? []
		} catch {
			return []
		}
	}

	// --- Private parse helpers ---

	#parseEntityAST(entity, content) {
		const result = extractDependencies(content)
		const info = result.entity
		const searchPaths = result.searchPaths

		if (!info || !info.name) {
			return {
				...entity,
				searchPaths,
				references: [],
				errors: ['Could not identify entity in script']
			}
		}

		const schema = info.schema || searchPaths[0]
		const fullName = schema + '.' + info.name

		let errors = []
		if (schema !== entity.schema) errors.push('Schema in script does not match file path')
		if (info.type !== entity.type) errors.push('Entity type in script does not match file path')
		if (fullName !== entity.name) errors.push('Entity name in script does not match file name')

		const excludeEntity = [info.name, fullName]
		const references = result.references.filter(({ name }) => !excludeEntity.includes(name))

		const isRoutine = info.type === 'procedure' || info.type === 'function'
		const parsedProc = isRoutine ? result.procedures.find((p) => p.name === info.name) : null

		return {
			...entity,
			type: info.type,
			name: fullName,
			schema,
			searchPaths,
			references,
			errors,
			...(parsedProc ? { reads: parsedProc.reads, writes: parsedProc.writes } : {})
		}
	}
}
