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
import { normalizeEnv } from './config.js'
import {
	createSnapshot,
	listSnapshots,
	latestSnapshot,
	pendingMigrations,
	padVersion
} from './snapshot.js'

const location = path.dirname(new URL(import.meta.url).pathname)
const pkg = JSON.parse(fs.readFileSync(path.join(location, '../package.json'), 'utf8'))

const prog = sade('dbd')

prog
	.version(pkg.version)
	.option('-c, --config', 'Provide path to custom config', 'design.yaml')
	.option('-d, --database', 'Database URL', (process.env.DATABASE_URL || '').replace(/\$/, '\\$'))
	.option('-e, --environment', 'Environment to load data', 'prod')
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
	.option('-n, --name', 'Name of specific entity to inspect.')
	.option('-vv, --verbose', 'Verbose output', false)
	.option('--no-cache', 'Skip DB reference cache', false)
	.describe('Inspect the current folder.')
	.example('dbd inspect')
	.action(async (opts) => {
		const design = (await using(opts.config, opts.database)).validate()

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
	.option(
		'--target',
		'output target: leave unset for postgres, or "convex" to generate schema.ts',
		null
	)
	.describe('Apply the database scripts to database.')
	.example('dbd apply')
	.example('dbd apply --target=convex')
	.example('dbd apply --target=convex --dry-run')
	.action(async (opts) => {
		await (await using(opts.config, opts.database)).apply(opts.name, opts['dry-run'], opts.target)
	})

prog
	.command('combine')
	.option('-f, --file', 'Destination sql file', 'init.sql')
	.describe('Combine all ddl scripts into one script.')
	.example('dbd combine')
	.example('dbd combine -f init.sql')
	.action(async (opts) => {
		;(await using(opts.config, opts.database)).combine(opts.file)
		console.log(`Generated ${opts.file}`)
	})

prog
	.command('import')
	.option('-n, --name', 'Optional name or file to be imported.')
	.option('--dry-run', 'just print the entities', false)
	.option(
		'--target',
		'output target: leave unset for postgres, or "convex" to seed via npx convex import',
		null
	)
	.describe('Load csv files into database')
	.example('dbd import')
	.example('dbd import -n staging.lookups')
	.example('dbd import --target=convex')
	.action(async (opts) => {
		const env = normalizeEnv(opts.environment)
		await (
			await using(opts.config, opts.database, env)
		).importData(opts.name, opts['dry-run'], opts.target)
		console.log('Import complete.')
	})

prog
	.command('export')
	.option('-n, --name', 'Name of specific entity to export.')
	.describe('Export specific tables from the database')
	.example('dbd export')
	.example('dbd export -n staging.lookups')
	.action(async (opts) => {
		await (await using(opts.config, opts.database)).exportData(opts.name)
		console.log('Export complete.')
	})

prog
	.command('dbml')
	.option('-f, --file', 'Destination dbml file', 'design.dbml')
	.describe('Combine table ddl scripts and generate dbml.')
	.example('dbd dbml')
	.example('dbd dbml -f design.dbml')
	.action(async (opts) => {
		;(await using(opts.config, opts.database)).dbml(opts.file)
	})

prog
	.command('graph')
	.option('-n, --name', 'Entity name to scope the subgraph to')
	.describe('Output the dependency graph as JSON.')
	.example('dbd graph')
	.example('dbd graph -n config.users')
	.action(async (opts) => {
		const design = await using(opts.config, opts.database)
		const result = design.graph(opts.name)
		console.log(JSON.stringify(result, null, 2))
	})

prog
	.command('reset')
	.option('--target', 'Target platform: supabase or postgres', 'supabase')
	.option('--dry-run', 'Print what would be dropped without executing', false)
	.describe('Drop all design.yaml schemas (bare state). Run dbd apply to rebuild.')
	.example('dbd reset')
	.example('dbd reset --target postgres')
	.example('dbd reset --dry-run')
	.action(async (opts) => {
		await (await using(opts.config, opts.database)).reset(opts.target, opts['dry-run'])
	})

prog
	.command('grants')
	.option('--target', 'Target platform: supabase or postgres', 'supabase')
	.option('--dry-run', 'Print what would be granted without executing', false)
	.describe('Apply schema grants declared in design.yaml (Supabase only).')
	.example('dbd grants')
	.example('dbd grants --dry-run')
	.action(async (opts) => {
		await (await using(opts.config, opts.database)).grants(opts.target, opts['dry-run'])
	})

prog
	.command('convex schema')
	.option('-n, --name', 'apply a specific entity only')
	.option('--dry-run', 'print schema.ts to stdout only', false)
	.describe(
		'Generate convex/schema.ts from DDL entities. Deploys if CONVEX_URL and CONVEX_DEPLOY_KEY are set.'
	)
	.example('dbd convex schema')
	.example('dbd convex schema --dry-run')
	.action(async (opts) => {
		await (await using(opts.config, opts.database)).apply(opts.name, opts['dry-run'], 'convex')
	})

prog
	.command('convex seed')
	.option('-n, --name', 'Optional name or file to be seeded.')
	.option('--dry-run', 'print what would be seeded', false)
	.describe('Seed data into Convex deployment from import files.')
	.example('dbd convex seed')
	.example('dbd convex seed -n staging.users')
	.example('dbd convex seed --dry-run')
	.action(async (opts) => {
		const env = normalizeEnv(opts.environment)
		await (
			await using(opts.config, opts.database, env)
		).importData(opts.name, opts['dry-run'], 'convex')
		console.log('Seed complete.')
	})

prog
	.command('snapshot')
	.option('-n, --name', 'Description for this snapshot')
	.option('--list', 'List all existing snapshots', false)
	.describe('Create a versioned schema snapshot and generate a migration SQL file.')
	.example('dbd snapshot')
	.example('dbd snapshot --name "add email column"')
	.example('dbd snapshot --list')
	.action(async (opts) => {
		if (opts.list) {
			const snapshots = listSnapshots('.')
			if (snapshots.length === 0) {
				console.log('No snapshots found.')
				return
			}
			snapshots.forEach(({ version, description, timestamp }) => {
				console.log(
					`  ${padVersion(version)}  ${timestamp.slice(0, 10)}  ${description || '(no description)'}`
				)
			})
			return
		}

		const design = await using(opts.config, opts.database)
		design.validate()
		const adapter = await design.getAdapter()

		const { version, migrationFile, snapshot } = await createSnapshot(
			adapter,
			design.entities,
			opts.name || '',
			{ dir: '.' }
		)

		console.log(`Snapshot ${padVersion(version)} created (${snapshot.tables.length} tables).`)
		if (migrationFile) {
			console.log(`Migration file: ${migrationFile}`)
		} else if (version === 1) {
			console.log('First snapshot — no migration generated.')
		} else {
			console.log('No schema changes detected — no migration generated.')
		}
	})

prog
	.command('migrate')
	.option('--apply', 'Apply pending migrations to the database', false)
	.option('--status', 'Show local version vs database version', false)
	.option('--to', 'Apply migrations up to this version number', null)
	.option('--dry-run', 'Print migration SQL without executing', false)
	.describe('Manage and apply schema migrations.')
	.example('dbd migrate --status')
	.example('dbd migrate --apply')
	.example('dbd migrate --apply --to 3')
	.example('dbd migrate --apply --dry-run')
	.action(async (opts) => {
		const design = await using(opts.config, opts.database)
		const adapter = await design.getAdapter()

		const latest = latestSnapshot('.')
		const localVersion = latest ? latest.version : 0

		if (opts.status || (!opts.apply && !opts['dry-run'])) {
			let dbVersion
			try {
				dbVersion = await adapter.getDbVersion()
			} catch {
				dbVersion = 0
			}
			const pending = pendingMigrations(dbVersion, '.')
			console.log(`Local version:    ${localVersion} (snapshots/${padVersion(localVersion)}.json)`)
			console.log(`Database version: ${dbVersion}`)
			if (pending.length === 0) {
				console.log('No pending migrations.')
			} else {
				console.log(`Pending migrations (${pending.length}):`)
				pending.forEach(({ fromVersion, toVersion, file }) => {
					console.log(`  ${padVersion(fromVersion)}-to-${padVersion(toVersion)}.sql  (${file})`)
				})
			}
			return
		}

		if (opts.apply || opts['dry-run']) {
			let dbVersion
			try {
				dbVersion = await adapter.getDbVersion()
			} catch {
				dbVersion = 0
			}

			const toVersion = opts.to ? parseInt(opts.to, 10) : localVersion
			const pending = pendingMigrations(dbVersion, '.').filter(({ toVersion: v }) => v <= toVersion)

			if (pending.length === 0) {
				console.log('No pending migrations.')
				return
			}

			if (opts['dry-run']) {
				pending.forEach(({ fromVersion, toVersion: tv, sql }) => {
					console.log(`-- Migration: ${padVersion(fromVersion)} → ${padVersion(tv)}`)
					console.log(sql)
					console.log()
				})
				return
			}

			await adapter.ensureMigrationsTable()

			for (const { fromVersion, toVersion: tv, sql, checksum } of pending) {
				const snap = latestSnapshot('.')
				const description = snap && snap.version === tv ? snap.description : ''
				console.log(`Applying ${padVersion(fromVersion)}-to-${padVersion(tv)}.sql...`)
				await adapter.applyMigration(tv, sql, description, checksum)
				console.log(`  Migration ${tv} applied.`)
			}
		}
	})

process.on('unhandledRejection', (err) => {
	console.error(err instanceof Error ? err.message : String(err))
	process.exit(1)
})

prog.parse(process.argv)
