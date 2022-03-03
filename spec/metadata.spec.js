import fs from 'fs'
import yaml from 'js-yaml'
import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import { scan, read, merge, clean, regroup, organize } from '../src/metadata.js'

const test = suite('Metadata processing')

test.before((context) => {
	context.path = process.cwd()

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

test.before.each((context) => {
	process.chdir('example')
})

test.after.each((context) => {
	process.chdir(context.path)
})

test('Should fetch all files in path', (context) => {
	assert.equal(scan('ddl'), [
		'ddl/table/core/lookup_values.ddl',
		'ddl/table/core/lookups.ddl',
		'ddl/table/staging/lookup_values.ddl',
		'ddl/view/core/genders.ddl',
		'ddl/view/migrate/lookup_values.ddl'
	])
})

test('Should read minimal configuration', () => {
	const expected = {
		schemas: [],
		roles: [],
		tables: [],
		views: [],
		functions: [],
		procedures: [],
		entities: [],
		project: {
			name: 'Example',
			staging: []
		}
	}

	const config = read('../spec/fixtures/bad-example/design-missing.yaml')
	assert.equal(config, expected)
})

test('Should read the configuration file', () => {
	const schemas = ['core', 'extensions', 'staging', 'migrate']
	const roles = [
		{
			refers: ['basic'],
			name: 'advanced',
			type: 'role'
		},
		{
			refers: [],
			name: 'basic',
			type: 'role'
		}
	]
	const tables = [
		{
			refers: [],
			name: 'core.lookups',
			type: 'table'
		},
		{
			refers: ['core.lookups'],
			name: 'core.lookup_values',
			type: 'table'
		},
		{
			refers: [],
			name: 'staging.lookup_values',
			type: 'table'
		}
	]
	const views = [
		{
			refers: ['core.lookups', 'core.lookup_values'],
			name: 'core.genders',
			type: 'view'
		},
		{
			refers: ['core.lookups', 'core.lookup_values'],
			name: 'migrate.lookup_values',
			type: 'view'
		}
	]
	const project = {
		name: 'Example',
		database: 'PostgreSQL',
		extensionSchema: 'extensions',
		staging: ['staging'],
		dbdocs: {
			exclude: {
				schemas: ['staging', 'migrate', 'extensions'],
				tables: []
			}
		}
	}

	const importTables = {
		options: {
			truncate: true,
			nullValue: ''
		},
		tables: ['staging.lookup_values'],
		after: ['import/loader.sql']
	}
	const exportTables = [
		'core.lookups',
		'core.lookup_values',
		'core.genders',
		'migrate.lookup_values'
	]

	const config = read('design.yaml')
	assert.equal(config.schemas, schemas, 'read schemas from configuration')
	assert.equal(config.roles, roles, 'read roles from configuration')
	assert.equal(config.tables, tables, 'read tables from configuration')
	assert.equal(config.views, views, 'read views from configuration')
	assert.equal(config.functions, [], 'read functions from configuration')
	assert.equal(config.procedures, [], 'read procedures from configuration')
	assert.equal(
		config.entities,
		[...tables, ...views],
		'combined entities from configuration'
	)
	assert.equal(config.project, project, 'read project from configuration')
	assert.equal(config.import, importTables, 'read imports from configuration')
	assert.equal(config.export, exportTables, 'read exports from configuration')
})

test('Should merge entities', (context) => {
	const x = [
		{ type: 'table', name: 'core.lookups', file: 'ddl/table/core/lookups.ddl' },
		{
			type: 'table',
			name: 'core.lookup_values',
			file: 'ddl/table/core/lookup_values.ddl'
		},
		{ type: 'view', name: 'core.genders', file: 'ddl/table/core/genders.ddl' },
		{
			type: 'table',
			name: 'staging.lookup_values',
			file: 'ddl/table/staging/lookup_values.ddl'
		}
	]
	const y = [
		{ type: 'table', name: 'core.lookup_values', refers: ['core.lookups'] },
		{
			type: 'view',
			name: 'core.genders',
			refers: ['core.lookups', 'core.lookup_values']
		}
	]
	const output = [
		{
			type: 'table',
			name: 'core.lookup_values',
			file: 'ddl/table/core/lookup_values.ddl',
			refers: ['core.lookups']
		},
		{
			type: 'view',
			name: 'core.genders',
			file: 'ddl/table/core/genders.ddl',
			refers: ['core.lookups', 'core.lookup_values']
		},
		{ type: 'table', name: 'core.lookups', file: 'ddl/table/core/lookups.ddl' },
		{
			type: 'table',
			name: 'staging.lookup_values',
			file: 'ddl/table/staging/lookup_values.ddl'
		}
	]
	const result = merge(x, y)
	assert.equal(result, output)
})

test('Should add missing roles, schemas and entities', (context) => {
	let data = clean(context.clean.input)
	// console.log(data)
	assert.equal(data, context.clean.output)
})

test('Should regroup based on dependencies', (context) => {
	let data

	data = regroup(context.mdfix.simple.input)
	assert.equal(data, context.mdfix.simple.output)
	data = regroup(context.mdfix.complex.input)
	assert.equal(data, context.mdfix.complex.output)
})

test('Should add missing values and reorder', (context) => {
	let data
	data = organize(context.mdfix.reorder.input)
	assert.equal(data, context.mdfix.reorder.output)
	data = organize(context.mdfix.missing.input)
	assert.equal(data, context.mdfix.missing.output)
})

test.run()
