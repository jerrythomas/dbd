import fs from 'fs'
import path from 'path'
import { omit, pick } from 'ramda'
import { execSync } from 'child_process'
import { ModelExporter, Parser } from '@dbml/core'
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
				if (entity.errors) {
					console.error(pick(['type', 'name', 'errors'], entity))
				} else {
					console.info(detail)
				}
			})
			// console.log(this.databaseURL.replace(/\$/, '\\$'))
			return
		}

		this.entities
			.filter((entity) => !entity.errors)
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
			// console.log(doc.project, entitiesForDBML(this.entities, doc.config))
			const combined = entitiesForDBML(this.entities, doc.config).map(
				(entity) => ddlFromEntity(entity)
			)
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
				// dbml currently does not output project info

				const project = `Project "${doc.project}" {\n database_type: '${this.config.project.database}'\n Note: "${this.config.project.note}" \n}\n`
				let schema = Parser.parse(combined.join('\n'), 'postgres').normalize()

				let dbml = ModelExporter.export(schema, 'dbml')
				const fileName = [doc.project, file].join('-')
				replacer.map(({ original, replacement }) => {
					dbml = dbml.replaceAll(original, replacement)
				})
				fs.writeFileSync(fileName, project + dbml)
				console.info(`Generated DBML in ${fileName}`)
			} catch (err) {
				console.error(err)
			}
		})

		return this
	}

	importData(name) {
		if (!this.isValidated) this.validate()

		this.importTables
			.filter((entity) => !entity.errors)
			.filter((entity) => !name || entity.name === name || entity.file === name)
			.map((table) => {
				fs.writeFileSync('_import.sql', importScriptForEntity(table))
				console.info(`Importing ${table.name}`)
				execSync(`psql ${this.databaseURL} < _import.sql`)
				fs.unlinkSync('_import.sql')
			})
		this.config.import.after.map((file) => {
			console.info(`Processing ${file}`)
			execSync(`psql ${this.databaseURL} < ${file}`)
		})

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
