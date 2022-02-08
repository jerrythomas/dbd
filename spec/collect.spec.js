import fs from 'fs'
import yaml from 'js-yaml'
import rimraf from 'rimraf'

import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import createConnectionPool, { sql } from '@databases/pg'

import { using } from '../src/collect.js'

const CollectorSuite = suite('Suite for collector')

CollectorSuite.before((context) => {
	context.databaseURL = 'postgres://test-user@localhost:5432/test-db'
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

CollectorSuite.after(async (context) => {
	await context.db.dispose()
})
CollectorSuite.before.each((context) => {
	process.chdir('example')
	rimraf.sync('export')
})

CollectorSuite.after.each((context) => {
	process.chdir(context.path)
})

CollectorSuite('Should initialize collection', (context) => {
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

CollectorSuite('Should combine scripts and generate file', (context) => {
	using('design.yaml').combine(context.combinedDDL)
	assert.ok(fs.existsSync(context.combinedDDL))
	fs.unlinkSync(context.combinedDDL)
})

CollectorSuite('Should combine scripts and generate dbml', (context) => {
	using('design.yaml').dbml()
	assert.ok(fs.existsSync('design.dbml'))
	fs.unlinkSync('design.dbml')
})

CollectorSuite('Should apply the ddl scripts', async (context) => {
	const { beforeApply, afterApply } = context.collect
	const schemas = sql`select schema_name
	                      from information_schema.schemata
                       where schema_name in ('core', 'extensions', 'staging')`
	const tables = sql`select table_schema
                        	, table_name
	                        , table_type
                       from information_schema.tables
                      where table_schema in ('core', 'staging')`

	let result = await context.db.query(schemas)
	assert.equal(result, beforeApply.schemas)
	result = await context.db.query(tables)
	assert.equal(result, beforeApply.tables)

	await using('design.yaml', context.databaseURL).apply()

	result = await context.db.query(schemas)
	assert.equal(result, afterApply.schemas)
	result = await context.db.query(tables)
	assert.equal(result, afterApply.tables)
})

CollectorSuite('Should validate data', (context) => {
	let dx = using('design.yaml').validate()

	assert.equal(dx.roles, context.collect.roles)
	assert.equal(dx.entities, context.collect.entities)
	assert.ok(dx.isValidated)
})

CollectorSuite('Should import data using psql', async (context) => {
	const dx = using('design.yaml', context.databaseURL).importData()
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

CollectorSuite('Should export data using psql', (context) => {
	const dx = using('design.yaml', context.databaseURL).exportData()

	assert.not(dx.isValidated)
	assert.ok(fs.existsSync('export'))
	assert.ok(fs.existsSync('export/core'))
	assert.ok(fs.existsSync('export/core/lookups.csv'))
	assert.ok(fs.existsSync('export/core/lookup_values.csv'))
	assert.ok(fs.existsSync('export/core/genders.csv'))
})

CollectorSuite('Should allow only staging tables in import', (context) => {
	process.chdir('../spec/fixtures/bad-example')
	const dx = using('design.yaml', context.databaseURL).validate()
	assert.equal(dx.importTables, context.validations.importTables)
	assert.equal(dx.entities, context.validations.entities)
})

CollectorSuite('Should apply for single entity', async (context) => {
	// cleanup
	await context.db.query(sql`drop table staging.lookup_values;`)
	using('design.yaml', context.databaseURL).apply('staging.lookup_values')
	let result = await context.db.query(
		sql`select count(*)
          from information_schema.tables
         where table_schema = 'staging'
				   and table_name = 'lookup_values'`
	)
	assert.equal(result, [{ count: 1n }])
})

CollectorSuite(
	'Should import a single entity using entity name',
	async (context) => {
		// cleanup
		await context.db.query(sql`delete from core.lookup_values;`)
		await context.db.query(sql`delete from core.lookups;`)
		await context.db.query(sql`delete from staging.lookup_values;`)

		using('design.yaml', context.databaseURL).importData(
			'staging.lookup_values'
		)
		let result = await context.db.query(
			sql`select count(*) from staging.lookup_values`
		)

		assert.equal(result, [{ count: 2n }])
		result = await context.db.query(sql`select count(*) from core.lookups`)
		assert.equal(result, [{ count: 1n }])
		result = await context.db.query(
			sql`select count(*) from core.lookup_values`
		)
		assert.equal(result, [{ count: 2n }])
	}
)

CollectorSuite(
	'Should skip import when invalid name or file is provided',
	async (context) => {
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
		result = await context.db.query(
			sql`select count(*) from core.lookup_values`
		)
		assert.equal(result, [{ count: 0n }])
	}
)

CollectorSuite(
	'Should import single entity using filepath',
	async (context) => {
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
		result = await context.db.query(
			sql`select count(*) from core.lookup_values`
		)
		assert.equal(result, [{ count: 2n }])
	}
)

CollectorSuite('Should export a single entity by name', (context) => {
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

CollectorSuite('Should report zero issues in example', (context) => {
	let issues = using('design.yaml', context.databaseURL).validate().report()
	assert.equal(issues, [])
	issues = using('design.yaml', context.databaseURL).report()
	assert.equal(issues, [])
})

CollectorSuite.run()
