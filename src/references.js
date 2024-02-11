import { entityFromFile } from './entity'
import { scan } from './metadata'
import path from 'path'
import fs from 'fs'
import { uniq } from 'ramda'

export function cleanDDLEntities() {
	let entities = scan('ddl')
		.filter((file) => ['.ddl', '.sql'].includes(path.extname(file)))
		.map((file) => entityFromFile(file))
		.map((entity) => ({ ...entity, refers: [] }))

	return entities
}

export function getSearchPaths(content) {
	const matches = content.match(/SET\s+search_path\s*to\s*([a-z0-9_]+,?)+.*/gi)
	if (matches) {
		return matches[matches.length - 1]
			.split('to')[1]
			.replaceAll(';', '')
			.split(',')
			.map((p) => p.trim())
	}
	return ['public']
}

export function parseFile(entity) {
	let [schema, name] = entity.name.split('.')
	const content = fs.readFileSync(entity.file, 'utf8')
	const searchPaths = getSearchPaths(content)
	if (schema !== schemaPaths[0]) {
		schema = schemaPaths[0]
		name = `${schema}.${name}`
	}
	return { ...entity, name, schema, searchPaths }
}

export function getTableName(entity, content) {
	const matches = content.match(/CREATE\s+TABLE\s+([a-z0-9_]+).*/gi)
	let name = entity.name
	if (matches) {
		let lastPart = matches[0].split(' ').pop()
		if (lastPart.indexOf('.') > 0) {
			if (entity.name !== lastPart) name = lastPart
		} else {
			name = `${entity.schema}.${lastPart}`
		}
	}
	return { ...entity, name }
}

export function getTableReferences(content) {
	const matches = content.match(/REFERENCES\s+([a-z0-9_]+).*/gi)
	if (matches) {
		return uniq(
			matches
				.map((m) => m.split(' ').pop())
				.map((r) => r.replace(/\(.*\);?/, ''))
		)
	}
	return []
}

export function getLookupTree(entities) {
	let tree = entities.reduce((cur, { type }) => ({ ...cur, [type]: {} }), {})
	entities.map(({ name, type, schema }) => {
		// if (!tree[type].hasOwnProperty(schema)) {
		// 	tree[type] = { ...tree[type], [schema]: {} }
		// }
		tree[type][schema] = {
			...tree[type][schema],
			[name.split('.').pop()]: name
		}
	})
	return tree
}
