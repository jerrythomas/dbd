import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

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

export function inspect(opts) {
	let config = readConfig(opts.config)
	let scripts = getScripts()

	let groups = [
		scripts.reduce((obj, item) => ((obj[item.name] = item), obj), {})
	]
	const refs = config.dependencies.reduce(
		(obj, item) => ((obj[item.name] = item), obj),
		{}
	)
	groups = regroup(groups, refs)
	groups = sortGroups(groups)

	config.schemas = getSchemas(config, scripts)
	config.groups = groups

	return config
}

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
				const command = `echo 'create extension if not exists "${name}" with schema extensions;' | psql ${opts.database}`
				commands.push({
					command,
					message: `create => extension: ${name}`
				})
			})
		}

		config.schemas.map((name) => {
			const command = `echo "create schema if not exists ${name};" | psql ${opts.database}`
			commands.push({
				command,
				message: `create => extension: ${name}`
			})
		})

		config.groups.map((group, index) => {
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
	run(commands)
}

export function rollback(opts, drops = true) {
	let commands = []
	const config = inspect(opts)

	if (drops) {
		for (let index = config.groups.length; index > 0; index--) {
			config.groups[index - 1].map((object) => {
				const command = `echo "drop ${object.type} if exists ${object.name};" | psql ${opts.database}`
				commands.push({
					command,
					message: `drop => ${object.type}:${object.name}`
				})
			})
		}
		config.schemas.map((name) => {
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

	run(commands)
}

export function migrate(opts) {
	const config = inspect(opts)
	// compare with db and identify if object already exists and if yes create the rollback
	// if object is view, function or procedure (fetch current code from db and create backup)
	// For tables if it does not exist create drop scripts else create alter scripts for apply and rollback
}
export function combine(opts) {
	console.log(opts)
}

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

export function importCSV(opts) {
	const config = yaml.load(fs.readFileSync(opts.file, 'utf8'))
	const loadStaging = opts['raw-only'] || !opts['seed-only']
	const loadSeeded = opts['seed-only'] || !opts['raw-only']

	if (loadSeeded) {
		runImport(config.seed, opts)
	}

	if (loadStaging) {
		runImport(config.load, opts)
	}

	// const files = getAllFiles('./import', [], '.*.csv$').map((file) => {
	// 	const name =
	// 		file.split(path.sep)[1] + '.' + path.basename(file).replace('.csv', '')
	// 	const schema = file.split(path.sep)[1]
	// 	return { name, file, schema }
	// })

	// if (loadStaging) {
	// 	let commands = []

	// 	files
	// 		.filter((item) => config.load.schemas.includes(item.schema))
	// 		.map((item) => {
	// 			commands.push(`\\echo import => ${item.name}`)
	// 			commands.push(
	// 				`\\copy ${item.name} from '${item.file}' with delimiter ',' csv header;`
	// 			)
	// 		})
	// 	writeScript('import/load.sql', commands)
	// 	const scripts = getImportScripts(config.load, opts)
	// 	commands = [
	// 		...scripts.before,
	// 		{
	// 			command: `psql ${opts.database} < import/load.sql`,
	// 			message: 'import => staging data'
	// 		},
	// 		...scripts.after
	// 	]
	// 	run(commands)
	// 	fs.unlinkSync('import/load.sql')
	// }

	// if (loadSeeded) {
	// 	let commands = []
	// 	config.seed.tables
	// 		.map((name) => ({
	// 			name,
	// 			file: 'import/' + name.replace('.', path.sep) + '.csv'
	// 		}))
	// 		.map((item) => {
	// 			commands.push(`\\echo import => ${item.name}`)
	// 			commands.push(
	// 				`\\copy ${item.name} from '${item.file}' with delimiter ',' csv header;`
	// 			)
	// 		})
	// 	writeScript('import/load.sql', commands)

	// 	const scripts = getImportScripts(config.seed, opts)
	// 	commands = [
	// 		...scripts.before,
	// 		{
	// 			command: `psql ${opts.database} < import/load.sql`,
	// 			message: 'import => seeded data'
	// 		},
	// 		...scripts.after
	// 	]

	// 	run(commands)
	// 	fs.unlinkSync('import/load.sql')
	// }
}

function runImport(config, opts) {
	const scripts = getImportScripts(config, opts)
	const load = generateLoadScript(config, opts)
	const commands = [...scripts.before, ...load, ...scripts.after]

	run(commands)

	if (load.length > 0) fs.unlinkSync(IMPORT_SQL_FILE)
}

function generateLoadScript(config, opts) {
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
	files.map((item) => {
		commands.push(`\\echo import => ${item.name}`)
		commands.push(
			`\\copy ${item.name} from '${item.file}' with delimiter ',' csv header;`
		)
	})

	// console.log(files)
	// console.log(commands)
	if (commands.length > 0) {
		writeScript(IMPORT_SQL_FILE, commands)
		return [{ command: `psql ${opts.database} < ${IMPORT_SQL_FILE}` }]
	}

	return []
}

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

function run(objects) {
	objects.forEach(({ command, message }) => {
		if (message) console.log(message)
		try {
			// console.log(object.command)
			execSync(command, { stdio: [0, 1, 2] })
		} catch (err) {
			console.error(err.message)
		}
	})
}
