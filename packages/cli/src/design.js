/**
 * Design class — orchestrates configuration, validation, and operations.
 *
 * Refactored from src/collect.js to use @jerrythomas/dbd-db packages.
 * The adapter provides all dialect-specific behavior (parsing, classification).
 */
import fs from 'fs'
import path from 'path'
import { omit, pick } from 'ramda'
import {
	entityFromSchemaName,
	entityFromExportConfig,
	entityFromExtensionConfig,
	ddlFromEntity,
	validateEntity,
	importScriptForEntity,
	exportScriptForEntity,
	filterEntitiesForDBML,
	sortByDependencies,
	graphFromEntities
} from '@jerrythomas/dbd-db'
import { generateDBML } from '@jerrythomas/dbd-dbml'
import { read, clean } from './config.js'
import { matchReferences } from './references.js'

class Design {
	#config = {}
	#roles = []
	#entities = []
	#isValidated = false
	#databaseURL
	#importTables
	#adapter = null
	#env = 'prod'

	constructor(rawConfig, adapter, databaseURL, env = 'prod') {
		const parseEntity = (entity) => adapter.parseEntityScript(entity)
		const matchRefs = (entities, exts) =>
			matchReferences(entities, exts, (name, installed) =>
				adapter.classifyReference(name, installed)
			)

		let config = clean(rawConfig, parseEntity, matchRefs)

		let extensionSchema = config.project.extensionSchema
		this.#databaseURL = databaseURL
		this.#adapter = adapter
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
		this.#env = env
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

	/**
	 * Update entities after async DB resolution.
	 * Replaces the config entities and rebuilds the full entity list.
	 */
	updateEntities(resolvedEntities) {
		this.#config.entities = resolvedEntities
		this.#entities = [
			...this.#config.schemas.map((schema) => entityFromSchemaName(schema)),
			...this.#config.extensions.map((item) =>
				entityFromExtensionConfig(item, this.#config.project.extensionSchema)
			),
			...this.#config.roles,
			...this.#config.entities
		]
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
			.filter((entity) => entity.env === null || entity.env === this.#env)
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
		const warnings = [
			...this.entities.filter((entity) => entity.warnings && entity.warnings.length > 0),
			...this.importTables.filter((table) => table.warnings && table.warnings.length > 0)
		].filter((entity) => !name || entity.name === name)
		const entity = this.entities.filter((entity) => entity.name === name).pop()
		return { entity, issues, warnings }
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
		const results = generateDBML({
			entities: this.entities,
			project: this.config.project,
			ddlFromEntity,
			filterEntities: filterEntitiesForDBML,
			file
		})

		results.map(({ fileName, content, error }) => {
			if (error) {
				console.error(error)
			} else {
				try {
					fs.writeFileSync(fileName, content)
					console.info(`Generated DBML in ${fileName}`)
				} catch (err) {
					console.error(err)
				}
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
		return this.#adapter
	}

	graph(name) {
		return graphFromEntities(this.config.entities, name)
	}
}

/**
 * Async factory function for creating a Design instance.
 * Loads the adapter based on the project's configured database dialect.
 *
 * @param {string} file - path to configuration file
 * @param {string} databaseURL - database connection URL
 * @returns {Promise<Design>}
 */
export async function using(file, databaseURL, env = 'prod') {
	const rawConfig = read(file)
	const dbType = rawConfig.project?.database || 'PostgreSQL'
	const { createAdapter, registerAdapter } = await import('@jerrythomas/dbd-db')
	registerAdapter('postgres', () => import('@jerrythomas/dbd-postgres-adapter'))
	registerAdapter('postgresql', () => import('@jerrythomas/dbd-postgres-adapter'))
	const adapter = await createAdapter(dbType.toLowerCase(), databaseURL)
	await adapter.initParser()
	return new Design(rawConfig, adapter, databaseURL, env)
}
