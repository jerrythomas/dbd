import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { run } from './runner.js'
import {
	readConfig,
	getScripts,
	getSchemas,
	getAllFiles,
	regroup,
	sortGroups,
	writeScript
} from './scripts.js'

const IMPORT_SQL_FILE = 'import/_load.sql'
const EXPORT_SQL_FILE = 'export/_dump.sql'

/**
 *
 * @param {*} opts
 * @returns
 */
export function inspect(opts) {
	let config = readConfig(opts.config)
	let scripts = getScripts()

	// let groups =

	// const refs = config.dependencies.reduce(
	// 	(obj, item) => ((obj[item.name] = item), obj),
	// 	{}
	// )
	let groups = regroup(scripts, config.dependencies)
	groups = sortGroups(groups)

	config.schemas = getSchemas(config, scripts)
	config.groups = groups

	return config
}

/**
 *
 * @param {*} opts
 */
export function apply(opts) {
	let commands = []

	if (opts.file) {
		if (fs.existsSync(opts.file)) {
			let parts = opts.file.split(path.sep)
			commands.push({
				command: `psql ${opts.database} < ${opts.file}`,
				message: `create => ${parts[1]}: ${parts[2]}.${parts[3].replace(
					'.ddl',
					''
				)}`
			})
		}
	} else {
		const config = inspect(opts)

		if ('extensions' in config) {
			config.extensions.map((name) => {
				commands.push({
					command: `echo 'create schema if not exists extensions;' | psql ${opts.database}`,
					message: `create => schema: extensions`
				})
				commands.push({
					command: `echo 'create extension if not exists "${name}" with schema extensions;' | psql ${opts.database}`,
					message: `create => extension: ${name}`
				})
			})
		}

		config.schemas.map((name) => {
			const command = `echo "create schema if not exists ${name};" | psql ${opts.database}`
			commands.push({
				command,
				message: `create => schema: ${name}`
			})
		})

		config.groups.map((group) => {
			// console.log(`apply group ${index}`)
			group.map((object) => {
				const command = `psql ${opts.database} < ${object.file}`
				commands.push({
					command,
					message: `create => ${object.type}: ${object.name}`
				})
			})
		})
	}

	// console.log(commands)
	run(commands, opts.preview)
}

/**
 *
 * @param {*} opts
 * @param {*} drops
 */
export function rollback(opts, drops = true) {
	let commands = []
	const config = inspect(opts)
	const excludeSchemas = config.exclude?.drops?.schemas || []

	if (drops) {
		for (let index = config.groups.length; index > 0; index--) {
			config.groups[index - 1]
				// .filter((object) => !excludeSchemas.includes(object.schema))
				.map((object) => {
					const command = `echo "drop ${object.type} if exists ${object.name};" | psql ${opts.database}`
					commands.push({
						command,
						message: `drop => ${object.type}:${object.name}`
					})
				})
		}
		config.schemas
			.filter((name) => !excludeSchemas.includes(name))
			.map((name) => {
				const command = `echo "drop schema if exists ${name};" | psql ${opts.database}`
				commands.push({ command, message: `drop => schema:${name}` })
			})
	} else {
		// run scripts from rollback in the reverse order of groups
		for (let index = config.groups.length; index > 0; index--) {
			config.groups[index - 1].map((object) => {
				const command = `psql ${opts.database} rollback/${object.file}`
				commands.push({
					command,
					message: `rollback => ${object.type}:${object.name}`
				})
			})
		}
	}

	run(commands, opts.preview)
}

/**
 *
 * @param {*} opts
 */
export function migrate(opts) {
	const config = inspect(opts)
	// compare with db and identify if object already exists and if yes create the rollback
	// if object is view, function or procedure (fetch current code from db and create backup)
	// For tables if it does not exist create drop scripts else create alter scripts for apply and rollback
}

/**
 *
 * @param {*} opts
 */
export function combine(opts) {
	const config = inspect(opts)
	const combinedFile = '_combined.ddl'
	const excludeSchemas = config.exclude?.dbdocs?.schemas || []
	let commands = [{ command: `touch ${combinedFile}` }]

	if (fs.existsSync(`${combinedFile}`)) fs.unlinkSync(combinedFile)
	config.groups.map((group) => {
		group
			.filter((item) => item.type === 'table')
			.filter((item) => !excludeSchemas.includes(item.schema))
			.map((object) => {
				commands.push({ command: `cat ${object.file} >> ${combinedFile}` })
			})
	})
	commands.push({
		command: `sql2dbml ${combinedFile} --postgres -o ${opts.file}`
	})
	run(commands, opts.preview)

	fs.unlinkSync('_combined.ddl')
}

/**
 *
 * @param {*} opts
 */
export function exportCSV(opts) {
	const names = yaml.load(fs.readFileSync(opts.file, 'utf8'))

	let commands = []
	names.map((name) => {
		const folder = `export/${name.split('.')[0]}`
		const file = `export/${name.replace('.', '/')}.csv`
		commands.push(`\\echo export ${name}`)
		commands.push(
			`\\copy (select * from ${name}) to '${file}' with delimiter ',' csv header;`
		)

		if (!fs.existsSync(folder)) {
			fs.mkdirSync(folder, { recursive: true })
		}
	})
	// console.log(commands)
	writeScript(EXPORT_SQL_FILE, commands)
	run([
		{
			command: `psql ${opts.database} < ${EXPORT_SQL_FILE}`,
			message: 'export data'
		}
	])
	fs.unlinkSync(EXPORT_SQL_FILE)
	// console.log(commands)
}

/**
 *
 * @param {*} opts
 */
export function importCSV(opts) {
	const config = yaml.load(fs.readFileSync(opts.file, 'utf8'))
	const loadStaging = opts['raw-only'] || !opts['seed-only']
	const loadSeeded = opts['seed-only'] || !opts['raw-only']

	if (loadSeeded) {
		runImport(config.seed, opts)
	}

	if (loadStaging) {
		runImport(config.load, opts, true)
	}
}

/**
 *
 * @param {*} config
 * @param {*} opts
 */
function runImport(config, opts, staging = false) {
	const scripts = getImportScripts(config, opts)
	const load = generateLoadScript(config, opts, staging)
	const commands = [...scripts.before, ...load, ...scripts.after]

	run(commands, opts.preview)

	if (load.length > 0) fs.unlinkSync(IMPORT_SQL_FILE)
}

/**
 *
 * @param {*} config
 * @param {*} opts
 * @returns
 */
function generateLoadScript(config, opts, staging = false) {
	let files = []
	if ('tables' in config) {
		files = config.tables.map((table) => ({
			name: table,
			file: 'import/' + table.replace('.', path.sep) + '.csv'
		}))
	} else if ('schemas' in config) {
		files = getAllFiles('./import', [], '.*.csv$')
			.map((file) => ({
				name:
					file.split(path.sep)[1] +
					'.' +
					path.basename(file).replace('.csv', ''),
				schema: file.split(path.sep)[1],
				file
			}))
			.filter((item) => config.schemas.includes(item.schema))
	}
	let commands = []

	const null_value = config.options?.null_value || ''
	const truncate = staging && (config.options?.before?.truncate || false)
	files.map((item) => {
		if (truncate) {
			commands.push(`\\echo truncate => ${item.name}`)
			commands.push(`truncate table ${item.name};`)
		}
		commands.push(`\\echo import => ${item.name}`)
		commands.push(
			`\\copy ${item.name} from '${item.file}' with delimiter ',' NULL as '${null_value}' csv header;`
		)
	})

	if (commands.length > 0) {
		writeScript(IMPORT_SQL_FILE, commands)
		commands = []
		return [{ command: `psql ${opts.database} < ${IMPORT_SQL_FILE}` }]
	}

	return []
}

/**
 *
 * @param {*} config
 * @param {*} opts
 * @returns
 */
function getImportScripts(config, opts) {
	let scripts = {
		before: [],
		after: []
	}

	Object.keys(scripts).map((key) => {
		if (key in config) {
			config[key].map((file) => {
				scripts[key].push({
					command: `psql ${opts.database} < import/${file}`,
					message: `${key} import => run import/${file}`
				})
			})
		}
	})

	return scripts
}
