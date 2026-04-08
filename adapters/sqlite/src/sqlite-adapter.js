// Note: db.exec() here is better-sqlite3's synchronous DDL executor, not child_process.exec()
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { BaseDatabaseAdapter } from '@jerrythomas/dbd-db'

const UNSUPPORTED_TYPES = new Set(['schema', 'extension', 'role'])

export function stripSchema(name) {
	const parts = name.split('.')
	return parts[parts.length - 1]
}

export class SqliteAdapter extends BaseDatabaseAdapter {
	#db = null

	async connect() {
		this.#db = new Database(this.connectionString)
	}

	async disconnect() {
		if (this.#db) {
			this.#db.close()
			this.#db = null
		}
	}

	async executeScript(sql, options = {}) {
		if (this.dryRun || options.dryRun) {
			this.log(`[dry-run] ${sql.slice(0, 100)}`)
			return
		}
		this.#db.exec(sql)
	}

	async applyEntity(entity, options = {}) {
		if (entity.errors?.length > 0) return

		if (UNSUPPORTED_TYPES.has(entity.type)) {
			this.log(`Skipping ${entity.type}: ${entity.name} (not supported by SQLite)`)
			return
		}

		if (this.dryRun || options.dryRun) {
			this.log(`[dry-run] ${entity.type} => ${entity.name}`)
			return
		}

		const sql = readFileSync(entity.file, 'utf-8')
		this.#db.exec(sql)
	}

	async importData(entity, options = {}) {
		if (entity.errors?.length > 0) return
		if (this.dryRun || options.dryRun) {
			this.log(`[dry-run] Would import: ${entity.name}`)
			return
		}
		// CSV/TSV/JSON import via prepared statements (future implementation)
	}

	async inspect() {
		if (!this.#db) return { connected: false, version: null }
		this.#db.pragma('user_version')
		return { connected: true, version: 'SQLite (better-sqlite3)' }
	}

	parseEntityScript(entity) {
		return { ...entity, searchPaths: [], references: [], errors: [] }
	}

	classifyReference() {
		return null
	}
}
