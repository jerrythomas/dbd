import fs, { rmSync } from 'fs'
import path from 'path'
import { omit, pick } from 'ramda'
import { execSync } from 'child_process'
import { importer } from '@dbml/core'
import { read, clean, organize } from './metadata.js'
import {
	entityFromSchemaName,
	entityFromExportConfig,
	entityFromExtensionConfig,
	ddlFromEntity,
	validateEntityFile,
	importScriptForEntity,
	exportScriptForEntity,
	entitiesForDBML
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
		this.#config.extensions = this.#config.extensions ?? []
		this.#config.roles = organize(config.roles)
		this.#config.entities = organize(config.entities)

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
	// organize import tables in the sequence of their presence in the entities list
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

		this.#roles = this.config.roles.map((role) => validateEntityFile(role))
		this.#entities = this.entities.map((entity) =>
			validateEntityFile(entity, true, this.config.ignore)
		)
		this.#importTables = this.importTables
			.map((entity) => validateEntityFile(entity, false))
			.map((entity) => {
				if (!allowedSchemas.includes(entity.schema))
					entity.errors = [...(entity.errors || []), 'Import is only allowed for staging schemas']
				return entity
			})

		this.#isValidated = true
		// fs.writeFileSync('dbd-cache.json', JSON.stringify(this, null, 2))
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
		const TMP_SCRIPT = '_temp.ddl'
		if (!this.isValidated) this.validate()

		if (dryRun) {
			this.entities.map((entity) => {
				const using =
					entity.file || entity.type === 'extension'
						? ` using "${entity.file || entity.schema}"`
						: ''
				const detail = `${entity.type} => ${entity.name}${using}`
				if (entity.errors && entity.errors.length > 0) {
					console.error(pick(['type', 'name', 'errors'], entity))
				} else {
					console.info(detail)
				}
			})
			return
		}

		this.entities
			.filter((entity) => !entity.errors || entity.errors.length === 0)
			.filter((entity) => !name || entity.name === name)
			.map((entity) => {
				const file = entity.file || TMP_SCRIPT
				if (!entity.file) {
					fs.writeFileSync(TMP_SCRIPT, ddlFromEntity(entity))
				}
				console.info(`Applying ${entity.type}: ${entity.name}`)
				execSync(`psql ${this.databaseURL} < ${file}`)
				if (fs.existsSync(TMP_SCRIPT)) fs.unlinkSync(TMP_SCRIPT)
			})

		// return this
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
			let combined = entitiesForDBML(this.entities, doc.config)
				.map((entity) => ddlFromEntity(entity))
				.map((ddl) => (ddl ? ddl.replace(/create\s.*index\s.*on\s.*;/gi, '') : ddl))

			const replacer = entitiesForDBML(this.entities, doc.config)
				.filter((entity) => entity.type === 'table')
				.map(({ name, schema }) => ({
					name: name.replace(schema + '.', ''),
					schema
				}))
				.map(({ name, schema }) => ({
					original: `Table "${name}"`,
					replacement: `Table "${schema}"."${name}" as "${name}"`
				}))

			fs.writeFileSync('combined.sql', combined.join('\n'))

			try {
				const project = `Project "${doc.project}" {\n database_type: '${this.config.project.database}'\n Note: "${this.config.project.note}" \n}\n`
				let dbml = importer.import(combined.join('\n'), 'postgres')
				const fileName = [doc.project, file].join('-')

				// replace table names with schem.table
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

	importData(name, dryRun = false) {
		if (!this.isValidated) this.validate()

		this.importTables
			.filter((entity) => !entity.errors)
			.filter((entity) => !name || entity.name === name || entity.file === name)
			.map((table) => {
				console.info(`Importing ${table.name}`)
				table.warnings.map((message) => console.warn(message))

				if (!dryRun) {
					fs.writeFileSync('_import.sql', importScriptForEntity(table))
					execSync(`psql ${this.databaseURL} < _import.sql`)
					fs.unlinkSync('_import.sql')
				}
			})

		this.config.import.after.map((file) => {
			console.info(`Processing ${file}`)
			if (!dryRun) execSync(`psql ${this.databaseURL} < ${file}`)
		})

		return this
	}

	exportData(name) {
		const entities = this.config.export
			.map((entity) => entityFromExportConfig(entity))
			.filter((entity) => !name || entity.name === name)

		const folders = [
			...new Set(entities.map((entity) => path.join('export', entity.name.split('.')[0])))
		]
		let commands = entities.map((entity) => exportScriptForEntity(entity))

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
