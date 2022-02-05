import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import fs from 'fs'
import yaml from 'js-yaml'
import { omit } from 'ramda'

import { collect } from '../src/collect.js'

const CollectorSuite = suite('Suite for collector')

CollectorSuite.before((context) => {
	context.path = process.cwd()
	context.opts = { database: 'postgresql://localhost:5432' }

	context.export = yaml.load(
		fs.readFileSync('spec/fixtures/export.yaml', 'utf8')
	)
	context.collect = yaml.load(
		fs.readFileSync('spec/fixtures/collect.yaml', 'utf8')
	)
})

CollectorSuite.before.each((context) => {
	process.chdir('example')
})

CollectorSuite.after.each((context) => {
	process.chdir(context.path)
})

CollectorSuite('Should initialize collection', (context) => {
	const config = yaml.load(fs.readFileSync('db.yml', 'utf8'))
	const partial = omit(['extensions', 'schemas', 'dependencies'], config)
	let dx = collect()
	assert.equal(dx.data, [])
	assert.equal(dx.config, partial)
	assert.equal(dx.allowedTypes, [])

	dx = collect('ddl')
	assert.equal(dx.data, context.collect.ddl)
	assert.equal(dx.config, partial)
	assert.equal(dx.allowedTypes, ['.ddl'])

	let opts = yaml.load(fs.readFileSync('import.yml', 'utf8'))
	dx = collect('import')
	assert.equal(dx.data, context.collect.import)
	assert.equal(dx.config, partial)
	assert.equal(dx.allowedTypes, ['.csv', '.json'])

	opts = yaml.load(fs.readFileSync('export.yml', 'utf8'))
	dx = collect('export')
	assert.equal(dx.data, context.collect.export)
	assert.equal(dx.config, partial)
	assert.equal(dx.allowedTypes, ['.csv', '.json'])
})

CollectorSuite(
	'Should analyze, group and sort by dependencies',
	(context) => {}
)
CollectorSuite('Should apply the ddl scripts', (context) => {})

CollectorSuite('Should collect import scripts', (context) => {})
CollectorSuite('Should collect export entities', (context) => {})

// CollectorSuite.run()
