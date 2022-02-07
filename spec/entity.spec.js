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

const EntitySuite = suite('Suite for entity')

EntitySuite.before((context) => {
	const data = yaml.load(fs.readFileSync('spec/fixtures/entities.yaml', 'utf8'))
	Object.keys(data).map((key) => (context[key] = data[key]))
})

EntitySuite('Should convert filenames to entities', (context) => {
	context.files.map(({ input, output }) => {
		assert.equal(entityFromFile(input), output)
	})
})

EntitySuite('Should convert export configuration to entities', (context) => {
	context.exportConfig.map(({ input, output, message }) => {
		assert.equal(entityFromExportConfig(input), output, message)
	})
})

EntitySuite('Should convert import configuration to entities', (context) => {
	context.importConfig.map(({ input, output, message }) => {
		assert.equal(entityFromImportConfig(input), output, message)
	})
})

EntitySuite('Should convert schema names to entities', (context) => {
	context.schemaNames.map(({ input, output }) => {
		assert.equal(entityFromSchemaName(input), output)
	})
})

EntitySuite('Should convert role names to entities', (context) => {
	context.roleNames.map(({ input, output }) => {
		assert.equal(entityFromRoleName(input), output)
	})
})

EntitySuite('Should convert extension config to entities', (context) => {
	context.extensionConfig.map(({ input, output }) => {
		assert.equal(entityFromExtensionConfig(input), output)
	})
})

EntitySuite('Should provide ddl for entity', (context) => {
	context.ddlScripts.map(({ input, output, message }) => {
		assert.equal(ddlFromEntity(input), output, message)
	})
})

EntitySuite('Should get data for entity', async (context) => {
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

EntitySuite('Should validate entity data', (context) => {
	context.validations.map(({ input, output }) => {
		assert.equal(validateEntityFile(input.entity, input.ddl), output)
	})
})

EntitySuite('Should generate import script for entity', (context) => {
	context.importScripts.map(({ input, output }) => {
		assert.equal(importScriptForEntity(input), output)
	})
})

EntitySuite('Should generate import script for entity', (context) => {
	const { input, output, message } = context.exportScripts
	assert.equal(exportScriptForEntity(input), output, message)
})

EntitySuite.run()
