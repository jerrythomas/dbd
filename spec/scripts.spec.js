import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import * as scripts from '../src/scripts.js'
import { IMPORT_SQL_FILE } from '../src/action.js'
import fs, { write } from 'fs'
import yaml from 'js-yaml'

const HelperSuite = suite('Utility functions')

HelperSuite.before(async (context) => {
	fs.unlinkSync(path.join('example', IMPORT_SQL_FILE))
	try {
		const data = yaml.load(fs.readFileSync('spec/fixtures/helper.yaml', 'utf8'))

		Object.keys(data).forEach((key) => (context[key] = data[key]))

		context.config = yaml.load(fs.readFileSync('example/db.yml', 'utf8'))
		context.sorting = yaml.load(
			fs.readFileSync('spec/fixtures/sorting.yaml', 'utf8')
		)
		context.regroup = yaml.load(
			fs.readFileSync('spec/fixtures/regroup.yaml', 'utf8')
		)
	} catch (err) {
		console.error(err)
	}
})

HelperSuite(
	'Should handle sort order for different object types',
	(context) => {
		Object.keys(scripts.dbtypes).map((type) => {
			assert.equal(scripts.getSortOrder(type), scripts.dbtypes[type])
		})

		assert.equal(scripts.getSortOrder('unknown'), 99)
	}
)

HelperSuite('Should fetch a list of all files', (context) => {
	const files = scripts.getAllFiles('example')
	assert.equal(files, context.files)
})

HelperSuite('Should fetch only ddl files', (context) => {
	const currentPath = process.cwd()
	process.chdir('example')

	assert.equal(scripts.getScripts(), context.scripts)
	process.chdir(currentPath)
})

HelperSuite('Should read config file', (context) => {
	const config = scripts.readConfig('example/db.yml')
	assert.equal(config, context.config)

	assert.throws(
		() => scripts.readConfig('example'),
		/Couldn't find config file/
	)
	assert.throws(
		() => scripts.readConfig('unknown'),
		/Couldn't find config file/
	)
})

HelperSuite('Should fetch schemas from config', (context) => {
	let schemas = scripts.getSchemas(context.config, context.scripts)
	assert.equal(schemas, context.schemas)
	delete context.config.schemas
	schemas = scripts.getSchemas(context.config, context.scripts)
	assert.equal(schemas, ['core'])
})

HelperSuite('Should sort by type within group', (context) => {
	context.sorting.map(({ input, expected }) => {
		const sorted = scripts.sortGroups(input)
		assert.equal(sorted, expected)
	})
})

HelperSuite('Should regroup based on dependencies', (context) => {
	const result = scripts.regroup(
		context.regroup.scripts,
		context.regroup.dependencies
	)
	assert.equal(result, context.regroup.expected)
})

HelperSuite('Should write script', (context) => {
	const file = 'test.txt'
	const lines = ['one', 'two', 'three']

	if (fs.existsSync(file)) fs.unlinkSync(file)

	assert.not(fs.existsSync(file))
	scripts.writeScript(file, lines)
	assert.ok(fs.existsSync(file))
	const data = fs.readFileSync(file).toString()
	assert.equal(data, 'one\r\ntwo\r\nthree\r\n')
	fs.unlinkSync(file)
})

HelperSuite.run()
