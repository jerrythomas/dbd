import fs from 'fs'
import yaml from 'js-yaml'
import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import { scan, read, merge, clean, regroup, organize } from '../src/metadata.js'

const MetadataSuite = suite('Suite for Metadata')

MetadataSuite.before((context) => {
	context.path = process.cwd()
	context.opts = { database: 'postgresql://localhost:5432' }

	context.metadata = yaml.load(
		fs.readFileSync('spec/fixtures/metadata.yaml', 'utf8')
	)
	context.m1 = yaml.load(fs.readFileSync('spec/fixtures/m1.yaml', 'utf8'))
	context.r1 = yaml.load(fs.readFileSync('spec/fixtures/r1.yaml', 'utf8'))
	context.c1 = yaml.load(fs.readFileSync('spec/fixtures/c1.yaml', 'utf8'))

	// context.export = yaml.load(
	// 	fs.readFileSync('spec/fixtures/export.yaml', 'utf8')
	// )
	// context.collect = yaml.load(
	// 	fs.readFileSync('spec/fixtures/collect.yaml', 'utf8')
	// )
})

MetadataSuite.before.each((context) => {
	process.chdir('example')
})

MetadataSuite.after.each((context) => {
	process.chdir(context.path)
})

MetadataSuite('Should fetch all files in path', (context) => {
	assert.equal(scan('ddl'), [
		'ddl/role/advanced.ddl',
		'ddl/role/basic.ddl',
		'ddl/table/core/lookup_values.ddl',
		'ddl/table/core/lookups.ddl',
		'ddl/view/core/genders.ddl'
	])
})

MetadataSuite('Should read the configuration', (context) => {
	assert.equal(read('design.yaml'), context.metadata.read)
	assert.equal(
		read('../spec/fixtures/design-missing.yaml'),
		context.metadata.missing
	)
})

MetadataSuite('Should merge entities', (context) => {
	context.metadata.merge.map(({ input, output }) => {
		let result = merge(input.x, input.y)
		assert.equal(result, output)
	})
})

MetadataSuite('Should add missing roles, schemas and entities', (context) => {
	let data = clean(context.m1.input)
	assert.equal(data, context.m1.output)
})

MetadataSuite('Should regroup based on dependencies', (context) => {
	let data

	data = regroup(context.r1.simple.input)
	assert.equal(data, context.r1.simple.output)
	data = regroup(context.r1.complex.input)
	assert.equal(data, context.r1.complex.output)
})

MetadataSuite('Should add missing values and reorder', (context) => {
	let data
	data = organize(context.c1.reorder.input)
	assert.equal(data, context.c1.reorder.output)
	data = organize(context.c1.missing.input)
	assert.equal(data, context.c1.missing.output)
})

MetadataSuite.run()
