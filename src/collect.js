import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { execSync } from 'child_process'
import sql from '@databases/pg'
import { read, clean, organize } from './metadata.js'
import {
	entityFromSchemaName,
	entityFromExtensionConfig,
	ddlFromEntity
} from './entity.js'

class Design {
	#config = {}
	#entities = []

	constructor(file) {
		this.#config = clean(read(file))
		this.#config.roles = organize(this.#config.roles)
		this.#config.entities = organize(this.#config.entities)

		this.#entities = [
			...this.#config.schemas.map((schema) => entityFromSchemaName(schema)),
			...this.#config.extensions.map((item) => entityFromExtensionConfig(item)),
			...this.#config.roles,
			...this.#config.entities
		]
	}

	get config() {
		return this.#config
	}
	get entities() {
		return this.#entities
	}

	async apply() {
		const db = createConnectionPool(process.env.DATABASE_URL)
		let index = 0
		let error
		// let waiting = false

		do {
			const entity = this.#entities[index]
			const q = entity.file
				? sql.file(entity.file)
				: sql`${ddlFromEntity(entity)}`

			try {
				await db.query(q)
				index += 1
			} catch (err) {
				error = err
			}
		} while (index < this.#entities.length && !error)

		await db.dispose()
		return this
	}

	validate(ddl = true) {
		return this
	}

	combine(file) {
		// add validation before
		const combined = this.#entities.map((entity) => ddlFromEntity(entity))
		fs.writeFileSync(file, combined.join('\n'))
		return this
	}
	dbml() {
		const { schemas, tables } = this.#config.project.dbdocs.exclude
		const combined = this.#entities
			.filter((entity) => entity.type === 'table')
			.filter((entity) => !schemas.includes(entity.name.split('.')[0]))
			.filter((entity) => !tables.includes(entity.name))
			.map((entity) => ddlFromEntity(entity))

		fs.writeFileSync('_design.sql', combined.join('\n'))
		execSync(`sql2dbml _design.sql --postgres -o design.dbml`)
		fs.unlinkSync('_design.sql')

		return this
	}
	importData() {
		return this
	}
	exportData() {
		return this
	}
}

/**
 * Collects files from path or entities from configuration
 * and provides functions to process further
 *
 * @param {path} file path to configuration file
 * @returns
 */
export function using(file) {
	return new Design(file)
}

// using(config) // read, clean, organize
// 	.apply() // apply ddls
// 	.combine(includeData) // combine with optional data
// 	.dbml(file) // combine, exclude schemas and tables and generate dbml
// 	.importSeededData() // import seeded data, needs additional logic to exclude non existing files, pre-post script, null handler
// 	.importStagingData() // import staging data, pre/post scripts, null handler
// 	.exportData() // export Data
