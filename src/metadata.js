import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname } from 'path'
import { load } from 'js-yaml'
import { cwd } from 'process'
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
	let importTables = scan('import')
		.filter((file) => ['.jsonl', '.csv'].includes(extname(file)))
		.map((file) => ({ ...entityFromFile(file), ...defaultImportOptions }))

	importTables = merge(
		importTables,
		data.import.tables.map((table) => entityFromImportConfig(table, data.import.options))
	)
	return importTables
}

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

	return [].concat.apply([], regroup(lookup)).map((x) => lookup[x])
}

export function regroup(lookup) {
	let nextGroup
	let groups = [Object.keys(lookup)]

	do {
		let thisGroup = groups.pop()
		nextGroup = thisGroup.filter((k) => lookup[k].refers.some((x) => thisGroup.includes(x)))
		thisGroup = thisGroup.filter((k) => !nextGroup.includes(k))
		groups.push(thisGroup)
		if (nextGroup.length > 0) groups.push(nextGroup)
	} while (nextGroup.length > 0)

	return groups.map((items) => items.sort())
}
