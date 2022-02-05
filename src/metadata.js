import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { entity } from './entity.js'

/**
 * Scans a folder and returns a list of file paths
 *
 * @param {string} root     folder to be scanned
 * @returns {Array<string>} Array of file paths
 */
export function scan(root = '.') {
	const files = fs.readdirSync(root)
	let result = []

	files.map((file) => {
		const filepath = path.join(root, file)

		if (fs.statSync(filepath).isDirectory()) {
			result = [...result, ...scan(filepath)]
		} else {
			result.push(filepath)
		}
	})

	return result
}

export function read(file) {
	let data = yaml.load(fs.readFileSync(file, 'utf8'))
	data.roles = data.roles || []
	data.schemas = data.schemas || []

	return data
}

export function clean(data) {
	let entities = scan('ddl')
		.filter((file) => ['.ddl', '.sql'].includes(path.extname(file)))
		.map((file) => entity.fromFile(file))
		.map((entity) => ({ ...entity, refers: [] }))
	entities = merge(entities, data.entities)

	let roles = [
		...data.roles,
		...entities.filter((entity) => entity.type === 'role')
	]

	entities = entities.filter((entity) => entity.type !== 'role')

	let schemas = [
		...new Set([
			...data.schemas,
			...entities.map((entity) => entity.name.split('.')[0])
		])
	]

	data = { ...data, roles, schemas, entities }

	return data
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

// function importData(data) {
// 	let importFiles = scan('import')
// 		.filter((file) => ['.csv', '.json'].includes(path.extname(file)))
// 		.map((file) => entity.fromFile(file))

// 	// data.import
// }

// export function hierarchy(data) {
// 	let roles = data.filter((entity) => entity.type === 'role')
// 	let entities = data.filter((entity) => entity.type !== 'role')
// 	let schemas = entities.map((entity) => entity.name.split('.')[0])

// 	schemas = [...new Set(schemas)]
// 	// roles = roles.reduce((obj, item) => ((obj[item[key]] = item), obj), {})
// 	convert(roles)
// 	convert(entities)
// }

export function convert(data) {
	let lookup = data.reduce((obj, item) => ((obj[item.name] = item), obj), {})

	let missing = [].concat
		.apply(...data.map(({ refers }) => refers))
		.filter((entity) => !(entity in lookup))
		.reduce(
			(obj, entity) => ((obj[entity] = { name: entity, refers: [] }), obj),
			{}
		)

	lookup = { ...lookup, ...missing }
	return [].concat.apply([], regroup(lookup)).map((x) => lookup[x])
}

export function regroup(lookup) {
	let nextGroup
	let groups = [Object.keys(lookup)]

	do {
		let thisGroup = groups.pop()
		nextGroup = thisGroup.filter((k) =>
			lookup[k].refers.some((x) => thisGroup.includes(x))
		)
		thisGroup = thisGroup.filter((k) => !nextGroup.includes(k))
		groups.push(thisGroup)
		if (nextGroup.length > 0) groups.push(nextGroup)
	} while (nextGroup.length > 0)

	return groups
}
