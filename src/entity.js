import fs from 'fs'
import path from 'path'
import csv from 'csvtojson'
import { omit } from 'ramda'

import {
	typesWithoutSchema,
	typesWithSchema,
	allowedTypes,
	defaultExportOptions,
	defaultImportOptions
} from './constants.js'

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
 * Adds default options and overrides them if item is an object
 *
 * @param {(string|Object)} item
 * @param {Object} defaultOptions
 * @returns
 */
function getEntityWithConfig(item, defaultOptions) {
	let name = item
	let opts = defaultOptions

	if (typeof item === 'object') {
		name = Object.keys(item)[0]
		opts = omit(['name'], { ...opts, ...item[name] })
	}

	return { name, ...opts }
}

/**
 * Converts input into an export Entity
 *
 * @param {(string|Object)} item
 * @returns
 */
export function entityFromExportConfig(item) {
	const entity = getEntityWithConfig(item, defaultExportOptions)
	return {
		type: 'export',
		...entity
	}
}

/**
 * Converts input into an import Entity
 *
 * @param {(string|Object)} item
 * @returns
 */
export function entityFromImportConfig(item, opts = defaultImportOptions) {
	let entity = getEntityWithConfig(item, { ...defaultImportOptions, ...opts })

	return {
		type: 'import',
		...entity,
		schema: entity.name.split('.')[0]
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
		return getRoleScript(entity)
	}
}

/**
 * Generate the creation of script for role entity
 *
 * @param {Object} entity
 * @returns
 */
function getRoleScript(entity) {
	const grants = entity.refers
		.map((name) => `grant ${name} to ${entity.name};`)
		.join('\n')

	const lines = [
		'DO',
		'$do$',
		'BEGIN',
		'   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles',
		`                   WHERE rolname = '${entity.name}') THEN`,
		`      CREATE ROLE ${entity.name};`,
		'   END IF;',
		'END',
		'$do$;',
		grants
	]
	return lines.join('\n')
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
	ddl = ddl && entity.type !== 'import'

	if (!allowedTypes.includes(entity.type)) {
		errors.push('Unknown or unsupported entity type.')
		if (entity.file) errors.push('Unknown or unsupported entity ddl script.')
	}

	if (typesWithoutSchema.includes(entity.type) && entity.file) {
		errors.push(`"${entity.type}" does not need a ddl file.`)
	}

	if (typesWithSchema.includes(entity.type)) {
		if (entity.name.split('.').length != 2) {
			errors.push('Use fully qualified name <schema>.<name>')
		}
		if (!entity.file) {
			errors.push('File missing for entity')
		}
	}

	if (entity.file) {
		errors = [...errors, ...validateFiles(entity, ddl)]
	}

	return errors.length > 0 ? { ...entity, errors } : entity
}

/**
 * Validate file for the entity.
 *
 * @param {Object} entity
 * @param {boolean} ddl
 * @returns
 */
function validateFiles(entity, ddl) {
	let errors = []

	if (!fs.existsSync(entity.file)) {
		errors.push('File does not exist')
	}
	if (ddl && path.extname(entity.file) !== '.ddl') {
		errors.push('Unsupported file type for ddl')
	}
	if (!ddl && !['.csv', '.json'].includes(path.extname(entity.file))) {
		errors.push('Unsupported data format')
	}

	return errors
}

export function importScriptForEntity(entity) {
	let commands = []
	if (entity.truncate) {
		commands.push(`truncate table ${entity.name};`)
	}
	console.log(entity.name, entity.nullValue)
	commands.push(
		`\\copy ${entity.name} from '${entity.file}' with delimiter ',' NULL as '${entity.nullValue}' csv header;`
	)
	return commands.join('\n')
}

export function exportScriptForEntity(entity) {
	const file = `export/${entity.name.replace('.', path.sep)}.csv`
	return `\\copy (select * from ${entity.name}) to '${file}' with delimiter ',' csv header;`
}

export function entitiesForDBML(entities, config) {
	const { include, exclude } = { exclude: {}, include: {}, ...config }

	const result = entities
		.filter((entity) => entity.type === 'table')
		.filter(
			(entity) => !include.schemas || include.schemas.includes(entity.schema)
		)
		.filter((entity) => !include.tables || include.tables.includes(entity.name))
		.filter(
			(entity) => !exclude.schemas || !exclude.schemas.includes(entity.schema)
		)
		.filter(
			(entity) => !exclude.tables || !exclude.tables.includes(entity.name)
		)
	return result
}
