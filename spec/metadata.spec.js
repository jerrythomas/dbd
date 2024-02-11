import fs from 'fs'
import yaml from 'js-yaml'
// import { suite } from 'uvu'
// import * as assert from 'uvu/assert'
import { describe, expect, it, beforeAll, beforeEach } from 'bun:test'
import { scan, read, merge, clean, regroup, organize } from '../src/metadata.js'
import { afterEach } from 'vitest'

// const it = suite('Metadata processing')

describe('metadata', () => {
	let context = {}
	beforeAll(() => {
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

	beforeEach(() => {
		process.chdir('example')
	})
	afterEach(() => {
		process.chdir(context.path)
	})

	// test.before((context) => {

	// })

	// test.before.each((context) => {
	// 	process.chdir('example')
	// })

	// test.after.each((context) => {
	// 	process.chdir(context.path)
	// })

	it('Should fetch all files in path', () => {
		expect(scan('ddl')).toEqual([
			'ddl/procedure/staging/import_lookups.ddl',
			'ddl/procedure/staging/import_json_to_table.ddl',
			'ddl/table/staging/lookup_values.ddl',
			'ddl/table/config/lookup_values.ddl',
			'ddl/table/config/lookups.ddl',
			'ddl/view/config/genders.ddl',
			'ddl/view/migrate/lookup_values.ddl'
		])
	})

	it('Should read minimal configuration', () => {
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
		expect(config).toEqual(expected)
	})

	it('Should read the configuration file', () => {
		const schemas = ['config', 'extensions', 'staging', 'migrate']
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
				name: 'config.lookups',
				type: 'table'
			},
			{
				refers: ['config.lookups'],
				name: 'config.lookup_values',
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
				refers: ['config.lookups', 'config.lookup_values'],
				name: 'config.genders',
				type: 'view'
			},
			{
				refers: ['config.lookups', 'config.lookup_values'],
				name: 'migrate.lookup_values',
				type: 'view'
			}
		]
		const procedures = [
			{
				refers: [
					'config.lookup_values',
					'config.lookups',
					'staging.lookup_values'
				],
				name: 'staging.import_lookups',
				type: 'procedure'
			}
		]
		const project = {
			name: 'Example',
			database: 'PostgreSQL',
			extensionSchema: 'extensions',
			staging: ['staging'],
			dbdocs: {
				base: {
					exclude: {
						schemas: ['staging', 'migrate', 'extensions']
					}
				},
				core: {
					include: {
						schemas: ['config']
					}
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
			'config.lookups',
			'config.lookup_values',
			'config.genders',
			'migrate.lookup_values'
		]

		const config = read('design.yaml')
		expect(config.schemas).toEqual(schemas, 'read schemas from configuration')
		expect(config.roles).toEqual(roles, 'read roles from configuration')
		expect(config.tables).toEqual(tables, 'read tables from configuration')
		expect(config.views).toEqual(views, 'read views from configuration')
		expect(config.functions).toEqual([], 'read functions from configuration')
		expect(config.procedures).toEqual(
			procedures,
			'read procedures from configuration'
		)
		expect(config.entities).toEqual(
			[...tables, ...views, ...procedures],
			'combined entities from configuration'
		)
		expect(config.project).toEqual(project, 'read project from configuration')
		expect(config.import).toEqual(
			importTables,
			'read imports from configuration'
		)
		expect(config.export).toEqual(
			exportTables,
			'read exports from configuration'
		)
	})

	it('Should merge entities', () => {
		const x = [
			{
				type: 'table',
				name: 'config.lookups',
				file: 'ddl/table/config/lookups.ddl'
			},
			{
				type: 'table',
				name: 'config.lookup_values',
				file: 'ddl/table/config/lookup_values.ddl'
			},
			{
				type: 'view',
				name: 'config.genders',
				file: 'ddl/table/config/genders.ddl'
			},
			{
				type: 'table',
				name: 'staging.lookup_values',
				file: 'ddl/table/staging/lookup_values.ddl'
			}
		]
		const y = [
			{
				type: 'table',
				name: 'config.lookup_values',
				refers: ['config.lookups']
			},
			{
				type: 'view',
				name: 'config.genders',
				refers: ['config.lookups', 'config.lookup_values']
			}
		]
		const output = [
			{
				type: 'table',
				name: 'config.lookup_values',
				file: 'ddl/table/config/lookup_values.ddl',
				refers: ['config.lookups']
			},
			{
				type: 'view',
				name: 'config.genders',
				file: 'ddl/table/config/genders.ddl',
				refers: ['config.lookups', 'config.lookup_values']
			},
			{
				type: 'table',
				name: 'config.lookups',
				file: 'ddl/table/config/lookups.ddl'
			},
			{
				type: 'table',
				name: 'staging.lookup_values',
				file: 'ddl/table/staging/lookup_values.ddl'
			}
		]
		const result = merge(x, y)
		expect(result).toEqual(output)
	})

	it('Should add missing roles, schemas and entities', () => {
		let data = clean(context.clean.input)
		expect(data).toEqual(context.clean.output)
	})

	it('Should regroup based on dependencies', () => {
		let data

		data = regroup(context.mdfix.simple.input)
		expect(data).toEqual(context.mdfix.simple.output)
		data = regroup(context.mdfix.complex.input)
		expect(data).toEqual(context.mdfix.complex.output)
	})

	it('Should add missing values and reorder', () => {
		let data
		data = organize(context.mdfix.reorder.input)
		expect(data).toEqual(context.mdfix.reorder.output)
		data = organize(context.mdfix.missing.input)
		expect(data).toEqual(context.mdfix.missing.output)
	})
})
// test.run()
