import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import fs from 'fs'
import yaml from 'js-yaml'
import {
	entityFromFile,
	entityFromRoleName,
	entityFromSchemaName,
	entityFromExportConfig,
	entityFromExtensionConfig,
	ddlFromEntity,
	dataFromEntity,
	validateEntityFile
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
	context.exportConfig.map(({ input, output }) => {
		assert.equal(entityFromExportConfig(input), output)
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

EntitySuite.run()
