import fs from 'fs'
import yaml from 'js-yaml'
import {
	describe,
	expect,
	it,
	beforeAll,
	beforeEach,
	afterEach
} from 'bun:test'
import { scan, read, merge, clean, regroup, organize } from '../src/metadata.js'

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

	it('Should fetch all files in path', () => {
		expect(scan('ddl')).toEqual([
			'ddl/procedure/staging/import_lookups.ddl',
			'ddl/procedure/staging/import_jsonb_to_table.ddl',
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
		expect(config.tables).toEqual([])
		expect(config.views).toEqual([])
		expect(config.functions).toEqual([])
		expect(config.procedures).toEqual([])
		expect(config.entities).toEqual([])

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

		for (let i = 0; i < data.entities.length; i++)
			expect(data.entities[i]).toEqual(context.clean.output.entities[i])
		// expect(data.entities[]).toEqual(context.clean.output.entities[0])
		// console.log('data\n', JSON.stringify(data, null, 2))
		// console.log('expected\n', JSON.stringify(context.clean.output, null, 2))
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
