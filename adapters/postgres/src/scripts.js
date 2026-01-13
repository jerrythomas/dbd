/**
 * PostgreSQL script generators
 * @module adapters/postgres/scripts
 */

import { readFileSync, existsSync } from 'fs'
import { extname, sep } from 'path'
import csv from 'csvtojson'

/**
 * Default options for import operations
 */
export const defaultImportOptions = {
	format: 'csv',
	truncate: false,
	nullValue: ''
}

/**
 * Default options for export operations
 */
export const defaultExportOptions = {
	format: 'csv'
}

/**
 * Generate DDL script from entity configuration
 * @param {Object} entity - Entity configuration
 * @returns {string} DDL script
 */
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
		return getRoleScript(entity)
	}

	return null
}

/**
 * Generate the creation script for role entity
 * @param {Object} entity - Role entity
 * @returns {string} Role creation script
 */
function getRoleScript(entity) {
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

/**
 * Generate import script for an entity
 * @param {Object} entity - Import entity configuration
 * @returns {string} Import script
 */
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
		commands.push(`call staging.import_jsonb_to_table('_temp', '${entity.name}');`)
		commands.push('drop table if exists _temp;')
	} else {
		commands.push(
			`\\copy ${entity.name} from '${entity.file}' with delimiter E'${delimiter}' NULL as '${entity.nullValue}' csv header;`
		)
	}

	return commands.join('\n')
}

/**
 * Generate export script for an entity
 * @param {Object} entity - Export entity configuration
 * @returns {string} Export script
 */
export function exportScriptForEntity(entity) {
	const file = `export/${entity.name.replace('.', sep)}.` + (entity.format || 'csv')
	const delimiter = entity.format === 'csv' ? ',' : '\\t'

	if (['json', 'jsonl'].includes(entity.format)) {
		return `\\copy (select row_to_json(t) from ${entity.name} t) to '${file}';`
	}

	return `\\copy (select * from ${entity.name}) to '${file}' with delimiter E'${delimiter}' csv header;`
}

/**
 * Fetch data from CSV or JSON files for an entity
 * @param {Object} entity - Entity configuration
 * @returns {Promise<Array>} Array containing data
 */
export async function dataFromEntity(entity) {
	let data = []

	if (extname(entity.file) === '.json') {
		data = JSON.parse(readFileSync(entity.file, 'utf8'))
	} else if (extname(entity.file) === '.csv') {
		data = await csv().fromFile(entity.file)
	}

	return data
}

/**
 * Validate if required files exist for entity operations
 * @param {Object} entity - Entity configuration
 * @returns {Array<string>} Array of validation errors
 */
export function validateEntityFiles(entity) {
	let errors = []

	if (entity.file && !existsSync(entity.file)) {
		errors.push('File does not exist')
	}

	if (entity.file) {
		const ext = extname(entity.file)

		// Validate DDL files
		if (entity.type !== 'import' && ext !== '.ddl') {
			errors.push('Unsupported file type for ddl')
		}

		// Validate data files
		if (entity.type === 'import' && !['.tsv', '.csv', '.json', '.jsonl'].includes(ext)) {
			errors.push('Unsupported data format')
		}
	}

	return errors
}

/**
 * Generate batch import script for multiple entities
 * @param {Array<Object>} entities - Array of import entities
 * @returns {string} Batch import script
 */
export function batchImportScript(entities) {
	const scripts = entities.map((entity) => importScriptForEntity(entity))
	return scripts.join('\n\n')
}

/**
 * Generate batch export script for multiple entities
 * @param {Array<Object>} entities - Array of export entities
 * @returns {string} Batch export script
 */
export function batchExportScript(entities) {
	const scripts = entities.map((entity) => exportScriptForEntity(entity))
	return scripts.join('\n')
}

export default {
	ddlFromEntity,
	importScriptForEntity,
	exportScriptForEntity,
	dataFromEntity,
	validateEntityFiles,
	batchImportScript,
	batchExportScript,
	defaultImportOptions,
	defaultExportOptions
}
