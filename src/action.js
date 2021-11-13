import { execSync } from 'child_process'

import {
	readConfig,
	getScripts,
	getSchemas,
	regroup,
	sortGroups
} from './scripts.js'

export function inspect(opts) {
	let config = readConfig(opts.config)
	let scripts = getScripts()

	let groups = [
		scripts.ddl.reduce((obj, item) => ((obj[item.name] = item), obj), {})
	]
	const refs = config.dependencies.reduce(
		(obj, item) => ((obj[item.name] = item), obj),
		{}
	)
	groups = regroup(groups, refs)
	groups = sortGroups(groups)

	config.schemas = getSchemas(config, scripts.ddl)
	config.groups = groups

	return config
}

export async function apply(opts) {
	let commands = []

	const config = inspect(opts)

	if ('extensions' in config) {
		config.extensions.map(async (name) => {
			const command = `echo 'create extension if not exists "${name}" with schema extensions;' | psql ${opts.database}`
			commands.push({ command, name, action: 'create', type: 'extension' })
		})
	}

	config.schemas.map((name) => {
		const command = `echo "create schema if not exists ${name};" | psql ${opts.database}`
		commands.push({ command, name, action: 'create', type: 'schema' })
	})

	config.groups.map((group, index) => {
		// console.log(`apply group ${index}`)
		group.map((object) => {
			const command = `psql ${opts.database} < ${object.file}`
			commands.push({ command, ...object, action: 'create' })
		})
	})

	run(commands)
}

export function rollback(opts, drops = true) {
	let commands = []
	const config = inspect(opts)

	if (drops) {
		for (let index = config.groups.length; index > 0; index--) {
			config.groups[index - 1].map((object) => {
				const command = `echo "drop ${object.type} if exists ${object.name};" | psql ${opts.database}`
				commands.push({ ...object, command, action: 'drop' })
			})
		}
		config.schemas.map((name) => {
			const command = `echo "drop schema if exists ${name};" | psql ${opts.database}`
			commands.push({ command, name, type: 'schema', action: 'drop' })
		})
	} else {
		// run scripts from rollback in the reverse order of groups
		for (let index = config.groups.length; index > 0; index--) {
			config.groups[index - 1].map((object) => {
				const command = `psql ${opts.database} rollback/${object.file}`
				commands.push({ ...object, command, action: 'rollback' })
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

export function load(opts) {
	console.log(opts)
}

function run(objects) {
	objects.forEach((object) => {
		console.log(`${object.action} => ${object.type}: ${object.name}`)
		try {
			const { stdout, stderr } = execSync(object.command)
			if (stderr) console.error(stderr)
			if (stdout) console.log(stdout)
		} catch (err) {
			console.error(err.message)
		}
	})
}
