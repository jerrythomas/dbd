import fs from 'fs'
import path from 'path'
import csv from 'csvtojson'

const typesWithoutSchema = ['role', 'schema']
const defaultExportOptions = { format: 'csv' }
const defaultImportOptions = { format: 'csv', nullValue: '', truncate: true }

/**
 * Converts a file path into an Entity object
 *
 * @param {string} filepath
 * @returns an object containing entity details
 */
export function entityFromFile(file) {
	let parts = file.replace(path.extname(file), '').split(path.sep)

	const type = parts[0] === 'ddl' ? parts[1] : parts[0]
	let name = typesWithoutSchema.includes(type)
		? parts[parts.length - 1]
		: parts.slice(parts.length - 2).join('.')

	if (!typesWithoutSchema.includes(type)) {
		return { type, name, file, schema: parts[parts.length - 2] }
	}
	return { type, name, file }
}

/**
 * Converts input into an export Entity
 *
 * @param {(string|Object)} item
 * @returns
 */
export function entityFromExportConfig(item) {
	let entity = item
	let opts = defaultExportOptions

	if (typeof item === 'object') {
		entity = Object.keys(item)[0]
		opts = { ...defaultExportOptions, ...item[entity] }
	}
	return {
		type: 'export',
		name: entity,
		...opts
	}
}

/**
 * Converts input into an import Entity
 *
 * @param {(string|Object)} item
 * @returns
 */
export function entityFromImportConfig(item, opts = defaultImportOptions) {
	let name = item
	opts = { ...defaultImportOptions, ...opts }

	if (typeof item === 'object') {
		name = Object.keys(item)[0]
		opts = { ...opts, ...item[name] }
	}
	return {
		type: 'import',
		name,
		schema: name.split('.')[0],
		...opts
	}
}
/**
 * Converts input into an extension Entity
 *
 * @param {(string|Object)} item
 * @returns {Entity}
 */
export function entityFromExtensionConfig(item, defaultSchema = 'public') {
	let schema = defaultSchema
	let name = item

	if (typeof item === 'object') {
		name = Object.keys(item)[0]
		schema = item[name].schema
	}
	return { type: 'extension', name, schema }
}

/**
 * Converts input into a schema Entity
 *
 * @param {string} name
 * @returns {Entity}
 */
export function entityFromSchemaName(name) {
	return { type: 'schema', name }
}

/**
 * Converts input into a role Entity
 *
 * @param {string} name
 * @returns {Entity}
 */
export function entityFromRoleName(name) {
	return { type: 'role', name }
}

/**
 * @typedef {Object} Entity
 * @property {string} type
 * @property {string} name
 * @property {string} [schema]
 * @property {string} [file]
 * @property {Array<string>} [refers]
 * @returns
 */

/**
 * Get DDL script from file or entity attributes
 *
 * @param {Entity} entity
 * @returns
 */
export function ddlFromEntity(entity) {
	if (entity.file) {
		return fs.readFileSync(entity.file, 'utf8')
	}
	if (entity.type === 'schema') {
		return `create schema if not exists ${entity.name};`
	}
	if (entity.type === 'extension') {
		return `create extension if not exists "${entity.name}" with schema ${
			entity.schema || 'public'
		};`
	}
	if (entity.type === 'role') {
		const grants = entity.refers
			.map((name) => `grant ${name} to ${entity.name};`)
			.join('\n')

		return (
			`DO
    $do$
    BEGIN
       IF NOT EXISTS (
          SELECT FROM pg_catalog.pg_roles
          WHERE  rolname = '${entity.name}') THEN
          CREATE ROLE ${entity.name};
       END IF;
    END
    $do$;` +
			'\n' +
			grants
		)
	}
}

/**
 * Fetch data from CSV or JSON files for an entity
 *
 * @param {Entity} entity
 * @returns array containing data
 */
export async function dataFromEntity(entity) {
	let data = []

	if (path.extname(entity.file) === '.json') {
		data = JSON.parse(fs.readFileSync(entity.file, 'utf8'))
	} else if (path.extname(entity.file) === '.csv') {
		data = await csv().fromFile(entity.file)
	}

	return data
}

/**
 * Validate the file attribute of an entity
 *
 * @param {Entity} entity
 * @returns
 */
export function validateEntityFile(entity, ddl = true) {
	let errors = []

	if (['schema', 'extension'].includes(entity.type)) return entity
	if (
		['table', 'view', 'function', 'procedure'].includes(entity.type) &&
		entity.name.split('.').length != 2
	) {
		errors.push('Use fully qualified name <schema>.<name>')
	}

	if (!entity.file && entity.type != 'role') {
		errors.push('File missing for entity')
	}

	if (entity.file) {
		if (!fs.existsSync(entity.file)) {
			errors.push('File does not exist')
		}
		if (ddl && path.extname(entity.file) !== '.ddl') {
			errors.push('Unsupported file type for ddl')
		}
		if (!ddl && !['.csv', '.json'].includes(path.extname(entity.file))) {
			errors.push('Unsupported data format')
		}
	}

	return errors.length > 0 ? { ...entity, errors } : entity
}

export function importScriptForEntity(entity) {
	let commands = []
	if (entity.truncate) {
		commands.push(`truncate table ${entity.name};`)
	}
	commands.push(
		`\\copy ${entity.name} from '${entity.file}' with delimiter ',' NULL as '${entity.nullValue}' csv header;`
	)
	return commands.join('\n')
}

export function exportScriptForEntity(entity) {
	const file = `export/${entity.name.replace('.', path.sep)}.csv`
	return `\\copy (select * from ${entity.name}) to '${file}' with delimiter ',' csv header;`
}
