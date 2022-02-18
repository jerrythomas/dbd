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
	context.clean = yaml.load(
		fs.readFileSync('spec/fixtures/metadata-clean.yaml', 'utf8')
	)
	context.mdfix = yaml.load(
		fs.readFileSync('spec/fixtures/metadata-fix.yaml', 'utf8')
	)
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
		'ddl/table/staging/lookup_values.ddl',
		'ddl/view/core/genders.ddl',
		'ddl/view/export/lookup_values.ddl'
	])
})

MetadataSuite('Should read the configuration', (context) => {
	assert.equal(read('design.yaml'), context.metadata.read)
	assert.equal(
		read('../spec/fixtures/bad-example/design-missing.yaml'),
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
	let data = clean(context.clean.input)
	// console.log(data)
	assert.equal(data, context.clean.output)
})

MetadataSuite('Should regroup based on dependencies', (context) => {
	let data

	data = regroup(context.mdfix.simple.input)
	assert.equal(data, context.mdfix.simple.output)
	data = regroup(context.mdfix.complex.input)
	assert.equal(data, context.mdfix.complex.output)
})

MetadataSuite('Should add missing values and reorder', (context) => {
	let data
	data = organize(context.mdfix.reorder.input)
	assert.equal(data, context.mdfix.reorder.output)
	data = organize(context.mdfix.missing.input)
	assert.equal(data, context.mdfix.missing.output)
})

MetadataSuite.run()
