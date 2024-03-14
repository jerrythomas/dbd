import fs from 'fs'
import yaml from 'js-yaml'
import { rimraf } from 'rimraf'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'
import createConnectionPool, { sql } from '@databases/pg'
import { MockConsole } from '@vanillaes/mock-console'
import { using } from '../src/collect.js'
import { resetCache } from '../src/exclusions.js'

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
		context.export = yaml.load(fs.readFileSync('spec/fixtures/design-export.yaml', 'utf8'))
		context.collect = yaml.load(fs.readFileSync('spec/fixtures/design-config.yaml', 'utf8'))
		context.validations = yaml.load(
			fs.readFileSync('spec/fixtures/design-validations.yaml', 'utf8')
		)
	})
	afterAll(async () => {
		await context.db.dispose()
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
		const config = yaml.load(fs.readFileSync('design.yaml', 'utf8'))

		let dx = using('design.yaml', context.databaseURL)

		expect(dx.databaseURL).toEqual(context.databaseURL, 'Database URL should match')
		expect(dx.config.project).toEqual(config.project, 'Project config should match')
		expect(dx.config.schemas).toEqual(config.schemas, 'Schemas config should match')
		expect(dx.config.extensions).toEqual(config.extensions, 'Extensions config should match')
		expect(dx.config.import).toEqual(config.import, 'Import config should match')
		expect(dx.config.roles).toEqual(context.collect.config.roles, 'Roles config should match')

		context.collect.entities.sort((a, b) => a.name.localeCompare(b.name))
		dx.entities.sort((a, b) => a.name.localeCompare(b.name))
		for (let i = 0; i < dx.entities.length; i++) {
			expect(dx.entities[i]).toEqual(context.collect.entities[i], 'Entities should match')
		}
		expect(dx.isValidated).toBeFalsy('Validated should be false initially')
	})

	it('Should combine scripts and generate file', () => {
		using('design.yaml').combine(context.combinedDDL)
		expect(fs.existsSync(context.combinedDDL)).toBeTruthy()
		fs.unlinkSync(context.combinedDDL)
	})

	it('Should combine scripts and generate dbml', () => {
		using('design.yaml').dbml()

		expect(fs.existsSync('Example-base-design.dbml')).toBeTruthy()
		fs.unlinkSync('Example-base-design.dbml')
		expect(fs.existsSync('Example-core-design.dbml')).toBeTruthy()
		fs.unlinkSync('Example-core-design.dbml')
		//fs.unlinkSync('combined.sql')

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
			'procedure => staging.import_jsonb_to_table using "ddl/procedure/staging/import_jsonb_to_table.ddl"',
			'table => staging.lookup_values using "ddl/table/staging/lookup_values.ddl"',
			'table => config.lookups using "ddl/table/config/lookups.ddl"',
			'table => config.lookup_values using "ddl/table/config/lookup_values.ddl"',
			'procedure => staging.import_lookups using "ddl/procedure/staging/import_lookups.ddl"',
			'view => config.genders using "ddl/view/config/genders.ddl"',
			'view => migrate.lookup_values using "ddl/view/migrate/lookup_values.ddl"'
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
			'extension => uuid-ossp using "public"'
		])

		expect(context.logger.errors).toEqual([
			{
				type: 'table',
				name: 'core.lookups',
				errors: ['File missing for import entity']
			},
			{
				type: 'table',
				name: 'staging.lookup_values',
				errors: ['File missing for import entity']
			},
			{
				type: 'table',
				name: 'no_schema',
				errors: ['Use fully qualified name <schema>.<name>', 'File missing for import entity']
			},
			{
				name: 'core.stuff',
				type: 'core',
				errors: ['Unknown or unsupported entity type.', 'Unknown or unsupported entity ddl script.']
			},
			{
				type: 'table',
				name: 'public.test',
				errors: [
					'Schema in script does not match file path',
					'Entity type in script does not match file path',
					'Entity name in script does not match file name'
				]
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
			'Applying procedure: staging.import_jsonb_to_table',
			'Applying table: staging.lookup_values',
			'Applying table: config.lookups',
			'Applying table: config.lookup_values',
			'Applying procedure: staging.import_lookups',
			'Applying view: config.genders',
			'Applying view: migrate.lookup_values'
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
		dx.entities.sort((a, b) => a.name.localeCompare(b.name))
		context.collect.entities.sort((a, b) => a.name.localeCompare(b.name))
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
			'Processing import/loader.sql'
		])

		expect(dx.isValidated).toBeTruthy()
		let result = await context.db.query(sql`select count(*) from staging.lookup_values`)
		expect(result).toEqual([{ count: 2n }])

		result = await context.db.query(sql`select count(*) from config.lookups`)
		expect(result).toEqual([{ count: 1n }])

		result = await context.db.query(sql`select count(*) from config.lookup_values`)
		expect(result).toEqual([{ count: 2n }])
	})

	it('Should export data using psql', () => {
		const dx = using('design.yaml', context.databaseURL).exportData()

		expect(dx.isValidated).toBeFalsy()
		expect(fs.existsSync('export')).toBeTruthy()
		expect(fs.existsSync('export/config')).toBeTruthy()
		expect(fs.existsSync('export/config/lookups.csv')).toBeTruthy()
		expect(fs.existsSync('export/config/lookup_values.csv')).toBeTruthy()
		expect(fs.existsSync('export/config/genders.csv')).toBeTruthy()
		expect(fs.existsSync('export/migrate/lookup_values.csv')).toBeTruthy()
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

		expect(result).toEqual([{ count: 2n }])
		result = await context.db.query(sql`select count(*) from config.lookups`)
		expect(result).toEqual([{ count: 1n }])
		result = await context.db.query(sql`select count(*) from config.lookup_values`)
		expect(result).toEqual([{ count: 2n }])
	})

	it('Should skip import when invalid name or file is provided', async () => {
		// cleanup
		await context.db.query(sql`delete from config.lookup_values;`)
		await context.db.query(sql`delete from config.lookups;`)
		await context.db.query(sql`delete from staging.lookup_values;`)

		using('design.yaml', context.databaseURL).importData('import/staging/lookup_values')
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

		using('design.yaml', context.databaseURL).importData('import/staging/lookup_values.csv')
		let result = await context.db.query(sql`select count(*) from staging.lookup_values`)
		expect(result).toEqual([{ count: 2n }])
		result = await context.db.query(sql`select count(*) from config.lookups`)
		expect(result).toEqual([{ count: 1n }])
		result = await context.db.query(sql`select count(*) from config.lookup_values`)
		expect(result).toEqual([{ count: 2n }])
	})

	it('Should export a single entity by name', () => {
		using('design.yaml', context.databaseURL).exportData('config.unknown')
		expect(fs.existsSync('export/config/genders.csv')).toBeFalsy(
			'config.genders.csv should not exist'
		)
		expect(fs.existsSync('export/config/lookups.csv')).toBeFalsy(
			'config.lookups.csv should not exist'
		)
		expect(fs.existsSync('export/config/lookup_values.csv')).toBeFalsy(
			'config.lookup_values.csv should not exist'
		)

		using('design.yaml', context.databaseURL).exportData('config.genders')
		expect(fs.existsSync('export/config/genders.csv')).toBeTruthy(
			'Selected export file should exist'
		)
		expect(fs.existsSync('export/config/lookups.csv')).toBeFalsy(
			'config.lookups.csv should not exist'
		)
		expect(fs.existsSync('export/config/lookup_values.csv')).toBeFalsy(
			'config.lookup_values.csv should not exist'
		)
	})

	it('Should report zero issues in example', () => {
		let result = using('design.yaml', context.databaseURL).validate().report()
		expect(result).toEqual({ entity: undefined, issues: [] })
		result = using('design.yaml', context.databaseURL).report()
		expect(result).toEqual({ entity: undefined, issues: [] })
	})

	it('should generate report for individual entity', () => {
		process.chdir('../spec/fixtures/references')
		const issues = JSON.parse(fs.readFileSync('issues.json'))
		const other = JSON.parse(fs.readFileSync('references.json'))

		const dx = using('design.yaml', context.databaseURL).validate()

		let result = dx.report('staging.import_jsonb_to_table')
		expect(result).toEqual({ entity: issues[0], issues: [issues[0]] })
		result = dx.report('staging.import_lookups')
		expect(result).toEqual({ entity: other[0], issues: [] })
	})

	it.only('Should list issues in report', () => {
		process.chdir('../spec/fixtures/references')
		const expected = JSON.parse(fs.readFileSync('issues.json'))
		const result = using('design.yaml', context.databaseURL).validate().report()
		expect(result.issues).toEqual(expected)
		expect(result.entity).toBeUndefined()
	})
})
