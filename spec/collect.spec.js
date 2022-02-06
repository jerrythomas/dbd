import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import fs from 'fs'
import yaml from 'js-yaml'
import { omit } from 'ramda'

import { using } from '../src/collect.js'

const CollectorSuite = suite('Suite for collector')

CollectorSuite.before((context) => {
	context.path = process.cwd()
	context.opts = { database: 'postgresql://localhost:5432' }

	context.export = yaml.load(
		fs.readFileSync('spec/fixtures/export.yaml', 'utf8')
	)
	context.collect = yaml.load(fs.readFileSync('spec/fixtures/d1.yaml', 'utf8'))
})

CollectorSuite.before.each((context) => {
	process.chdir('example')
})

CollectorSuite.after.each((context) => {
	process.chdir(context.path)
})

CollectorSuite('Should initialize collection', (context) => {
	const config = yaml.load(fs.readFileSync('design.yaml', 'utf8'))

	let dx = using('design.yaml')

	assert.equal(dx.config.project, config.project)
	assert.equal(dx.config.schemas, config.schemas)
	assert.equal(dx.config.extensions, config.extensions)
	assert.equal(dx.config.roles, context.collect.config.roles)
	assert.equal(dx.config.entities, context.collect.config.entities)
	assert.equal(dx.entities, context.collect.entities)
})

CollectorSuite('Should combine scripts and generate file', (context) => {
	using('design.yaml').combine('_combined.sql')
	assert.ok(fs.existsSync('_combined.sql'))
	fs.unlinkSync('_combined.sql')
})

CollectorSuite('Should combine scripts and generate dbml', (context) => {
	using('design.yaml').dbml()
	assert.ok(fs.existsSync('design.dbml'))
	fs.unlinkSync('design.dbml')
})

CollectorSuite('Should apply the ddl scripts', (context) => {})

CollectorSuite('Should collect import scripts', (context) => {})
CollectorSuite('Should collect export entities', (context) => {})

CollectorSuite.run()
