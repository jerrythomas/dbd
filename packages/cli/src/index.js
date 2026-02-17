#!/usr/bin/env node

/**
 * dbd-cli — CLI entry point.
 *
 * Same commands and options as src/index.js but wired to new packages.
 */
import fs from 'fs'
import path from 'path'
import sade from 'sade'
import { execSync } from 'child_process'
import { using } from './design.js'
import { resolveWarnings } from './references.js'
import { DbReferenceCache } from './db-cache.js'

const location = path.dirname(new URL(import.meta.url).pathname)
const pkg = JSON.parse(fs.readFileSync(path.join(location, '../package.json'), 'utf8'))

const prog = sade('dbd-cli')

prog
	.version(pkg.version)
	.option('-c, --config', 'Provide path to custom config', 'design.yaml')
	.option('-d, --database', 'Database URL', (process.env.DATABASE_URL || '').replace(/\$/, '\\$'))
	.option('-e, --environment', 'Environment to load data', 'development')
	.option('-p, --preview', 'Preview the action', false)

prog
	.command('init')
	.option('-p, --project', 'Name of the project', 'database')
	.describe('Initialize a starter project')
	.example('dbd-cli init')
	.example('dbd-cli init -p app')
	.action((opts) => {
		execSync(`npx degit jerrythomas/dbd/example ${opts.project}`)
	})

prog
	.command('inspect')
	.option('-n, --name', 'Name of specific entity to inspect.')
	.option('-vv, --verbose', 'Verbose output', false)
	.option('--no-cache', 'Skip DB reference cache', false)
	.describe('Inspect the current folder.')
	.example('dbd-cli inspect')
	.action(async (opts) => {
		const design = using(opts.config, opts.database).validate()

		// If a database URL is available, resolve warnings against the DB catalog
		if (opts.database) {
			try {
				const adapter = await design.getAdapter()
				const connected = await adapter.testConnection()
				if (connected) {
					const dbResolver = new DbReferenceCache(adapter, opts.database)
					if (!opts['no-cache']) dbResolver.load()
					const entities = await resolveWarnings(design.config.entities, dbResolver)
					design.updateEntities(entities)
					dbResolver.save()
				}
			} catch {
				// DB not available — continue with static resolution only
			}
		}

		const { entity, issues, warnings } = design.report(opts.name)

		if (entity) console.log(JSON.stringify(entity, null, 2))

		const showDetails = (item, key, verbose) => {
			let details = `\n${item.file ? item.file : item.name} =>\n  ${item[key].join('\n  ')}`
			if (verbose) details += `\n${JSON.stringify(item, null, 2)}`
			return details
		}
		if (issues.length > 0) {
			console.log('Errors:')
			issues.map((item) => console.log(showDetails(item, 'errors', opts.verbose)))
		}
		if (warnings.length > 0) {
			console.log('\nWarnings:')
			warnings.map((item) => console.log(showDetails(item, 'warnings', opts.verbose)))
		}
		if (issues.length === 0 && warnings.length === 0) {
			console.log('Everything looks ok')
		}
	})

prog
	.command('apply')
	.option('-n, --name', 'apply a specific entity or file only')
	.option('--dry-run', 'just print the entities', false)
	.describe('Apply the database scripts to database.')
	.example('dbd-cli apply')
	.example('dbd-cli apply -c database.yaml')
	.example('dbd-cli apply -d postgres://localhost:5432')
	.action((opts) => {
		using(opts.config, opts.database).apply(opts.name, opts['dry-run'])
	})

prog
	.command('combine')
	.option('-f, --file', 'Destination sql file', 'init.sql')
	.describe('Combine all ddl scripts into one script.')
	.example('dbd-cli combine')
	.example('dbd-cli combine -f init.sql')
	.action((opts) => {
		using(opts.config, opts.database).combine(opts.file)
		console.log(`Generated ${opts.file}`)
	})

prog
	.command('import')
	.option('-n, --name', 'Optional name or file to be imported.')
	.option('--dry-run', 'just print the entities', false)
	.describe('Load csv files into database')
	.example('dbd-cli import')
	.example('dbd-cli import -n staging.lookups')
	.example('dbd-cli import -n import/staging/lookups.csv')
	.action((opts) => {
		using(opts.config, opts.database).importData(opts.name, opts['dry-run'])
		console.log('Import complete.')
	})

prog
	.command('export')
	.option('-n, --name', 'Name of specific entity to export.')
	.describe('Export specific tables from the database')
	.example('dbd-cli export')
	.example('dbd-cli export -n staging.lookups')
	.action((opts) => {
		using(opts.config, opts.database).exportData(opts.name)
		console.log('Export complete.')
	})

prog
	.command('dbml')
	.option('-f, --file', 'Destination dbml file', 'design.dbml')
	.describe('Combine table ddl scripts and generate dbml.')
	.example('dbd-cli dbml')
	.example('dbd-cli dbml -f design.dbml')
	.action((opts) => {
		using(opts.config, opts.database).dbml(opts.file)
	})

prog.parse(process.argv)
