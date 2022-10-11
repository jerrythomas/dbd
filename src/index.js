#!/usr/bin/env node
import sade from 'sade'
import { execSync } from 'child_process'
import { using } from './collect.js'

const prog = sade('dbd')

prog
	.version('1.0.1-beta.0')
	.option('-c, --config', 'Provide path to custom config', 'design.yaml')
	.option(
		'-d, --database',
		'Database URL',
		(process.env.DATABASE_URL || '').replace(/\$/, '\\$')
	)
	.option('-e, --environment', 'Environment to load data', 'development')
	.option('-p, --preview', 'Preview the action', false)

prog
	.command('init')
	.option('-p, --project', 'Name of the project', 'database')
	.describe('Initialize a starter project')
	.example('dbd init')
	.example('dbd init -p app')
	.action((opts) => {
		execSync(`npx degit jerrythomas/dbd/example ${opts.project}`)
	})

prog
	.command('inspect')
	.describe('Inspect the current folder.')
	.example('dbd inspect')
	.action((opts) => {
		const issues = using(opts.config, opts.database).validate().report()
		if (issues.length > 0) {
			console.log(issues.join('\n'))
		} else {
			console.log('Everything looks ok')
		}
	})

prog
	.command('apply')
	.option('-n, --name', 'apply a specific entity or file only')
	.option('--dry-run', 'just print the entities', false)
	.describe('Apply the database scripts to database.')
	.example('dbd apply')
	.example('dbd apply -c database.yaml')
	.example('dbd apply -d postgres://localhost:5432')
	.action((opts) => {
		using(opts.config, opts.database).apply(opts.name, opts['dry-run'])
	})

prog
	.command('combine')
	.option('-f, --file', 'Destination sql file', 'init.sql')
	.describe('Combine all ddl scripts into one script.')
	.example('dbd combine')
	.example('dbd combine -f init.sql')
	.action((opts) => {
		using(opts.config, opts.database).combine(opts.file)
		console.log(`Generated ${opts.file}`)
	})

prog
	.command('import')
	.option('-n, --name', 'Optional name or file to be imported.')
	.describe('Load csv files into database')
	.example('dbd import')
	.example('dbd import -n staging.lookups')
	.example('dbd import -n import/staging/lookups.csv')
	.action((opts) => {
		using(opts.config, opts.database).importData(opts.name)
		console.log('Import complete.')
	})

prog
	.command('export')
	.option('-n, --name', 'Name of specific entity to export.')
	.describe('Export specific tables from the database')
	.example('dbd export')
	.example('dbd export -n staging.lookups')
	.action((opts) => {
		using(opts.config, opts.database).exportData(opts.name)
		console.log('Export complete.')
	})

prog
	.command('dbml')
	.option('-f, --file', 'Destination dbml file', 'design.dbml')
	.describe('Combine table ddl scripts and generate dbml.')
	.example('dbd dbml')
	.example('dbd dbml -f design.dbml')
	.action((opts) => {
		using(opts.config, opts.database).dbml(opts.file)
	})

prog.parse(process.argv)
