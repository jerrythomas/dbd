import path from 'path'

const typesWithoutSchema = ['role', 'schema']
const defaultExportOptions = { format: 'csv' }

/**
 * Converts a file path into an Entity object
 *
 * @param {string} filepath
 * @returns an object containing entity details
 */
function fromFile(file) {
	let parts = file.replace(path.extname(file), '').split(path.sep)

	const type = parts[0] === 'ddl' ? parts[1] : parts[0]
	let name = typesWithoutSchema.includes(type)
		? parts[parts.length - 1]
		: parts.slice(parts.length - 2).join('.')

	return { type, name, file }
}

function fromExportConfig(item) {
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

function fromExtensionConfig(item) {
	let schema = 'public'
	let name = item

	if (typeof item === 'object') {
		name = Object.keys(item)[0]
		schema = item[name].schema
	}
	return { type: 'extension', name, schema }
}

function fromSchemaName(name) {
	return { type: 'schema', name }
}

function fromRoleName(name) {
	return { type: 'role', name }
}

export const entity = {
	fromFile,
	fromRoleName,
	fromSchemaName,
	fromExportConfig,
	fromExtensionConfig
}
