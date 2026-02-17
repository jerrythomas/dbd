import { execSync } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { BaseDatabaseAdapter } from '@jerrythomas/dbd-db'

const TMP_SCRIPT = '_dbd_temp.sql'

/**
 * PostgreSQL adapter that shells out to `psql`.
 *
 * This is the v1-compatible adapter — same mechanism as the legacy code.
 * It requires `psql` to be installed and available on the PATH.
 */
export class PsqlAdapter extends BaseDatabaseAdapter {
	async connect() {
		// psql is stateless — no persistent connection to open
		this.log('PsqlAdapter: ready (using psql CLI)')
	}

	async disconnect() {
		// psql is stateless — nothing to close
		this.log('PsqlAdapter: disconnected')
	}

	async testConnection() {
		try {
			execSync(`psql ${this.connectionString} -c "SELECT 1"`, { stdio: 'pipe' })
			return true
		} catch {
			return false
		}
	}

	async inspect() {
		try {
			const version = execSync(`psql ${this.connectionString} -t -c "SELECT version()"`, {
				stdio: 'pipe',
				encoding: 'utf8'
			}).trim()
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

		try {
			writeFileSync(TMP_SCRIPT, script)
			this.log(`Executing script (${script.length} bytes)`)
			execSync(`psql ${this.connectionString} < ${TMP_SCRIPT}`, { stdio: 'pipe' })
		} finally {
			if (existsSync(TMP_SCRIPT)) unlinkSync(TMP_SCRIPT)
		}
	}

	async executeFile(file, options = {}) {
		if (this.dryRun || options.dryRun) {
			this.log(`[dry-run] Would execute file: ${file}`)
			return
		}

		this.log(`Executing file: ${file}`)
		execSync(`psql ${this.connectionString} < ${file}`, { stdio: 'pipe' })
	}

	async applyEntity(entity, options = {}) {
		const { ddlFromEntity } = await import('@jerrythomas/dbd-db')

		if (entity.errors && entity.errors.length > 0) {
			this.log(`Skipping ${entity.name} (has errors)`, 'warn')
			return
		}

		if (this.dryRun || options.dryRun) {
			const using =
				entity.file || entity.type === 'extension' ? ` using "${entity.file || entity.schema}"` : ''
			this.log(`[dry-run] ${entity.type} => ${entity.name}${using}`)
			return
		}

		this.log(`Applying ${entity.type}: ${entity.name}`)

		if (entity.file) {
			await this.executeFile(entity.file, options)
		} else {
			const ddl = ddlFromEntity(entity)
			if (ddl) await this.executeScript(ddl, options)
		}
	}

	async importData(entity, options = {}) {
		const { importScriptForEntity } = await import('@jerrythomas/dbd-db')

		if (entity.errors && entity.errors.length > 0) {
			this.log(`Skipping import of ${entity.name} (has errors)`, 'warn')
			return
		}

		if (this.dryRun || options.dryRun) {
			this.log(`[dry-run] Would import: ${entity.name}`)
			return
		}

		this.log(`Importing ${entity.name}`)
		const script = importScriptForEntity(entity)
		await this.executeScript(script, options)
	}

	/**
	 * Resolve an entity name against PostgreSQL catalog.
	 * Checks pg_class (tables, views) and pg_proc (functions, procedures).
	 *
	 * @param {string} name - Entity name (qualified 'schema.name' or unqualified)
	 * @param {string[]} searchPaths - Schema search paths for unqualified names
	 * @returns {Promise<{name: string, schema: string, type: string}|null>}
	 */
	async resolveEntity(name, searchPaths = ['public']) {
		const parts = name.split('.')
		const schemas = parts.length > 1 ? [parts[0]] : searchPaths
		const entityName = parts.length > 1 ? parts[1] : parts[0]

		for (const schema of schemas) {
			const result = this.#queryEntity(schema, entityName)
			if (result) return result
		}
		return null
	}

	#queryEntity(schema, name) {
		// Check relations (tables, views, materialized views)
		const relQuery = `SELECT c.relname, n.nspname, c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '${schema}' AND c.relname = '${name}' AND c.relkind IN ('r','v','m') LIMIT 1`
		try {
			const output = execSync(`psql ${this.connectionString} -t -A -c "${relQuery}"`, {
				stdio: 'pipe',
				encoding: 'utf8'
			}).trim()
			if (output) {
				const [relname, nspname, relkind] = output.split('|')
				const typeMap = { r: 'table', v: 'view', m: 'view' }
				return { name: `${nspname}.${relname}`, schema: nspname, type: typeMap[relkind] || 'table' }
			}
		} catch {
			// Query failed — connection issue or permission problem
		}

		// Check routines (functions, procedures)
		const procQuery = `SELECT p.proname, n.nspname, p.prokind FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '${schema}' AND p.proname = '${name}' LIMIT 1`
		try {
			const output = execSync(`psql ${this.connectionString} -t -A -c "${procQuery}"`, {
				stdio: 'pipe',
				encoding: 'utf8'
			}).trim()
			if (output) {
				const [proname, nspname, prokind] = output.split('|')
				const typeMap = { f: 'function', p: 'procedure', a: 'function', w: 'function' }
				return {
					name: `${nspname}.${proname}`,
					schema: nspname,
					type: typeMap[prokind] || 'function'
				}
			}
		} catch {
			// Query failed
		}

		return null
	}

	async exportData(entity, options = {}) {
		const { exportScriptForEntity } = await import('@jerrythomas/dbd-db')

		if (this.dryRun || options.dryRun) {
			this.log(`[dry-run] Would export: ${entity.name}`)
			return
		}

		this.log(`Exporting ${entity.name}`)
		const script = exportScriptForEntity(entity)
		await this.executeScript(script, options)
	}
}
