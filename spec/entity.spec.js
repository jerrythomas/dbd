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

test('Should convert filenames to entities', (context) => {
	context.files.map(({ input, output }) => {
		assert.equal(entityFromFile(input), output)
	})
})

test('Should convert export configuration to entities', (context) => {
	context.exportConfig.map(({ input, output, message }) => {
		assert.equal(entityFromExportConfig(input), output, message)
	})
})

test('Should convert import configuration to entities', (context) => {
	context.importConfig.map(({ input, output, message }) => {
		assert.equal(entityFromImportConfig(input), output, message)
	})
})

test('Should convert schema names to entities', (context) => {
	context.schemaNames.map(({ input, output }) => {
		assert.equal(entityFromSchemaName(input), output)
	})
})

test('Should convert role names to entities', (context) => {
	context.roleNames.map(({ input, output }) => {
		assert.equal(entityFromRoleName(input), output)
	})
})

test('Should convert extension config to entities', (context) => {
	context.extensionConfig.map(({ input, output }) => {
		assert.equal(entityFromExtensionConfig(input), output)
	})
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
	const { input, output, message } = context.exportScripts
	assert.equal(exportScriptForEntity(input), output, message)
})

test.run()
