import fs from 'fs'
import path from 'path'
import csv from 'csvtojson'

const typesWithoutSchema = ['role', 'schema']
const defaultExportOptions = { format: 'csv' }

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
		opts = item[entity]
	}
	return {
		type: 'export',
		name: entity,
		...opts
	}
}

/**
 * Converts input into an extension Entity
 *
 * @param {(string|Object)} item
 * @returns {Entity}
 */
export function entityFromExtensionConfig(item) {
	let schema = 'public'
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
		// if (path.extname(entity.file) === '.ddl')
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
		return `create role if not exists ${entity.name}`
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
	if (entity.file) {
		if (path.extname(entity.file) === '.csv') {
			data = await csv().fromFile(entity.file)
		}
		if (path.extname(entity.file) === '.json') {
			data = JSON.parse(fs.readFileSync(entity.file, 'utf8'))
		}
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

	if (!['role', 'schema', 'extension'].includes(entity.type)) {
		if (!entity.file) {
			errors.push('File missing for entity')
		} else if (ddl && path.extname(entity.file) !== '.ddl') {
			errors.push('Unsupported file type for ddl')
		} else if (!ddl && ['.csv', '.json'].includes(path.extname(entity.file))) {
			errors.push('Unsupported data format')
		}
	}
	return errors ? { ...entity, errors } : entity
}
