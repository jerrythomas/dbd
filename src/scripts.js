import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

export const dbtypes = {
	table: 1,
	index: 2,
	function: 3,
	view: 4,
	procedure: 5,
	synonym: 6,
	grant: 7
}

function getSortOrder(type) {
	return type in dbtypes ? dbtypes[type] : 99
}

export function getAllFiles(dirPath, arrayOfFiles, includeRegex = includeAll) {
	let files = fs.readdirSync(dirPath)

	arrayOfFiles = arrayOfFiles || []

	files.forEach(function (file) {
		let full_path = path.join(dirPath, file)

		if (fs.statSync(full_path).isDirectory()) {
			arrayOfFiles = getAllFiles(full_path, arrayOfFiles, includeRegex)
		} else if (file.match(includeRegex)) arrayOfFiles.push(full_path)
	})

	return arrayOfFiles
}

/**
 * @typedef {Object} DatabaseConfig
 * @property {array} extensions
 * @property {array} schemas
 * @property {Object} dbdocs
 * @property {array} dependencies
 * @property {array} seed
 * @property {array} staging
 * @property {array} groups
 * @property {array} scripts
 */
/**
 *
 * @param {*} file
 * @returns {DatabaseConfig}
 */
export function readConfig(file) {
	if (fs.existsSync(file) && fs.statSync(file).isFile()) {
		return yaml.load(fs.readFileSync(file, 'utf8'))
	} else {
		throw new Error("Couldn't find config file")
	}
}

export function getScripts() {
	const files = getAllFiles('./ddl', [], '.*.ddl$')

	let scripts = [] //{ ddl: [] }
	files.map((file) => {
		// let group = 'ddl'

		let parts = file.split(path.sep)
		if (parts.length === 4) {
			// 	group = parts[0]
			parts = parts.slice(1)
		}

		const type = parts[0]
		const schema = parts[1]
		const name = schema + '.' + parts[2].split('.')[0]

		// if (!(group in scripts)) {
		// 	scripts[group] = []
		// }
		scripts.push({
			type,
			file,
			schema,
			name
		})
	})

	return scripts
}

export function getSchemas(config, scripts) {
	let schemas = config.schemas || []

	scripts.map(({ schema }) => {
		schemas = [...schemas, schema]
	})

	return [...new Set(schemas)]
}

export function sortGroups(groups) {
	let sorted = groups
		.map((group) => Object.values(group))
		.map((group) =>
			group.sort((a, b) => getSortOrder(a.type) - getSortOrder(b.type))
		)

	return sorted
}

export function regroup(groups, refs) {
	let next = {}
	do {
		let current = groups[groups.length - 1]
		next = {}
		Object.keys(current).map((key) => {
			// console.log(`${key} ${groups.length - 1}`)
			if (key in refs) {
				const hasRefsInGroup = refs[key].refers.some((item) => item in current)
				if (hasRefsInGroup) {
					next[key] = current[key]
					// console.log(`Moving key ${key}`)
				}
			}
		})

		for (const key in next) {
			delete current[key]
		}

		if (Object.keys(next).length > 0) {
			groups.push(next)
		}
	} while (Object.keys(next).length > 0)

	// console.log(groups.length)
	return groups
}

export function writeScript(file, data) {
	let lines = ''
	data.forEach((value) => (lines += value + '\r\n'))
	fs.writeFileSync(file, lines)
}
