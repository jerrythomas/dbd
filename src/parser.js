import fs from 'fs'
import { pick, uniq } from 'ramda'
import { allowedTypes } from './constants.js'
import { isInternal } from './exclusions.js'

const TYPES_GROUP = '(?<type>procedure|function|view|table)'
const SCHEMA_GROUP = '((?<schema>[a-zA-Z_][a-zA-Z0-9_]*)?\\.)?'
const ENTITY_GROUP = '(?<name>[a-zA-Z_][a-zA-Z0-9_]*)'
const TABLE_ALIAS_PATTERN = '(\\s*;?|(\\s+((as\\s+)?(?<alias>[a-zA-Z_][a-zA-Z0-9_]*))?))$'

const CREATE_ENTITY_PATTERN =
	'create\\s+(or\\s+replace\\s+)?' +
	TYPES_GROUP +
	'\\s*(if\\s+not\\s+exists\\s+)?' +
	SCHEMA_GROUP +
	ENTITY_GROUP
const FUNCTION_CALL_PATTERN = '\\b(?<prefix>.*?)' + SCHEMA_GROUP + ENTITY_GROUP + '\\s*\\('
const TABLE_REF_PATTERN =
	'\\b(?<prefix>from|join|inner|cross|outer)\\s+' +
	SCHEMA_GROUP +
	ENTITY_GROUP +
	TABLE_ALIAS_PATTERN

const PATTERNS = {
	ALIAS_TYPE: /(\s+(as|recursive)\s+)$/i,
	TABLE_TYPE: /\b(from|join|update|into|on|references)\s$/i,
	ENTITY_TYPE: /\bcreate.*(procedure|function|view|table)\s/i,
	INDEX_TYPE: /\b(key|index)\s*$/i
}

/**
 * Extracts function call references from an SQL script.
 * @param {string} sqlScript - The SQL script.
 * @returns {Array} An array of references with their types.
 */
export function extractReferences(sqlScript) {
	// Matches function calls with optional schema prefixes
	const pattern = new RegExp(FUNCTION_CALL_PATTERN, 'gim')
	let functionCalls = {}
	let match = {}
	while ((match = pattern.exec(sqlScript)) !== null) {
		const { prefix, schema, name } = match.groups
		const type = extractEntityType(prefix)
		const fullName = schema ? schema + '.' + name : name
		if (!isInternal(fullName)) functionCalls[fullName] = type
	}

	return Object.entries(functionCalls)
		.map(([name, type]) => ({ name, type }))
		.filter((x) => x.type !== 'index')
}

/**
 * Extracts the entity type from an input string.
 * @param {string} input - The input string.
 * @returns {string|null} The entity type or null if not found.
 */
export function extractEntityType(input) {
	let match = PATTERNS.ENTITY_TYPE.exec(input)
	if (match) return match[1]

	match = PATTERNS.TABLE_TYPE.exec(input)
	if (match) return 'table/view'
	match = PATTERNS.ALIAS_TYPE.exec(input)
	if (match) return 'alias'
	match = PATTERNS.INDEX_TYPE.exec(input)
	if (match) return 'index'

	return null
}

/**
 * Extracts the search paths from content.
 * @param {string} content - The content.
 * @param {string} [defaultPath='public'] - The default path.
 * @returns {Array<string>} An array of search paths.
 */
export function extractSearchPaths(content, defaultPath = 'public') {
	const matches = content.match(/SET\s+search_path\s*to\s*([a-z0-9_]+(,\s*)?)+;/gi)
	if (matches) {
		return matches[matches.length - 1]
			.split('to ')[1]
			.replaceAll(';', '')
			.split(',')
			.map((p) => p.trim())
	}
	return [defaultPath]
}

/**
 * Extracts WITH aliases from an SQL script.
 * @param {string} sqlScript - The SQL script.
 * @returns {Array<string>} An array of aliases.
 */
export function extractWithAliases(sqlScript) {
	const pattern = new RegExp(`with\\s*(recursive)\\s+${ENTITY_GROUP}\\s+as`, 'gim')
	let aliases = new Set([])
	let match = {}
	while ((match = pattern.exec(sqlScript)) !== null) {
		const { name } = match.groups
		aliases.add(name)
	}
	return Array.from(aliases)
}

/**
 * Extracts table references from an SQL script.
 * @param {string} sqlScript - The SQL script.
 * @returns {Array} An array of table references with their types.
 */
export function extractTableReferences(sqlScript) {
	const pattern = new RegExp(TABLE_REF_PATTERN, 'gim')
	let tableReferences = new Set()
	let match = {}
	let aliases = extractWithAliases(sqlScript)

	while ((match = pattern.exec(sqlScript)) !== null) {
		const { schema, name } = match.groups
		if (!aliases.includes(name)) {
			const fullName = schema ? schema + '.' + name : name
			tableReferences.add(fullName)
		}
	}

	return Array.from(tableReferences)
		.filter((name) => !isInternal(name))
		.map((name) => ({ name, type: 'table/view' }))
}

/**
 * Extracts the entity information from a script.
 * @param {string} script - The script content.
 * @returns {Object} The extracted entity information.
 */
export function extractEntity(script) {
	const pattern = new RegExp(CREATE_ENTITY_PATTERN, 'gim')
	const match = pattern.exec(script)
	const { type, name, schema } = pick(['type', 'schema', 'name'], match?.groups ?? {})
	return { type: type?.toLowerCase(), name, schema }
}

/**
 * Parses an entity script and extracts relevant information.
 * @param {Object} entity - The entity object.
 * @returns {Object} The parsed entity information.
 */
export function parseEntityScript(entity) {
	const content = fs.readFileSync(entity.file, 'utf-8')
	const searchPaths = extractSearchPaths(content)
	let info = extractEntity(content)

	let references = uniq([...extractReferences(content), ...extractTableReferences(content)])

	let errors = []
	if (!info.name)
		return {
			...entity,
			references: [],
			errors: ['Entity name not found in script']
		}
	if (!info.schema) info.schema = searchPaths[0]
	let fullName = info.schema + '.' + info.name

	if (info.schema !== entity.schema) errors.push('Schema in script does not match file path')
	if (info.type !== entity.type) errors.push('Entity type in script does not match file path')
	if (fullName !== entity.name) errors.push('Entity name in script does not match file name')

	const excludeEntity = [info.name, fullName]
	info.name = fullName
	references = references
		.filter(({ type }) => type !== 'alias')
		.filter(({ name }) => !excludeEntity.includes(name))
	return { ...entity, ...info, searchPaths, references, errors }
}

/**
 * Generate a lookup tree for the given entities
 * @param {Array} entities - An array of entities
 * @returns {Object} A lookup tree
 */
export function generateLookupTree(entities) {
	return entities.reduce(
		(cur, entity) => ({
			...cur,
			[entity.name]: pick(['name', 'schema', 'type'], entity)
		}),
		{}
	)
}

/**
 * Match and resolve references for given entities.
 * @param {Array} entities - An array of entities.
 * @param {Array} [extensions=[]] - An array of extensions.
 * @returns {Array} The entities with matched references.
 */
export function matchReferences(entities, extensions = []) {
	const lookup = generateLookupTree(entities)

	return entities.map((entity) => {
		let references = entity.references.map((ref) =>
			findEntityByName(ref, entity.searchPaths, lookup, extensions)
		)
		return {
			...entity,
			references,
			refers: references
				.filter((r) => !r.error)
				.filter((r) => r.type !== 'extension')
				.filter((r) => allowedTypes.includes(r.type))
				.map((r) => r.name)
		}
	})
}

/**
 * Find an entity by name within search paths and lookup.
 * @param {Object} ref - The reference object containing name and type.
 * @param {Array} searchPaths - An array of search paths.
 * @param {Object} lookup - The lookup object.
 * @param {Array} [extensions=[]] - An array of extensions.
 * @returns {Object} The matched entity or an error object if not found.
 */
export function findEntityByName({ name, type }, searchPaths, lookup, extensions = []) {
	let matched = null
	let internalType = isInternal(name, extensions)
	if (internalType) return { name, type: internalType }

	if (name.indexOf('.') > 0) {
		internalType = isInternal(name.split('.').pop(), extensions)
		if (internalType) return { name, type: internalType }

		matched = lookup[name]
		return matched ? matched : { name, type, error: `Reference ${name} not found` }
	}

	for (let i = 0; i < searchPaths.length && !matched; i++) {
		matched = lookup[searchPaths[i] + '.' + name]
	}
	return matched
		? matched
		: {
				name,
				type,
				error: `Reference ${name} not found in [${searchPaths.join(', ')}]`
			}
}
