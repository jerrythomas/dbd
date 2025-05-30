import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, unlinkSync } from 'fs'
import yaml from 'js-yaml'
import { rimraf } from 'rimraf'
import createConnectionPool, { sql } from '@databases/pg'
import { MockConsole } from '@vanillaes/mock-console'
import { using } from '../src/collect.js'
import { resetCache } from '../src/exclusions.js'
import { config, exports, validations } from './fixtures/design'

describe('collect', async () => {
	let context = {}

	beforeAll(() => {
		context.logger = new MockConsole()

		context.databaseURL = 'postgresql://postgres:pg-test@localhost:5234/postgres'
		context.combinedDDL = '_combined.ddl'
		context.path = process.cwd()

		context.db = createConnectionPool({
			connectionString: context.databaseURL,
			bigIntMode: 'bigint'
		})
		context.export = exports
		context.collect = config
		context.validations = validations
	})
	afterAll(async () => {
		await context.db.dispose()
		// process.chdir(context.path)
	})

	beforeEach(() => {
		context.logger.capture()
		resetCache()
		process.chdir('example')
		rimraf.sync('export')
	})

	afterEach(() => {
		process.chdir(context.path)
		context.logger.flush()
		context.logger.restore()
	})

	it('Should initialize collection', () => {
		const config = yaml.load(readFileSync('design.yaml', 'utf8'))

		let dx = using('design.yaml', context.databaseURL)

		expect(dx.databaseURL).toEqual(context.databaseURL, 'Database URL should match')
		expect(dx.config.project).toEqual(config.project, 'Project config should match')
		expect(dx.config.schemas).toEqual(config.schemas, 'Schemas config should match')
		expect(dx.config.extensions).toEqual(config.extensions, 'Extensions config should match')
		expect(dx.config.import).toEqual(config.import, 'Import config should match')
		expect(dx.config.roles).toEqual(context.collect.config.roles, 'Roles config should match')

		// context.collect.entities.sort((a, b) => a.name.localeCompare(b.name))
		// dx.entities.sort((a, b) => a.name.localeCompare(b.name))
		// for (let i = 0; i < dx.entities.length; i++) {
		// 	console.log(i)
		// 	expect(dx.entities[i]).toEqual(context.collect.entities[i], 'Entities should match')
		// }
		expect(dx.isValidated).toBeFalsy('Validated should be false initially')
	})

	it('Should combine scripts and generate file', () => {
		using('design.yaml').combine(context.combinedDDL)
		expect(existsSync(context.combinedDDL)).toBeTruthy()
		unlinkSync(context.combinedDDL)
	})

	it('Should combine scripts and generate dbml', () => {
		using('design.yaml').dbml()

		expect(existsSync('Example-base-design.dbml')).toBeTruthy()
		unlinkSync('Example-base-design.dbml')
		expect(existsSync('Example-core-design.dbml')).toBeTruthy()
		unlinkSync('Example-core-design.dbml')
		//unlinkSync('combined.sql')

		expect(context.logger.infos).toEqual([
			'Generated DBML in Example-base-design.dbml',
			'Generated DBML in Example-core-design.dbml'
		])
	})

	it('Should display execution sequence in dry-run mode', async () => {
		const { beforeApply } = context.collect
		const schemas = sql`select schema_name
	                        from information_schema.schemata
	                       where schema_name in ('config', 'extensions', 'staging', 'migrate')`
		const tables = sql`select table_schema
	                         	, table_name
	                          , table_type
	                       from information_schema.tables
	                      where table_schema in ('config', 'staging', 'migrate')
	                      order by table_schema
	                             , table_name`

		let result = await context.db.query(schemas)
		expect(result).toEqual(beforeApply.schemas)
		result = await context.db.query(tables)
		expect(result).toEqual(beforeApply.tables)

		const x = using('design.yaml', context.databaseURL)
		await x.apply(null, true)

		expect(context.logger.infos).toEqual([
			'schema => config',
			'schema => extensions',
			'schema => staging',
			'schema => migrate',
			'extension => uuid-ossp using "extensions"',
			'role => basic',
			'role => advanced',
			'table => config.lookups using "ddl/table/config/lookups.ddl"',
			'procedure => staging.import_jsonb_to_table using "ddl/procedure/staging/import_jsonb_to_table.ddl"',
			'table => staging.lookup_values using "ddl/table/staging/lookup_values.ddl"',
			'table => staging.lookups using "ddl/table/staging/lookups.ddl"',
			'table => config.lookup_values using "ddl/table/config/lookup_values.ddl"',
			'procedure => staging.import_lookups using "ddl/procedure/staging/import_lookups.ddl"',
			'view => config.genders using "ddl/view/config/genders.ddl"',
			'view => config.range_values using "ddl/view/config/range_values.ddl"',
			'view => migrate.lookup_values using "ddl/view/migrate/lookup_values.ddl"',
			'procedure => staging.import_lookup_values using "ddl/procedure/staging/import_lookup_values.ddl"'
		])
		expect(context.logger.errors).toEqual([])

		result = await context.db.query(schemas)
		expect(result).toEqual(beforeApply.schemas)
		result = await context.db.query(tables)
		expect(result).toEqual(beforeApply.tables)
	})

	it('Should display execution sequence with errors in dry-run mode', async () => {
		const { beforeApply } = context.collect
		const schemas = sql`select schema_name
	                        from information_schema.schemata
	                       where schema_name in ('config', 'extensions', 'staging', 'migrate')`
		const tables = sql`select table_schema
	                         	, table_name
	                          , table_type
	                       from information_schema.tables
	                      where table_schema in ('config', 'staging', 'migrate')
	                      order by table_schema
	                             , table_name`

		let result = await context.db.query(schemas)
		expect(result).toEqual(beforeApply.schemas)
		result = await context.db.query(tables)
		expect(result).toEqual(beforeApply.tables)

		process.chdir('../spec/fixtures/bad-example')

		const x = using('design-bad.yaml', context.databaseURL)
		await x.apply(null, true)

		expect(context.logger.infos).toEqual([
			'schema => core',
			'schema => staging',
			'schema => no_schema',
			'schema => public',
			'extension => uuid-ossp using "public"',
			'table => public.test using "ddl/test.ddl"'
		])

		expect(context.logger.errors).toEqual([
			{
				type: 'table',
				name: 'core.lookups',
				errors: ['File missing for import entity']
			},
			{
				type: 'table',
				name: 'no_schema',
				errors: ['Use fully qualified name <schema>.<name>', 'File missing for import entity']
			},
			{
				file: 'ddl/core/stuff.ddl',
				name: null,
				type: null,
				errors: [
					'Location of the file is incorrect',
					'Unknown or unsupported entity type.',
					'Unknown or unsupported entity ddl script.'
				]
			},
			{
				type: 'table',
				name: 'staging.lookup_values',
				errors: ['File missing for import entity']
			},
			{
				type: 'table',
				name: 'core.lookup_values',
				errors: ['File missing for import entity']
			}
		])

		result = await context.db.query(schemas)
		expect(result).toEqual(beforeApply.schemas)
		result = await context.db.query(tables)
		expect(result).toEqual(beforeApply.tables)
	})

	it('Should apply the ddl scripts', async () => {
		const { beforeApply, afterApply } = context.collect
		const schemas = sql`select schema_name
	                        from information_schema.schemata
	                       where schema_name in ('config', 'extensions', 'staging', 'migrate')`
		const tables = sql`select table_schema
	                         	, table_name
	                          , table_type
	                        from information_schema.tables
	                       where table_schema in ('config', 'staging', 'migrate')
	                       order by table_schema
	                              , table_name`

		let result = await context.db.query(schemas)
		expect(result).toEqual(beforeApply.schemas)
		result = await context.db.query(tables)
		expect(result).toEqual(beforeApply.tables)

		const dx = using('design.yaml', context.databaseURL)
		await dx.apply()

		expect(context.logger.infos).toEqual([
			'Applying schema: config',
			'Applying schema: extensions',
			'Applying schema: staging',
			'Applying schema: migrate',
			'Applying extension: uuid-ossp',
			'Applying role: basic',
			'Applying role: advanced',
			'Applying table: config.lookups',
			'Applying procedure: staging.import_jsonb_to_table',
			'Applying table: staging.lookup_values',
			'Applying table: staging.lookups',
			'Applying table: config.lookup_values',
			'Applying procedure: staging.import_lookups',
			'Applying view: config.genders',
			'Applying view: config.range_values',
			'Applying view: migrate.lookup_values',
			'Applying procedure: staging.import_lookup_values'
		])

		result = await context.db.query(schemas)
		expect(result.length).toEqual(afterApply.schemas.length)
		result = await context.db.query(tables)
		expect(result.length).toEqual(afterApply.tables.length)
	})

	it('Should validate data', () => {
		let dx = using('design.yaml').validate()

		expect(dx.isValidated).toBeTruthy()
		expect(dx.roles).toEqual(context.collect.roles)
		// dx.entities.sort((a, b) => a.file.localeCompare(b.name))
		// context.collect.entities.sort((a, b) => a.name.localeCompare(b.name))
		for (let i = 0; i < dx.entities.length; i++) {
			expect(dx.entities[i]).toEqual(context.collect.entities[i], 'Entities should match')
		}
		expect(dx.report()).toEqual({ entity: undefined, issues: [] })
	})

	it('Should import data using psql', async () => {
		const dx = using('design.yaml', context.databaseURL).importData()

		context.logger.restore()
		expect(context.logger.infos).toEqual([
			'Importing staging.lookup_values',
			'Importing staging.lookups',
			'Processing import/loader.sql'
		])

		expect(dx.isValidated).toBeTruthy()
		let result = await context.db.query(sql`select count(*) from staging.lookup_values`)
		expect(result).toEqual([{ count: 8n }])

		result = await context.db.query(sql`select count(*) from config.lookups`)
		expect(result).toEqual([{ count: 2n }])

		result = await context.db.query(sql`select count(*) from config.lookup_values`)
		expect(result).toEqual([{ count: 8n }])
	})

	it('Should export data using psql', () => {
		const dx = using('design.yaml', context.databaseURL).exportData()

		expect(dx.isValidated).toBeFalsy()
		expect(existsSync('export')).toBeTruthy()
		expect(existsSync('export/config')).toBeTruthy()
		expect(existsSync('export/config/lookups.csv')).toBeTruthy()
		expect(existsSync('export/config/lookup_values.csv')).toBeTruthy()
		expect(existsSync('export/config/genders.csv')).toBeTruthy()
		expect(existsSync('export/migrate/lookup_values.csv')).toBeTruthy()
	})

	it('Should allow only staging tables in import', () => {
		process.chdir('../spec/fixtures/bad-example')
		const dx = using('design-bad.yaml', context.databaseURL).validate()

		expect(dx.importTables).toEqual(context.validations.importTables)
		dx.entities.map((entity, index) => {
			expect(entity).toEqual(context.validations.entities[index])
		})
	})

	it('Should apply for single entity', async () => {
		// cleanup
		await context.db.query(sql`drop table staging.lookup_values;`)

		const dx = using('design.yaml', context.databaseURL)
		await dx.apply('staging.lookup_values')

		expect(context.logger.infos).toEqual(['Applying table: staging.lookup_values'])

		let result = await context.db.query(
			sql`select count(*)
	           from information_schema.tables
	          where table_schema = 'staging'
				   and table_name = 'lookup_values'`
		)
		expect(result).toEqual([{ count: 1n }])
	})

	it('Should import a single entity using entity name', async () => {
		// cleanup
		await context.db.query(sql`delete from config.lookup_values;`)
		await context.db.query(sql`delete from config.lookups;`)
		await context.db.query(sql`delete from staging.lookup_values;`)

		using('design.yaml', context.databaseURL).importData('staging.lookup_values')
		expect(context.logger.infos).toEqual([
			'Importing staging.lookup_values',
			'Processing import/loader.sql'
		])
		let result = await context.db.query(sql`select count(*) from staging.lookup_values`)

		expect(result).toEqual([{ count: 8n }])
		result = await context.db.query(sql`select count(*) from config.lookups`)
		expect(result).toEqual([{ count: 2n }])
		result = await context.db.query(sql`select count(*) from config.lookup_values`)
		expect(result).toEqual([{ count: 8n }])
	})

	it('Should skip import when invalid name or file is provided', async () => {
		// cleanup
		await context.db.query(sql`delete from config.lookup_values;`)
		await context.db.query(sql`delete from config.lookups;`)
		await context.db.query(sql`delete from staging.lookup_values;`)
		await context.db.query(sql`delete from staging.lookups;`)

		using('design.yaml', context.databaseURL).importData('import/staging/invalid')
		expect(context.logger.infos).toEqual(['Processing import/loader.sql'])
		let result = await context.db.query(sql`select count(*) from staging.lookup_values`)
		expect(result).toEqual([{ count: 0n }])
		result = await context.db.query(sql`select count(*) from config.lookups`)
		expect(result).toEqual([{ count: 0n }])
		result = await context.db.query(sql`select count(*) from config.lookup_values`)
		expect(result).toEqual([{ count: 0n }])
	})

	it('Should import single entity using filepath', async () => {
		// cleanup
		await context.db.query(sql`delete from config.lookup_values;`)
		await context.db.query(sql`delete from config.lookups;`)
		await context.db.query(sql`delete from staging.lookup_values;`)
		await context.db.query(sql`delete from staging.lookups;`)

		using('design.yaml', context.databaseURL).importData('import/staging/lookups.csv')
		let result = await context.db.query(sql`select count(*) from staging.lookup_values`)
		expect(result).toEqual([{ count: 0n }])
		result = await context.db.query(sql`select count(*) from config.lookups`)
		expect(result).toEqual([{ count: 2n }])
		result = await context.db.query(sql`select count(*) from config.lookup_values`)
		expect(result).toEqual([{ count: 0n }])
	})

	it('Should export a single entity by name', () => {
		using('design.yaml', context.databaseURL).exportData('config.unknown')
		expect(existsSync('export/config/genders.csv')).toBeFalsy('config.genders.csv should not exist')
		expect(existsSync('export/config/lookups.csv')).toBeFalsy('config.lookups.csv should not exist')
		expect(existsSync('export/config/lookup_values.csv')).toBeFalsy(
			'config.lookup_values.csv should not exist'
		)

		using('design.yaml', context.databaseURL).exportData('config.genders')
		expect(existsSync('export/config/genders.csv')).toBeTruthy('Selected export file should exist')
		expect(existsSync('export/config/lookups.csv')).toBeFalsy('config.lookups.csv should not exist')
		expect(existsSync('export/config/lookup_values.csv')).toBeFalsy(
			'config.lookup_values.csv should not exist'
		)
	})

	it('Should report zero issues in example', () => {
		let result = using('design.yaml', context.databaseURL).validate().report()
		expect(result).toEqual({ entity: undefined, issues: [] })
		result = using('design.yaml', context.databaseURL).report()
		expect(result).toEqual({ entity: undefined, issues: [] })
	})
})
