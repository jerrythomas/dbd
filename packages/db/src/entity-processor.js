import { readFileSync, existsSync } from 'fs'
import { extname, sep } from 'path'

// --- Constants (copied from src/constants.js) ---

export const typesWithSchema = ['table', 'view', 'function', 'procedure', 'import']
export const typesWithoutSchema = ['role', 'schema', 'extension']
export const allowedTypes = [...typesWithSchema, ...typesWithoutSchema]
export const defaultExportOptions = { format: 'csv' }
export const defaultImportOptions = {
	format: 'csv',
	nullValue: '',
	truncate: true
}

// --- Entity factories ---

export function entityFromFile(file) {
	let parts = file.replace(extname(file), '').split(sep)
	if (parts[0] === 'ddl') {
		parts = parts.slice(1)
	}
	const type = parts[0]
	const noSchema = typesWithoutSchema.includes(type)

	if ((noSchema && parts.length !== 2) || (!noSchema && parts.length !== 3))
		return { type: null, name: null, file }
	const name = noSchema ? parts[parts.length - 1] : parts.slice(parts.length - 2).join('.')

	if (!noSchema) {
		return {
			type,
			name,
			file,
			schema: parts[parts.length - 2],
			format: extname(file).split('.').pop()
		}
	}

	return { type, name, file }
}

export function entityFromSchemaName(name) {
	return { type: 'schema', name }
}

export function entityFromRoleName(name) {
	return { type: 'role', name }
}

export function entityFromExtensionConfig(item, defaultSchema = 'public') {
	let schema = defaultSchema
	let name = item

	if (typeof item === 'object') {
		name = Object.keys(item)[0]
		schema = item[name].schema
	}
	return { type: 'extension', name, schema }
}

export function entityFromExportConfig(item) {
	const entity = getEntityWithConfig(item, defaultExportOptions)
	return { type: 'export', ...entity }
}

export function entityFromImportConfig(item, opts = defaultImportOptions) {
	const entity = getEntityWithConfig(item, { ...defaultImportOptions, ...opts })
	return {
		type: 'import',
		...entity,
		listed: true,
		schema: entity.name.split('.')[0]
	}
}

function getEntityWithConfig(item, defaultOptions) {
	let name = item
	let opts = defaultOptions

	if (typeof item === 'object') {
		name = Object.keys(item)[0]
		opts = { ...opts, ...item[name] }
	}

	return { name, ...opts }
}

// --- DDL generation ---

export function ddlFromEntity(entity) {
	if (entity.file) {
		return readFileSync(entity.file, 'utf8')
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
		return generateRoleScript(entity)
	}
	if (entity.type === 'external') {
		const cols = (entity.columns ?? []).map((col) => {
			const [[name, type]] = Object.entries(col)
			return `  ${name} ${type}`
		})
		return `CREATE TABLE ${entity.name} (\n${cols.join(',\n')}\n);`
	}
	return null
}

export function generateRoleScript(entity) {
	const grants = entity.refers.map((name) => `grant ${name} to ${entity.name};`).join('\n')

	const lines = [
		'DO',
		'$do$',
		'BEGIN',
		'   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles',
		`                   WHERE rolname = '${entity.name}') THEN`,
		`      CREATE ROLE ${entity.name};`,
		'   END IF;',
		'END',
		'$do$;',
		grants
	]
	return lines.join('\n')
}

export function combineEntityScripts(entities) {
	return entities
		.filter((entity) => !entity.errors || entity.errors.length === 0)
		.map((entity) => ddlFromEntity(entity))
		.join('\n')
}

// --- Import/export script generation ---

export function importScriptForEntity(entity) {
	let commands = []
	const delimiter = entity.format === 'csv' ? ',' : '\\t'

	if (entity.truncate) {
		commands.push(
			[
				'do $$',
				'begin',
				`  truncate table ${entity.name};`,
				'exception',
				'  when others then',
				`    delete from ${entity.name};`,
				'    commit;',
				'end $$;'
			].join('\n')
		)
	}
	if (['json', 'jsonl'].includes(entity.format)) {
		commands.push('create table if not exists _temp (data jsonb);')
		commands.push(`\\copy _temp from '${entity.file}';`)
		const schema = entity.schema ?? entity.name.split('.')[0]
		commands.push(`call ${schema}.import_jsonb_to_table('_temp', '${entity.name}');`)
		commands.push('drop table if exists _temp;')
	} else
		commands.push(
			`\\copy ${entity.name} from '${entity.file}' with delimiter E'${delimiter}' NULL as '${entity.nullValue}' csv header;`
		)
	return commands.join('\n')
}

export function exportScriptForEntity(entity) {
	const file = `export/${entity.name.replace('.', sep)}.` + (entity.format || 'csv')
	const delimiter = entity.format === 'csv' ? ',' : '\\t'
	if (['json', 'jsonl'].includes(entity.format)) {
		return `\\copy (select row_to_json(t) from ${entity.name} t) to '${file}';`
	}
	return `\\copy (select * from ${entity.name}) to '${file}' with delimiter E'${delimiter}' csv header;`
}

// --- DBML filtering ---

export function filterEntitiesForDBML(entities, config) {
	const { include, exclude } = { exclude: {}, include: {}, ...config }

	const tables = entities
		.filter((entity) => entity.type === 'table')
		.filter((entity) => !include.schemas || include.schemas.includes(entity.schema))
		.filter((entity) => !include.tables || include.tables.includes(entity.name))
		.filter((entity) => !exclude.schemas || !exclude.schemas.includes(entity.schema))
		.filter((entity) => !exclude.tables || !exclude.tables.includes(entity.name))

	// External entities (e.g. auth.users) are always included so FK references resolve in DBML
	const external = entities.filter((entity) => entity.type === 'external')

	return [...tables, ...external]
}

// --- Validation ---

function validateTypedSchema(entity) {
	const errors = []
	if (entity.name.split('.').length !== 2) errors.push('Use fully qualified name <schema>.<name>')
	if (!entity.file) errors.push('File missing for import entity')
	return errors
}

function validateEntityReferences(entity, ignore) {
	const errors = []
	if (!entity.references || entity.references.length === 0) return errors
	entity.references
		.filter((ref) => !ignore.includes(ref.name))
		.filter((ref) => ref.error)
		.forEach((ref) => errors.push(ref.error))
	return errors
}

export function validateEntity(entity, ddl = true, ignore = []) {
	let errors = []
	ddl = ddl && entity.type !== 'import'

	if (entity.name === null) errors.push('Location of the file is incorrect')

	if (!allowedTypes.includes(entity.type)) {
		errors.push('Unknown or unsupported entity type.')
		if (entity.file) errors.push('Unknown or unsupported entity ddl script.')
	}

	if (typesWithoutSchema.includes(entity.type) && entity.file) {
		errors.push(`"${entity.type}" does not need a ddl file.`)
	}

	if (typesWithSchema.includes(entity.type)) {
		errors = [...errors, ...validateTypedSchema(entity)]
	}

	errors = [...errors, ...validateEntityReferences(entity, ignore)]

	if (entity.file) errors = [...errors, ...validateFiles(entity, ddl)]

	return errors.length > 0 ? { ...entity, errors } : entity
}

function validateFiles(entity, ddl) {
	let errors = []

	if (!existsSync(entity.file)) {
		errors.push('File does not exist')
	}
	if (ddl && extname(entity.file) !== '.ddl') {
		errors.push('Unsupported file type for ddl')
	}
	if (!ddl && !['.tsv', '.csv', '.json', '.jsonl'].includes(extname(entity.file))) {
		errors.push('Unsupported data format')
	}

	return errors
}

export function getValidEntities(entities) {
	return entities.filter((entity) => !entity.errors || entity.errors.length === 0)
}

export function getInvalidEntities(entities) {
	return entities.filter((entity) => entity.errors && entity.errors.length > 0)
}

// --- Organization ---

export function organizeEntities(entities) {
	const groups = {}
	for (const entity of entities) {
		const type = entity.type || 'unknown'
		if (!groups[type]) groups[type] = []
		groups[type].push(entity)
	}
	return groups
}

// --- Import plan ---

/**
 * Find the target table for a staging import table by matching base name across schemas.
 * e.g. staging.lookups → config.lookups
 *
 * @param {{ name: string, schema: string }} importTable
 * @param {Array} entities
 * @returns {Object|null}
 */
export function findTargetTable(importTable, entities) {
	const baseName = importTable.name.split('.')[1]
	return (
		entities.find(
			(e) =>
				e.type === 'table' && e.name.split('.')[1] === baseName && e.schema !== importTable.schema
		) ?? null
	)
}

/**
 * Find the import procedure for a staging import table by naming convention.
 * e.g. staging.lookups → staging.import_lookups
 *
 * @param {{ name: string }} importTable
 * @param {Array} entities
 * @returns {Object|null}
 */
export function findImportProcedure(importTable, entities) {
	return (
		entities.find((e) => e.type === 'procedure' && (e.reads ?? []).includes(importTable.name)) ??
		null
	)
}

/**
 * Build an ordered import plan connecting each staging table to its target table
 * and import procedure. Order is determined by a topological sort that combines:
 *   1. Call graph: procedure A depends on procedure B if A reads a config table that B writes
 *   2. DDL dependency: target table position in the entity dependency graph (tiebreaker)
 *
 * @param {Array} importTables - staging import table entities
 * @param {Array} entities - all project entities (tables, procedures, etc.)
 * @returns {Array<{ table, targetTable, procedure, targets, warnings }>}
 */
export function buildImportPlan(importTables, entities) {
	const tables = entities.filter((e) => e.type === 'table')
	const stagingSchemas = [...new Set(importTables.map((t) => t.name.split('.')[0]))]

	const entries = importTables.map((table) => {
		const targetTable = findTargetTable(table, entities)
		const procedure = findImportProcedure(table, entities)
		const warnings = procedure ? [] : [`no import procedure for ${table.name}`]
		const targets = procedure
			? (procedure.writes ?? []).filter((name) => !stagingSchemas.includes(name.split('.')[0]))
			: []
		const order = targetTable ? tables.findIndex((t) => t.name === targetTable.name) : Infinity
		return { table, targetTable, procedure, targets, warnings, order }
	})

	// Build call graph: entry A depends on entry B if A reads a config table that B writes
	const writtenBy = new Map()
	entries.forEach((entry, i) => {
		for (const t of entry.targets) writtenBy.set(t, i)
	})

	const deps = entries.map((entry) => {
		const configReads = (entry.procedure?.reads ?? []).filter(
			(name) => !stagingSchemas.includes(name.split('.')[0])
		)
		return new Set(configReads.map((name) => writtenBy.get(name)).filter((j) => j !== undefined))
	})

	// Topological sort: at each step pick the ready entry with lowest DDL order
	const remaining = new Set(entries.map((_, i) => i))
	const sorted = []
	while (remaining.size > 0) {
		const ready = [...remaining]
			.filter((i) => [...deps[i]].every((j) => !remaining.has(j)))
			.sort((a, b) => entries[a].order - entries[b].order)
		if (ready.length === 0) {
			// Cycle: append remaining sorted by DDL order
			;[...remaining]
				.sort((a, b) => entries[a].order - entries[b].order)
				.forEach((i) => sorted.push(i))
			break
		}
		sorted.push(ready[0])
		remaining.delete(ready[0])
	}

	return sorted.map((i) => {
		const { order: _order, ...entry } = entries[i]
		return entry
	})
}
