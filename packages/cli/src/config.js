/**
 * Configuration loading and entity discovery.
 *
 * Extracted from src/metadata.js + src/filler.js.
 * Uses @jerrythomas/dbd-db for entity processing and dependency resolution.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname } from 'path'
import { load } from 'js-yaml'
import {
	entityFromFile,
	entityFromImportConfig,
	defaultImportOptions,
	allowedTypes
} from '@jerrythomas/dbd-db'

const ENV_ALIASES = {
	prod: 'prod',
	production: 'prod',
	dev: 'dev',
	development: 'dev'
}

/**
 * Normalizes environment string to 'dev' or 'prod'.
 * Returns 'prod' for null/undefined. Throws for unrecognized values.
 *
 * @param {string|null|undefined} value
 * @returns {'dev'|'prod'}
 */
export function normalizeEnv(value) {
	if (value == null) return 'prod'
	const normalized = ENV_ALIASES[value]
	if (!normalized) throw new Error(`Unknown environment: "${value}". Use dev, development, prod, or production.`)
	return normalized
}

/**
 * Scans a folder recursively and returns a list of file paths.
 *
 * @param {string} root - folder to scan
 * @returns {string[]}
 */
export function scan(root = '.') {
	const files = readdirSync(root)
	let result = []

	files.map((file) => {
		const filepath = join(root, file)

		if (statSync(filepath).isDirectory()) {
			result = [...result, ...scan(filepath)]
		} else {
			result.push(filepath)
		}
	})

	return result
}

/**
 * Reads and parses a design.yaml configuration file.
 *
 * @param {string} file - path to YAML config
 * @returns {Object}
 */
export function read(file) {
	let data = load(readFileSync(file, 'utf8'))

	data = fillMissingInfoForEntities(data)
	data.schemas = data.schemas || []

	data.entities = [...data.tables, ...data.views, ...data.functions, ...data.procedures]
	data.project = { staging: [], ...data.project }

	return data
}

/**
 * Sets default values for entity types in config data.
 *
 * @param {Object} data - parsed YAML config
 * @returns {Object}
 */
export function fillMissingInfoForEntities(data) {
	const types = ['role', 'table', 'view', 'function', 'procedure']

	types.map((type) => {
		const key = `${type}s`
		if (key in data) {
			data[key] = data[key].map((item) => ({ refers: [], ...item, type }))
		} else {
			data[key] = []
		}
	})
	return data
}

/**
 * Discovers DDL entities from file system and combines with config.
 * Scans ddl/ folder, parses entity scripts, resolves references.
 *
 * @param {Object} data - config from read()
 * @param {Function} parseEntityScript - reference extraction function
 * @param {Function} matchReferences - reference resolution function
 * @returns {Object}
 */
export function clean(data, parseEntityScript, matchReferences) {
	let importTables = cleanImportTables(data)
	let entities = cleanDDLEntities(data, parseEntityScript, matchReferences)

	let roles = [...data.roles, ...entities.filter((entity) => entity.type === 'role')]

	entities = entities.filter((entity) => entity.type !== 'role')
	let schemas = [
		...new Set([
			...data.schemas,
			...entities
				.filter((entity) => allowedTypes.includes(entity.type))
				.map((entity) => entity.name.split('.')[0])
		])
	]

	data = { ...data, roles, schemas, entities, importTables }

	return data
}

/**
 * Scan ddl folder and combine with configuration.
 *
 * @param {Object} data
 * @param {Function} parseEntityScript
 * @param {Function} matchReferences
 * @returns {Array}
 */
export function cleanDDLEntities(data, parseEntityScript, matchReferences) {
	let entities = scan('ddl')
		.filter((file) => ['.ddl', '.sql'].includes(extname(file)))
		.map((file) => entityFromFile(file))
		.map(parseEntityScript)

	entities = matchReferences(entities, data.extensions ?? [])

	return merge(entities, data.entities)
}

/**
 * Scan import folder and combine with configuration.
 *
 * @param {Object} data
 * @returns {Array}
 */
function cleanImportTables(data) {
	const options = { ...defaultImportOptions, ...data.import.options }
	const tables = data.import.tables ?? []
	const schemaOptions = data.import.schemas ?? {}
	let importTables = scan('import')
		.filter((file) => ['.jsonl', '.csv', '.tsv'].includes(extname(file)))
		.map((file) => ({ ...options, ...entityFromFile(file) }))
		.map((table) => ({ ...table, ...schemaOptions[table.schema] }))

	if (tables.length === 0) return importTables

	importTables = merge(
		importTables,
		tables.map((table) => entityFromImportConfig(table, options))
	)
	return importTables
}

/**
 * Merge two arrays of objects by name.
 * y values override x values for matching names.
 *
 * @param {Array} x
 * @param {Array} y
 * @returns {Array}
 */
export function merge(x, y) {
	let xAsObj = x.reduce((obj, item) => ((obj[item.name] = item), obj), {})
	let yAsObj = y.reduce((obj, item) => ((obj[item.name] = item), obj), {})

	Object.keys(xAsObj).forEach((key) => {
		if (key in yAsObj) {
			yAsObj[key] = { ...xAsObj[key], ...yAsObj[key] }
		} else {
			yAsObj[key] = xAsObj[key]
		}
	})
	return Object.keys(yAsObj).map((key) => yAsObj[key])
}
