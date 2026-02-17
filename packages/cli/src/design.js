/**
 * Design class — orchestrates configuration, validation, and operations.
 *
 * Refactored from src/collect.js to use @jerrythomas/dbd-db packages.
 */
import fs, { rmSync } from 'fs'
import path from 'path'
import { omit, pick } from 'ramda'
import { importer } from '@dbml/core'
import {
	entityFromSchemaName,
	entityFromExportConfig,
	entityFromExtensionConfig,
	ddlFromEntity,
	validateEntity,
	importScriptForEntity,
	exportScriptForEntity,
	filterEntitiesForDBML,
	sortByDependencies
} from '@jerrythomas/dbd-db'
import { read, clean } from './config.js'
import { parseEntityScript, matchReferences, cleanupDDLForDBML } from './references.js'

class Design {
	#config = {}
	#roles = []
	#entities = []
	#isValidated = false
	#databaseURL
	#importTables
	#adapter = null

	constructor(file, databaseURL) {
		let config = clean(read(file), parseEntityScript, matchReferences)

		let extensionSchema = config.project.extensionSchema
		this.#databaseURL = databaseURL
		this.#config = omit(['importTables'], config)
		this.#config.extensions = this.#config.extensions ?? []
		this.#config.roles = sortByDependencies(config.roles)
		this.#config.entities = sortByDependencies(config.entities)

		this.#entities = [
			...this.#config.schemas.map((schema) => entityFromSchemaName(schema)),
			...this.#config.extensions.map((item) => entityFromExtensionConfig(item, extensionSchema)),
			...this.#config.roles,
			...this.#config.entities
		]

		this.#importTables = this.organizeImports(config.importTables)
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

	organizeImports(importTables) {
		const tables = this.#config.entities.filter((entity) => entity.type === 'table')

		return importTables
			.map((x) => {
				const index = tables.findIndex((table) => table.name === x.name)
				const refers = index >= 0 ? tables[index].refers : []
				const warnings = refers
					.map((ref) => {
						if (!importTables.find((table) => table.name === ref)) {
							return `Warning: referenced table ${ref} is missing from imports`
						}
					})
					.filter((x) => x)
				return { ...x, order: index, refers, warnings }
			})
			.sort((a, b) => a.order - b.order)
	}

	validate() {
		const allowedSchemas = this.#config.project.staging

		this.#roles = this.config.roles.map((role) => validateEntity(role))
		this.#entities = this.entities.map((entity) => validateEntity(entity, true, this.config.ignore))
		this.#importTables = this.importTables
			.map((entity) => validateEntity(entity, false))
			.map((entity) => {
				if (!allowedSchemas.includes(entity.schema))
					entity.errors = [...(entity.errors || []), 'Import is only allowed for staging schemas']
				return entity
			})

		this.#isValidated = true
		return this
	}

	report(name) {
		if (!this.isValidated) this.validate()
		const issues = [
			...this.entities.filter((entity) => entity.errors && entity.errors.length > 0),
			...this.importTables.filter((table) => table.errors && table.errors.length > 0)
		].filter((entity) => !name || entity.name === name)
		const entity = this.entities.filter((entity) => entity.name === name).pop()
		return { entity, issues }
	}

	async apply(name, dryRun = false) {
		if (!this.isValidated) this.validate()

		if (dryRun) {
			this.entities.map((entity) => {
				const using =
					entity.file || entity.type === 'extension'
						? ` using "${entity.file || entity.schema}"`
						: ''
				const detail = `${entity.type} => ${entity.name}${using}`

				if (entity.errors && entity.errors.length > 0) {
					console.error(pick(['type', 'name', 'file', 'errors'], entity))
				} else {
					console.info(detail)
				}
			})
			return
		}

		const adapter = await this.getAdapter()
		const validEntities = this.entities
			.filter((entity) => !entity.errors || entity.errors.length === 0)
			.filter((entity) => !name || entity.name === name)

		await adapter.applyEntities(validEntities)
	}

	combine(file) {
		if (!this.isValidated) this.validate()
		const combined = this.entities
			.filter((entity) => !entity.errors || entity.errors.length === 0)
			.map((entity) => ddlFromEntity(entity))

		fs.writeFileSync(file, combined.join('\n'))
		return this
	}

	dbml(file = 'design.dbml') {
		const keys = Object.keys(this.config.project.dbdocs)
		let docs = []

		if (keys.includes('exclude') || keys.includes('include')) {
			docs = [
				{
					config: this.config.project.dbdocs,
					project: this.config.project.name
				}
			]
		}
		docs = [
			...docs,
			...keys
				.filter((key) => key !== 'exclude' && key !== 'include')
				.map((key) => ({
					config: this.config.project.dbdocs[key],
					project: this.config.project.name + '-' + key
				}))
		]

		docs.map((doc) => {
			let combined = filterEntitiesForDBML(this.entities, doc.config)
				.map((entity) => ddlFromEntity(entity))
				.map((ddl) => cleanupDDLForDBML(ddl))

			const replacer = filterEntitiesForDBML(this.entities, doc.config)
				.filter((entity) => entity.type === 'table')
				.map(({ name, schema }) => ({
					name: name.replace(schema + '.', ''),
					schema
				}))
				.map(({ name, schema }) => ({
					original: `Table "${name}"`,
					replacement:
						schema === 'public'
							? `Table "${schema}"."${name}"`
							: `Table "${schema}"."${name}" as "${name}"`
				}))

			fs.writeFileSync('combined.sql', combined.join('\n'))

			try {
				const project = `Project "${doc.project}" {\n database_type: '${this.config.project.database}'\n Note: "${this.config.project.note}" \n}\n`
				let dbml = importer.import(combined.join('\n'), 'postgres')
				const fileName = [doc.project, file].join('-')

				replacer.map(({ original, replacement }) => {
					dbml = dbml.replace(new RegExp(original, 'g'), replacement)
				})
				fs.writeFileSync(fileName, project + dbml)
				rmSync('combined.sql')
				console.info(`Generated DBML in ${fileName}`)
			} catch (err) {
				console.error(err)
			}
		})

		return this
	}

	async importData(name, dryRun = false) {
		if (!this.isValidated) this.validate()

		if (dryRun) {
			this.importTables
				.filter((entity) => !entity.errors)
				.filter((entity) => !name || entity.name === name || entity.file === name)
				.map((table) => {
					console.info(`Importing ${table.name}`)
					table.warnings.map((message) => console.warn(message))
					console.info(table)
				})
		} else {
			const adapter = await this.getAdapter()
			const tables = this.importTables
				.filter((entity) => !entity.errors)
				.filter((entity) => !name || entity.name === name || entity.file === name)

			for (const table of tables) {
				console.info(`Importing ${table.name}`)
				table.warnings.map((message) => console.warn(message))
				await adapter.importData(table)
			}

			for (const file of this.config.import.after) {
				console.info(`Processing ${file}`)
				await adapter.executeFile(file)
			}
		}

		return this
	}

	async exportData(name) {
		const entities = this.config.export
			.map((entity) => entityFromExportConfig(entity))
			.filter((entity) => !name || entity.name === name)

		const folders = [
			...new Set(entities.map((entity) => path.join('export', entity.name.split('.')[0])))
		]

		if (entities.length > 0) {
			folders.map((folder) => fs.mkdirSync(folder, { recursive: true }))
			const adapter = await this.getAdapter()
			await adapter.batchExport(entities)
		}

		return this
	}

	async getAdapter() {
		if (!this.#adapter) {
			const { createAdapter } = await import('@jerrythomas/dbd-db')
			this.#adapter = await createAdapter('postgres', this.databaseURL)
		}
		return this.#adapter
	}
}

/**
 * Factory function for creating a Design instance.
 *
 * @param {string} file - path to configuration file
 * @param {string} databaseURL - database connection URL
 * @returns {Design}
 */
export function using(file, databaseURL) {
	return new Design(file, databaseURL)
}
