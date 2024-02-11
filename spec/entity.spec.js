import { describe, expect, it, beforeAll, beforeEach } from 'bun:test'
// import { suite } from 'uvu'
// import * as assert from 'uvu/assert'
import fs from 'fs'
import yaml from 'js-yaml'

import {
	entityFromFile,
	entityFromRoleName,
	entityFromSchemaName,
	entityFromExportConfig,
	entityFromImportConfig,
	entityFromExtensionConfig,
	ddlFromEntity,
	dataFromEntity,
	validateEntityFile,
	importScriptForEntity,
	exportScriptForEntity
} from '../src/entity.js'

describe('entity', () => {
	let context = {}

	beforeAll(() => {
		context.path = process.cwd()
		const data = yaml.load(
			fs.readFileSync('spec/fixtures/entities.yaml', 'utf8')
		)
		Object.keys(data).map((key) => (context[key] = data[key]))
	})

	beforeEach(() => {
		process.chdir(context.path)
	})

	it('Should convert filepath for schemaless entity', () => {
		expect(entityFromFile('ddl/role/admin.ddl')).toEqual({
			type: 'role',
			name: 'admin',
			file: 'ddl/role/admin.ddl'
		})
	})

	it('Should convert filepath for schema entities', () => {
		expect(entityFromFile('ddl/table/core/lookup.ddl')).toEqual({
			type: 'table',
			name: 'core.lookup',
			file: 'ddl/table/core/lookup.ddl',
			schema: 'core'
		})
	})

	it('Should convert filepath for import entities', () => {
		expect(entityFromFile('import/staging/lookup.csv')).toEqual({
			type: 'import',
			name: 'staging.lookup',
			file: 'import/staging/lookup.csv',
			schema: 'staging'
		})
	})

	it('Should convert name to export entity', () => {
		const actual = entityFromExportConfig('core.lookup')
		expect(actual).toEqual({
			type: 'export',
			name: 'core.lookup',
			format: 'csv'
		})
	})

	it('Should override options for export entity', () => {
		const actual = entityFromExportConfig({
			'core.lookup': { format: 'jsonl' }
		})
		expect(actual).toEqual({
			type: 'export',
			name: 'core.lookup',
			format: 'jsonl'
		})
	})

	it('Should convert name to import entity', () => {
		const actual = entityFromImportConfig('staging.lookup')
		expect(actual).toEqual({
			type: 'import',
			name: 'staging.lookup',
			schema: 'staging',
			format: 'csv',
			nullValue: '',
			truncate: true
		})
	})

	it('Should override format for import entity', () => {
		const actual = entityFromImportConfig({
			'staging.lookup': { format: 'json' }
		})
		expect(actual).toEqual({
			type: 'import',
			name: 'staging.lookup',
			schema: 'staging',
			format: 'json',
			nullValue: '',
			truncate: true
		})
	})

	it('Should override truncate option for import entity', () => {
		const actual = entityFromImportConfig({
			'staging.lookup': { truncate: false }
		})
		expect(actual).toEqual({
			type: 'import',
			name: 'staging.lookup',
			schema: 'staging',
			format: 'csv',
			nullValue: '',
			truncate: false
		})
	})

	it('Should override nullvalue option for import entity', () => {
		const actual = entityFromImportConfig({
			'staging.lookup': { nullValue: 'NULL' }
		})
		expect(actual).toEqual({
			type: 'import',
			name: 'staging.lookup',
			schema: 'staging',
			format: 'csv',
			nullValue: 'NULL',
			truncate: true
		})
	})

	it('Should convert schema names to entities', () => {
		expect(entityFromSchemaName('public')).toEqual({
			type: 'schema',
			name: 'public'
		})
	})

	it('Should convert role names to entities', () => {
		expect(entityFromRoleName('alpha')).toEqual({
			type: 'role',
			name: 'alpha'
		})
	})

	it('Should convert extension name to entities', () => {
		const result = entityFromExtensionConfig('uuid-ossp')
		expect(result).toEqual({
			type: 'extension',
			name: 'uuid-ossp',
			schema: 'public'
		})
	})

	it('Should override schema for extension entity', () => {
		const result = entityFromExtensionConfig({
			'uuid-ossp': { schema: 'extensions' }
		})
		expect(result).toEqual({
			type: 'extension',
			name: 'uuid-ossp',
			schema: 'extensions'
		})
	})

	it('Should provide ddl for entity', () => {
		process.chdir('spec/fixtures/alternate')
		context.ddlScripts.map(({ input, output, message }) => {
			expect(ddlFromEntity(input)).toEqual(output, message)
		})
	})

	it('Should get data for entity', async () => {
		process.chdir('spec/fixtures/alternate')
		let data = await dataFromEntity(context.dataFiles.json.input)
		expect(data, context.dataFiles.json.output, context.dataFiles.json.message)
		data = await dataFromEntity(context.dataFiles.csv.input)
		expect(data, context.dataFiles.csv.output, context.dataFiles.csv.message)
	})

	it('Should validate entity data', () => {
		process.chdir('spec/fixtures/alternate')
		context.validations.map(({ input, output }) => {
			expect(validateEntityFile(input.entity, input.ddl)).toEqual(output)
		})
	})

	it('Should generate import script for entity', () => {
		context.importScripts.map(({ input, output }) => {
			expect(importScriptForEntity(input)).toEqual(output)
		})
	})

	it('Should generate import script for entity', () => {
		context.exportScripts.map(({ input, output, message }) => {
			expect(exportScriptForEntity(input)).toEqual(output, message)
		})
	})
})

// it.before.each((context) => {
// 	process.chdir(context.path)
// })
