import fs from 'fs'
import yaml from 'js-yaml'
import rimraf from 'rimraf'

import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import createConnectionPool, { sql } from '@databases/pg'
import { MockConsole } from '@vanillaes/mock-console'
import { using } from '../src/collect.js'

const test = suite('Suite for collector')

test.before((context) => {
	context.logger = new MockConsole()

	context.databaseURL = 'postgres://test-user@localhost:5234/test-db'
	context.combinedDDL = '_combined.ddl'
	context.path = process.cwd()

	context.db = createConnectionPool({
		connectionString: context.databaseURL,
		bigIntMode: 'bigint'
	})
	context.export = yaml.load(
		fs.readFileSync('spec/fixtures/design-export.yaml', 'utf8')
	)
	context.collect = yaml.load(
		fs.readFileSync('spec/fixtures/design-config.yaml', 'utf8')
	)
	context.validations = yaml.load(
		fs.readFileSync('spec/fixtures/design-validations.yaml', 'utf8')
	)
})

test.after(async (context) => {
	await context.db.dispose()
})

test.before.each((context) => {
	context.logger.capture()
	process.chdir('example')
	rimraf.sync('export')
})

test.after.each((context) => {
	process.chdir(context.path)

	context.logger.flush()
	context.logger.restore()
})

test('Should initialize collection', (context) => {
	const config = yaml.load(fs.readFileSync('design.yaml', 'utf8'))

	let dx = using('design.yaml', context.databaseURL)

	assert.equal(dx.databaseURL, context.databaseURL, 'Database URL should match')
	assert.equal(dx.config.project, config.project, 'Project config should match')
	assert.equal(dx.config.schemas, config.schemas, 'Schemas config should match')
	assert.equal(
		dx.config.extensions,
		config.extensions,
		'Extensions config should match'
	)
	assert.equal(dx.config.import, config.import, 'Import config should match')
	assert.equal(
		dx.config.roles,
		context.collect.config.roles,
		'Roles config should match'
	)
	assert.equal(
		dx.config.entities,
		context.collect.config.entities,
		'Entities config should match'
	)
	assert.equal(
		dx.entities,
		context.collect.entities,
		'Reorganized entities should match'
	)
	assert.not(dx.isValidated, 'Validated should be false initially')
})

test('Should combine scripts and generate file', (context) => {
	using('design.yaml').combine(context.combinedDDL)
	assert.ok(fs.existsSync(context.combinedDDL))
	fs.unlinkSync(context.combinedDDL)
})

test('Should combine scripts and generate dbml', (context) => {
	using('design.yaml').dbml()

	assert.ok(fs.existsSync('Example-base-design.dbml'))
	fs.unlinkSync('Example-base-design.dbml')
	assert.ok(fs.existsSync('Example-core-design.dbml'))
	fs.unlinkSync('Example-core-design.dbml')

	assert.equal(context.logger.infos, [
		'Generated DBML in Example-base-design.dbml',
		'Generated DBML in Example-core-design.dbml'
	])
})

test('Should throw error for invalid ddl', (context) => {
	process.chdir('../spec/fixtures/bad-example/')
	using('design.yaml').dbml()
	assert.not(fs.existsSync('Example-design.dbml'))
	assert.ok(context.logger.errors.length > 0)
})

test('Should display execution sequence in dry-run mode', async (context) => {
	const { beforeApply } = context.collect
	const schemas = sql`select schema_name
	                      from information_schema.schemata
                       where schema_name in ('core', 'extensions', 'staging', 'migrate')`
	const tables = sql`select table_schema
                        	, table_name
	                        , table_type
                       from information_schema.tables
                      where table_schema in ('core', 'staging', 'migrate')
                      order by table_schema
                             , table_name`

	let result = await context.db.query(schemas)
	assert.equal(result, beforeApply.schemas)
	result = await context.db.query(tables)
	assert.equal(result, beforeApply.tables)

	await using('design.yaml', context.databaseURL).apply(null, true)

	assert.equal(context.logger.infos, [
		'schema => core',
		'schema => extensions',
		'schema => staging',
		'schema => migrate',
		'extension => uuid-ossp using "extensions"',
		'role => basic',
		'role => advanced',
		'table => core.lookups using "ddl/table/core/lookups.ddl"',
		'table => staging.lookup_values using "ddl/table/staging/lookup_values.ddl"',
		'table => core.lookup_values using "ddl/table/core/lookup_values.ddl"',
		'view => core.genders using "ddl/view/core/genders.ddl"',
		'view => migrate.lookup_values using "ddl/view/migrate/lookup_values.ddl"'
	])
	assert.equal(context.logger.errors, [])

	result = await context.db.query(schemas)
	assert.equal(result, beforeApply.schemas)
	result = await context.db.query(tables)
	assert.equal(result, beforeApply.tables)
})

test('Should display execution sequence with errors in dry-run mode', async (context) => {
	const { beforeApply } = context.collect
	const schemas = sql`select schema_name
	                      from information_schema.schemata
                       where schema_name in ('core', 'extensions', 'staging', 'migrate')`
	const tables = sql`select table_schema
                        	, table_name
	                        , table_type
                       from information_schema.tables
                      where table_schema in ('core', 'staging', 'migrate')
                      order by table_schema
                             , table_name`

	let result = await context.db.query(schemas)
	assert.equal(result, beforeApply.schemas)
	result = await context.db.query(tables)
	assert.equal(result, beforeApply.tables)

	process.chdir('../spec/fixtures/bad-example')

	await using('design.yaml', context.databaseURL).apply(null, true)

	assert.equal(context.logger.infos, [
		'schema => core',
		'schema => staging',
		'schema => no_schema',
		'extension => uuid-ossp using "public"'
	])

	assert.equal(context.logger.errors, [
		{
			type: 'table',
			name: 'core.lookups',
			errors: ['File missing for entity']
		},
		{
			type: 'table',
			name: 'staging.lookup_values',
			errors: ['File missing for entity']
		},
		{
			type: 'table',
			name: 'no_schema',
			errors: [
				'Use fully qualified name <schema>.<name>',
				'File missing for entity'
			]
		},
		{
			type: 'core',
			name: 'core.stuff',
			errors: [
				'Unknown or unsupported entity type.',
				'Unknown or unsupported entity ddl script.'
			]
		},
		{
			type: 'test',
			name: 'ddl.test',
			errors: [
				'Unknown or unsupported entity type.',
				'Unknown or unsupported entity ddl script.'
			]
		},
		{
			type: 'table',
			name: 'core.lookup_values',
			errors: ['File missing for entity']
		}
	])

	result = await context.db.query(schemas)
	assert.equal(result, beforeApply.schemas)
	result = await context.db.query(tables)
	assert.equal(result, beforeApply.tables)
})

test('Should apply the ddl scripts', async (context) => {
	const { beforeApply, afterApply } = context.collect
	const schemas = sql`select schema_name
	                      from information_schema.schemata
                       where schema_name in ('core', 'extensions', 'staging', 'migrate')`
	const tables = sql`select table_schema
                        	, table_name
	                        , table_type
                       from information_schema.tables
                      where table_schema in ('core', 'staging', 'migrate')
                      order by table_schema
                             , table_name`

	let result = await context.db.query(schemas)
	assert.equal(result, beforeApply.schemas)
	result = await context.db.query(tables)
	assert.equal(result, beforeApply.tables)

	await using('design.yaml', context.databaseURL).apply()

	assert.equal(context.logger.infos, [
		'Applying schema: core',
		'Applying schema: extensions',
		'Applying schema: staging',
		'Applying schema: migrate',
		'Applying extension: uuid-ossp',
		'Applying role: basic',
		'Applying role: advanced',
		'Applying table: core.lookups',
		'Applying table: staging.lookup_values',
		'Applying table: core.lookup_values',
		'Applying view: core.genders',
		'Applying view: migrate.lookup_values'
	])

	result = await context.db.query(schemas)
	assert.equal(result, afterApply.schemas)
	result = await context.db.query(tables)
	assert.equal(result, afterApply.tables)
})

test('Should validate data', (context) => {
	let dx = using('design.yaml').validate()

	assert.equal(dx.roles, context.collect.roles)
	assert.equal(dx.entities, context.collect.entities)
	assert.ok(dx.isValidated)
})

test('Should import data using psql', async (context) => {
	const dx = using('design.yaml', context.databaseURL).importData()

	context.logger.restore()
	assert.equal(context.logger.infos, [
		'Importing staging.lookup_values',
		'Processing import/loader.sql'
	])

	assert.ok(dx.isValidated)
	let result = await context.db.query(
		sql`select count(*) from staging.lookup_values`
	)
	assert.equal(result, [{ count: 2n }])

	result = await context.db.query(sql`select count(*) from core.lookups`)
	assert.equal(result, [{ count: 1n }])

	result = await context.db.query(sql`select count(*) from core.lookup_values`)
	assert.equal(result, [{ count: 2n }])
})

test('Should export data using psql', (context) => {
	const dx = using('design.yaml', context.databaseURL).exportData()

	assert.not(dx.isValidated)
	assert.ok(fs.existsSync('export'))
	assert.ok(fs.existsSync('export/core'))
	assert.ok(fs.existsSync('export/core/lookups.csv'))
	assert.ok(fs.existsSync('export/core/lookup_values.csv'))
	assert.ok(fs.existsSync('export/core/genders.csv'))
	assert.ok(fs.existsSync('export/migrate/lookup_values.csv'))
})

test('Should allow only staging tables in import', (context) => {
	process.chdir('../spec/fixtures/bad-example')
	const dx = using('design.yaml', context.databaseURL).validate()

	assert.equal(dx.importTables, context.validations.importTables)

	dx.entities.map((entity, index) => {
		assert.equal(entity, context.validations.entities[index])
	})
})

test('Should apply for single entity', async (context) => {
	// cleanup
	await context.db.query(sql`drop table staging.lookup_values;`)

	await using('design.yaml', context.databaseURL).apply('staging.lookup_values')

	assert.equal(context.logger.infos, ['Applying table: staging.lookup_values'])

	let result = await context.db.query(
		sql`select count(*)
          from information_schema.tables
         where table_schema = 'staging'
				   and table_name = 'lookup_values'`
	)
	assert.equal(result, [{ count: 1n }])
})

test('Should import a single entity using entity name', async (context) => {
	// cleanup
	await context.db.query(sql`delete from core.lookup_values;`)
	await context.db.query(sql`delete from core.lookups;`)
	await context.db.query(sql`delete from staging.lookup_values;`)

	using('design.yaml', context.databaseURL).importData('staging.lookup_values')
	// context.logger.restore()
	// console.log(context.logger.infos)
	assert.equal(context.logger.infos, [
		'Importing staging.lookup_values',
		'Processing import/loader.sql'
	])
	let result = await context.db.query(
		sql`select count(*) from staging.lookup_values`
	)

	assert.equal(result, [{ count: 2n }])
	result = await context.db.query(sql`select count(*) from core.lookups`)
	assert.equal(result, [{ count: 1n }])
	result = await context.db.query(sql`select count(*) from core.lookup_values`)
	assert.equal(result, [{ count: 2n }])
})

test('Should skip import when invalid name or file is provided', async (context) => {
	// cleanup
	await context.db.query(sql`delete from core.lookup_values;`)
	await context.db.query(sql`delete from core.lookups;`)
	await context.db.query(sql`delete from staging.lookup_values;`)

	using('design.yaml', context.databaseURL).importData(
		'import/staging/lookup_values'
	)
	let result = await context.db.query(
		sql`select count(*) from staging.lookup_values`
	)
	assert.equal(result, [{ count: 0n }])
	result = await context.db.query(sql`select count(*) from core.lookups`)
	assert.equal(result, [{ count: 0n }])
	result = await context.db.query(sql`select count(*) from core.lookup_values`)
	assert.equal(result, [{ count: 0n }])
})

test('Should import single entity using filepath', async (context) => {
	// cleanup
	await context.db.query(sql`delete from core.lookup_values;`)
	await context.db.query(sql`delete from core.lookups;`)
	await context.db.query(sql`delete from staging.lookup_values;`)

	using('design.yaml', context.databaseURL).importData(
		'import/staging/lookup_values.csv'
	)
	let result = await context.db.query(
		sql`select count(*) from staging.lookup_values`
	)
	assert.equal(result, [{ count: 2n }])
	result = await context.db.query(sql`select count(*) from core.lookups`)
	assert.equal(result, [{ count: 1n }])
	result = await context.db.query(sql`select count(*) from core.lookup_values`)
	assert.equal(result, [{ count: 2n }])
})

test('Should export a single entity by name', (context) => {
	using('design.yaml', context.databaseURL).exportData('core.unknown')
	assert.not(
		fs.existsSync('export/core/genders.csv'),
		'core.genders.csv should not exist'
	)
	assert.not(
		fs.existsSync('export/core/lookups.csv'),
		'core.lookups.csv should not exist'
	)
	assert.not(
		fs.existsSync(
			'export/core/lookup_values.csv',
			'core.lookup_values.csv should not exist'
		)
	)

	using('design.yaml', context.databaseURL).exportData('core.genders')
	assert.ok(
		fs.existsSync('export/core/genders.csv'),
		'Selected export file should exist'
	)
	assert.not(
		fs.existsSync('export/core/lookups.csv'),
		'core.lookups.csv should not exist'
	)
	assert.not(
		fs.existsSync('export/core/lookup_values.csv'),
		'core.lookup_values.csv should not exist'
	)
})

test('Should report zero issues in example', (context) => {
	let issues = using('design.yaml', context.databaseURL).validate().report()
	assert.equal(issues, [])
	issues = using('design.yaml', context.databaseURL).report()
	assert.equal(issues, [])
})

test.run()
