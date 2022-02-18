import fs from 'fs'
import path from 'path'
import { omit } from 'ramda'
import { execSync } from 'child_process'

import { read, clean, organize } from './metadata.js'
import {
	entityFromSchemaName,
	entityFromExportConfig,
	entityFromExtensionConfig,
	ddlFromEntity,
	validateEntityFile,
	importScriptForEntity,
	exportScriptForEntity
} from './entity.js'

class Design {
	#config = {}
	#roles = []
	#entities = []
	#isValidated = false
	#databaseURL
	#importTables

	constructor(file, databaseURL) {
		let config = clean(read(file))
		let extensionSchema = config.project.extensionSchema
		this.#databaseURL = databaseURL
		this.#config = omit(['importTables'], config)

		this.#config.roles = organize(config.roles)
		this.#config.entities = organize(config.entities)
		this.#entities = [
			...this.#config.schemas.map((schema) => entityFromSchemaName(schema)),
			...this.#config.extensions.map((item) =>
				entityFromExtensionConfig(item, extensionSchema)
			),
			...this.#config.roles,
			...this.#config.entities
		]
		this.#importTables = config.importTables
	}

	get config() {
		return this.#config
	}
	get entities() {
		return this.#entities
	}
	get roles() {
		return this.#roles
	}
	get isValidated() {
		return this.#isValidated
	}
	get databaseURL() {
		return this.#databaseURL
	}
	get importTables() {
		return this.#importTables
	}

	validate() {
		const allowedSchemas = this.#config.project.staging

		this.#roles = this.config.roles.map((role) => validateEntityFile(role))
		this.#entities = this.entities.map((entity) => validateEntityFile(entity))
		this.#importTables = this.importTables
			.map((entity) => validateEntityFile(entity, false))
			.map((entity) => {
				if (!allowedSchemas.includes(entity.schema))
					entity.errors = [
						...(entity.errors || []),
						`Import is only allowed for staging schemas`
					]
				return entity
			})
		this.#isValidated = true
		return this
	}

	report() {
		if (!this.isValidated) this.validate()
		const issues = [
			...this.entities.filter((entity) => entity.errors),
			...this.importTables.filter((table) => table.errors)
		].map(({ name, errors }) => `${name}: ${errors.join(', ')}`)

		return issues
	}

	async apply(name) {
		const TMP_COMBINED_FILE = '_combined.ddl'

		let combined = this.entities
			.filter((entity) => !entity.errors)
			.filter((entity) => !name || entity.name === name)
			.map((entity) => ddlFromEntity(entity))

		if (combined.length > 0) {
			fs.writeFileSync(TMP_COMBINED_FILE, combined.join('\n'))
			execSync(`psql ${this.databaseURL} < ${TMP_COMBINED_FILE}`)
			fs.unlinkSync(TMP_COMBINED_FILE)
		}

		return this
	}

	combine(file) {
		if (!this.isValidated) this.validate()
		const combined = this.entities
			.filter((entity) => !entity.errors)
			.map((entity) => ddlFromEntity(entity))
		fs.writeFileSync(file, combined.join('\n'))
		return this
	}

	dbml() {
		const { schemas, tables } = this.config.project.dbdocs.exclude
		const combined = this.entities
			.filter((entity) => entity.type === 'table')
			.filter((entity) => !schemas.includes(entity.schema))
			.filter((entity) => !tables.includes(entity.name))
			.map((entity) => ddlFromEntity(entity))

		fs.writeFileSync('_design.sql', combined.join('\n'))
		execSync(`sql2dbml _design.sql --postgres -o design.dbml`)
		fs.unlinkSync('_design.sql')

		return this
	}

	importData(name) {
		if (!this.isValidated) this.validate()

		let commands = this.importTables
			.filter((entity) => !entity.errors)
			.filter((entity) => !name || entity.name === name || entity.file === name)
			.map((table) => importScriptForEntity(table))

		let postCommands = this.config.import.after.map((file) =>
			fs.readFileSync(file, 'utf8')
		)

		if (commands.length > 0) {
			fs.writeFileSync('_import.sql', [...commands, ...postCommands].join('\n'))
			execSync(`psql ${this.databaseURL} < _import.sql`)
			fs.unlinkSync('_import.sql')
		}

		return this
	}

	exportData(name) {
		const folders = [
			...new Set(
				this.config.export.map((entity) =>
					path.join('export', entity.split('.')[0])
				)
			)
		]
		let commands = this.config.export
			.map((entity) => entityFromExportConfig(entity))
			.filter((entity) => !name || entity.name === name)
			.map((entity) => exportScriptForEntity(entity))

		if (commands.length > 0) {
			folders.map((folder) => fs.mkdirSync(folder, { recursive: true }))
			fs.writeFileSync('_export.sql', commands.join('\n'))
			execSync(`psql ${this.databaseURL} < _export.sql`)
			fs.unlinkSync('_export.sql')
		}

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
export function using(file, databaseURL) {
	return new Design(file, databaseURL)
}
