import { internalKeywords, excludePatterns } from './constants.js'
import fs from 'fs'
import { pick, uniq } from 'ramda'

const TYPES_GROUP = '(?<type>procedure|function|view|table)'
const SCHEMA_GROUP = '((?<schema>[a-zA-Z_][a-zA-Z0-9_]*)?\\.)?'
const ENTITY_GROUP = '(?<name>[a-zA-Z_][a-zA-Z0-9_]*)'
const TABLE_ALIAS_PATTERN = '(\\s+(as\\s+)?(?<alias>[a-zA-Z_][a-zA-Z0-9_]*))?$'

const CREATE_ENTITY_PATTERN =
	'create\\s+(or\\s+replace\\s*)?' +
	TYPES_GROUP +
	'\\s+(if\\s+not\\s+exists\\s+)?' +
	SCHEMA_GROUP +
	ENTITY_GROUP
const FUNCTION_CALL_PATTERN =
	'\\b(?<prefix>.*?)' + SCHEMA_GROUP + ENTITY_GROUP + '\\s*\\('
const TABLE_REF_PATTERN =
	'\\b(?<prefix>from|join|inner|cross|outer)\\s+' +
	SCHEMA_GROUP +
	ENTITY_GROUP +
	TABLE_ALIAS_PATTERN

const PATTERNS = {
	ALIAS_TYPE: /(\s+as\s+)$/i,
	TABLE_TYPE: /\b(from|join|update|into|on|references)\s$/i,
	ENTITY_TYPE: /\bcreate.*(procedure|function|view|table)\s/i
}

export function extractReferences(sqlScript) {
	// Matches function calls with optional schema prefixes
	const pattern = new RegExp(FUNCTION_CALL_PATTERN, 'gim')
	let functionCalls = {}
	let match
	while ((match = pattern.exec(sqlScript)) !== null) {
		// console.log(match.groups)
		const { prefix, schema, name } = match.groups
		const type = extractEntityType(prefix)
		const fullName = schema ? schema + '.' + name : name
		if (!isInternal(fullName)) functionCalls[fullName] = type
	}
	return Object.entries(functionCalls).map(([name, type]) => ({ name, type }))
}

export function extractEntityType(input) {
	let match = PATTERNS.ENTITY_TYPE.exec(input)
	if (match) return match[1]

	// pattern
	match = PATTERNS.TABLE_TYPE.exec(input)
	if (match) return 'table'
	match = PATTERNS.ALIAS_TYPE.exec(input)
	if (match) return 'alias'
	return null
}

export function extractSearchPaths(content, defaultPath = 'public') {
	const matches = content.match(/SET\s+search_path\s*to\s*([a-z0-9_]+,?)+.*/gi)
	if (matches) {
		return matches[matches.length - 1]
			.split('to')[1]
			.replaceAll(';', '')
			.split(',')
			.map((p) => p.trim())
	}
	return [defaultPath]
}

export function extractTableReferences(sqlScript) {
	const pattern = new RegExp(TABLE_REF_PATTERN, 'gim')
	let tableReferences = new Set()
	let match

	while ((match = pattern.exec(sqlScript)) !== null) {
		// console.log(match.groups)
		const { schema, name } = match.groups
		const fullName = schema ? schema + '.' + name : name
		tableReferences.add(fullName)
	}

	return Array.from(tableReferences)
		.filter((name) => !isInternal(name))
		.map((name) => ({ name, type: 'table' }))
}

function isInternal(word) {
	let internal = internalKeywords.has(word.toLowerCase())
	for (let i = 0; i < excludePatterns.length && !internal; i++) {
		internal = excludePatterns[i].test(word)
	}

	return internal
}

export function extractEntity(script) {
	const pattern = new RegExp(CREATE_ENTITY_PATTERN, 'gim')
	const match = pattern.exec(script)
	return pick(['type', 'schema', 'name'], match?.groups ?? {})
}

export function parseEntityScript(entity) {
	const content = fs.readFileSync(entity.file, 'utf-8')
	const searchPaths = extractSearchPaths(content)
	let info = extractEntity(content)

	// return info
	let references = uniq([
		...extractReferences(content),
		...extractTableReferences(content)
	])
	let errors = []
	if (!info.schema) info.schema = searchPaths[0]
	let fullName = info.schema + '.' + info.name

	if (info.schema !== entity.schema)
		errors.push('Schema in script does not match file path')
	if (info.type !== entity.type)
		errors.push('Entity type in script does not match file path')
	if (fullName !== entity.name)
		errors.push('Entity name in script does not match file name')

	const excludeEntity = [info.name, fullName]
	info.name = fullName
	references = references
		.filter(({ type }) => type !== 'alias')
		.filter(({ name }) => !excludeEntity.includes(name))
	return { ...entity, ...info, searchPaths, references, errors }
}

export function generateLookupTree(entities) {
	let tree = entities.reduce((cur, { type }) => ({ ...cur, [type]: {} }), {})
	entities.map(({ name, type, schema }) => {
		tree[type][schema] = {
			...tree[type][schema],
			[name.split('.').pop()]: name
		}
	})
	return tree
}

export function matchReferences(entities) {
	const lookupTree = generateLookupTree(entities)
	return entities.map((entity) => {
		let references = entity.references.map((ref) => {
			let { name, type } = ref
			if (type === null) {
				const types = Object.keys(lookupTree)
				let errors = []
				for (let i = 0; i < types.length; i++) {
					let result = findEntityByName(
						name,
						entity.searchPaths,
						lookupTree[types[i]]
					)
					if (result.error) {
						errors.push(result.error + ' in ' + types[i])
					} else return { ...result, type: types[i] }
				}
				return { ...ref, errors }
			} else {
				let result = findEntityByName(
					name,
					entity.searchPaths,
					lookupTree[type]
				)
				if (result.error) {
					return { ...result, type, errors: [result.error + ' in ' + type] }
				}
				return { ...result, type }
			}
		})

		return {
			...entity,
			references,
			refers: references.filter((r) => !r.errors).map((r) => r.name)
		}
	})
}

export function findEntityByName(fullName, searchPaths, lookup) {
	let schema = null
	let name = fullName
	if (fullName.indexOf('.') > -1) {
		;[schema, name] = fullName.split('.')
	}
	if (schema) return { name: lookup[schema][name], schema }

	for (let i = 0; i < searchPaths.length; i++) {
		if (lookup[searchPaths[i]]) {
			let entity = lookup[searchPaths[i]][name]
			if (entity) return { name: entity, schema: searchPaths[i] }
		}
	}
	return {
		name: fullName,
		schema: null,
		error: 'was not found in [' + searchPaths.join(', ') + ']'
	}
}
