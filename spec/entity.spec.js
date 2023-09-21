import { suite } from 'uvu'
import * as assert from 'uvu/assert'
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

const test = suite('Suite for entity')

test.before((context) => {
	context.path = process.cwd()
	const data = yaml.load(fs.readFileSync('spec/fixtures/entities.yaml', 'utf8'))
	Object.keys(data).map((key) => (context[key] = data[key]))
})

test.before.each((context) => {
	process.chdir(context.path)
})

test('Should convert filepath for schemaless entity', (context) => {
	assert.equal(entityFromFile('ddl/role/admin.ddl'), {
		type: 'role',
		name: 'admin',
		file: 'ddl/role/admin.ddl'
	})
})

test('Should convert filepath for schema entities', (context) => {
	assert.equal(entityFromFile('ddl/table/core/lookup.ddl'), {
		type: 'table',
		name: 'core.lookup',
		file: 'ddl/table/core/lookup.ddl',
		schema: 'core'
	})
})

test('Should convert filepath for import entities', (context) => {
	assert.equal(entityFromFile('import/staging/lookup.csv'), {
		type: 'import',
		name: 'staging.lookup',
		file: 'import/staging/lookup.csv',
		schema: 'staging'
	})
})

test('Should convert name to export entity', () => {
	const actual = entityFromExportConfig('core.lookup')
	assert.equal(actual, { type: 'export', name: 'core.lookup', format: 'csv' })
})

test('Should override options for export entity', () => {
	const actual = entityFromExportConfig({ 'core.lookup': { format: 'jsonl' } })
	assert.equal(actual, { type: 'export', name: 'core.lookup', format: 'jsonl' })
})

test('Should convert name to import entity', () => {
	const actual = entityFromImportConfig('staging.lookup')
	assert.equal(actual, {
		type: 'import',
		name: 'staging.lookup',
		schema: 'staging',
		format: 'csv',
		nullValue: '',
		truncate: true
	})
})

test('Should override format for import entity', (context) => {
	const actual = entityFromImportConfig({
		'staging.lookup': { format: 'json' }
	})
	assert.equal(actual, {
		type: 'import',
		name: 'staging.lookup',
		schema: 'staging',
		format: 'json',
		nullValue: '',
		truncate: true
	})
})

test('Should override truncate option for import entity', (context) => {
	const actual = entityFromImportConfig({
		'staging.lookup': { truncate: false }
	})
	assert.equal(actual, {
		type: 'import',
		name: 'staging.lookup',
		schema: 'staging',
		format: 'csv',
		nullValue: '',
		truncate: false
	})
})

test('Should override nullvalue option for import entity', (context) => {
	const actual = entityFromImportConfig({
		'staging.lookup': { nullValue: 'NULL' }
	})
	assert.equal(actual, {
		type: 'import',
		name: 'staging.lookup',
		schema: 'staging',
		format: 'csv',
		nullValue: 'NULL',
		truncate: true
	})
})

test('Should convert schema names to entities', (context) => {
	assert.equal(entityFromSchemaName('public'), {
		type: 'schema',
		name: 'public'
	})
})

test('Should convert role names to entities', (context) => {
	assert.equal(entityFromRoleName('alpha'), {
		type: 'role',
		name: 'alpha'
	})
})

test('Should convert extension name to entities', (context) => {
	assert.equal(entityFromExtensionConfig('uuid-ossp'), {
		type: 'extension',
		name: 'uuid-ossp',
		schema: 'public'
	})
})

test('Should override schema for extension entity', (context) => {
	assert.equal(
		entityFromExtensionConfig({ 'uuid-ossp': { schema: 'extensions' } }),
		{
			type: 'extension',
			name: 'uuid-ossp',
			schema: 'extensions'
		}
	)
})

test('Should provide ddl for entity', (context) => {
	process.chdir('spec/fixtures/alternate')
	context.ddlScripts.map(({ input, output, message }) => {
		assert.equal(ddlFromEntity(input), output, message)
	})
})

test('Should get data for entity', async (context) => {
	process.chdir('spec/fixtures/alternate')
	let data = await dataFromEntity(context.dataFiles.json.input)
	assert.equal(
		data,
		context.dataFiles.json.output,
		context.dataFiles.json.message
	)
	data = await dataFromEntity(context.dataFiles.csv.input)
	assert.equal(
		data,
		context.dataFiles.csv.output,
		context.dataFiles.csv.message
	)
})

test('Should validate entity data', (context) => {
	process.chdir('spec/fixtures/alternate')
	context.validations.map(({ input, output }) => {
		assert.equal(validateEntityFile(input.entity, input.ddl), output)
	})
})

test('Should generate import script for entity', (context) => {
	context.importScripts.map(({ input, output }) => {
		assert.equal(importScriptForEntity(input), output)
	})
})

test('Should generate import script for entity', (context) => {
	context.exportScripts.map(({ input, output, message }) => {
		assert.equal(exportScriptForEntity(input), output, message)
	})
})

test.run()
