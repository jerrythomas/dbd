import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname } from 'path'
import { load } from 'js-yaml'
import { allowedTypes } from './constants.js'
import { entityFromFile, entityFromImportConfig } from './entity.js'
import { fillMissingInfoForEntities } from './filler.js'
import { defaultImportOptions } from './constants.js'
import { parseEntityScript, matchReferences } from './parser.js'

/**
 * Scans a folder and returns a list of file paths
 *
 * @param {string} root     folder to be scanned
 * @returns {Array<string>} Array of file paths
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
 * Reads configuration file
 *
 * @param {path} file
 * @returns
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
 *
 * @param {*} data
 * @returns
 */
export function clean(data) {
	let importTables = cleanImportTables(data)
	let entities = cleanDDLEntities(data)

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
 * Scan ddl folder and combine with configuration
 *
 * @param {Object} data
 * @returns
 */
export function cleanDDLEntities(data) {
	// const ignore = data.ignore ?? []
	let entities = scan('ddl')
		.filter((file) => ['.ddl', '.sql'].includes(extname(file)))
		.map((file) => entityFromFile(file))
		.map(parseEntityScript)

	entities = matchReferences(entities, data.extensions ?? [])

	return merge(entities, data.entities)
}

/**
 * Scan import folder and combine with configuration
 *
 * @param {Object} data
 * @returns
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
 * Merge two arrays of objects
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

/**
 * Organize entities into groups
 *
 * @param {Array} data
 * @returns {Array}
 */
export function organize(data) {
	let lookup = data.reduce((obj, item) => ({ ...obj, [item.name]: item }), {})

	let missing = [].concat
		.apply(
			[],
			data.map(({ refers }) => refers)
		)
		.filter((entity) => !(entity in lookup))
		.reduce((obj, entity) => ({ ...obj, [entity]: { name: entity, refers: [] } }), {})

	lookup = { ...lookup, ...missing }

	const result = regroup(lookup)
	const organized = result.groups
		.flatMap((items) => items.map((name) => lookup[name]))
		.map((entity) => ({
			...entity,
			errors: result.errors.includes(entity.name) ? ['Cyclic dependency found'] : []
		}))
	return organized
}

/**
 * Regroup entities based on references
 */
export function regroup(lookup) {
	let groups = [Object.keys(lookup)]
	let errors = []
	let length = groups.length

	do {
		length = groups.length
		let thisGroup = groups.pop()

		const nextGroup = thisGroup.filter((k) => lookup[k].refers.some((x) => thisGroup.includes(x)))
		thisGroup = thisGroup.filter((k) => !nextGroup.includes(k))

		if (thisGroup.length > 0) groups.push(thisGroup)
		if (nextGroup.length > 0) groups.push(nextGroup)
		if (groups.length === length) errors = [...nextGroup]
	} while (groups.length > length)

	return { groups: groups.map((items) => items.sort()), errors }
}
