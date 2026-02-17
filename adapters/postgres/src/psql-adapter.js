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
