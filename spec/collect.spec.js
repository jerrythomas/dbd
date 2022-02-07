import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import fs from 'fs'
import yaml from 'js-yaml'
import createConnectionPool, { sql } from '@databases/pg'
import rimraf from 'rimraf'
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
		fs.readFileSync('spec/fixtures/export.yaml', 'utf8')
	)
	context.collect = yaml.load(fs.readFileSync('spec/fixtures/d1.yaml', 'utf8'))
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

CollectorSuite('Should only validate staging tables in import', (context) => {})
CollectorSuite('Should log error for failure in script', (context) => {})

CollectorSuite.run()
