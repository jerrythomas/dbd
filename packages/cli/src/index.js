#!/usr/bin/env node

/**
 * dbd-cli — CLI entry point.
 *
 * Same commands and options as src/index.js but wired to new packages.
 */
import fs from 'fs'
import path from 'path'
import sade from 'sade'

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
import { auditDesign, fixDesign, checkExportColumns } from './doctor.js'
import { isGitHubSource, downloadGitHubSource, cachedGitHubSource } from './github-source.js'

const location = path.dirname(new URL(import.meta.url).pathname)
const pkg = JSON.parse(fs.readFileSync(path.join(location, '../package.json'), 'utf8'))

const prog = sade('dbd')

prog
	.version(pkg.version)
	.option('-c, --config', 'Provide path to custom config', 'design.yaml')
	.option('-d, --database', 'Database URL', (process.env.DATABASE_URL || '').replace(/\$/, '\\$'))
	.option('-e, --environment', 'Environment to load data', 'prod')
	.option('-p, --preview', 'Preview the action', false)
	.option('-s, --source', 'Source directory or GitHub repo (owner/repo/path)', '.')

/**
 * Resolves --source to a working directory.
 * For GitHub sources, uses local cache (reusable across commands).
 * Returns a cleanup function that restores cwd.
 */
function resolveSource(opts) {
	const source = opts.source
	if (!source || source === '.') return () => {}

	const originalDir = process.cwd()

	// Resolve output file paths to absolute before changing directory
	if (opts.file && !path.isAbsolute(opts.file)) {
		opts.file = path.resolve(opts.file)
	}

	if (isGitHubSource(source)) {
		const workDir = cachedGitHubSource(source)
		process.chdir(workDir)
		return () => process.chdir(originalDir)
	}

	// Local path
	if (!fs.existsSync(source)) {
		throw new Error(`Source directory not found: ${source}`)
	}
	process.chdir(source)
	return () => process.chdir(originalDir)
}

/**
 * Wraps a command action with --source resolution.
 */
function withSource(action) {
	return async (opts) => {
		const cleanup = resolveSource(opts)
		try {
			await action(opts)
		} finally {
			cleanup()
		}
	}
}

prog
	.command('init')
	.option('-p, --project', 'Name of the project', 'database')
	.option('--target', 'Target platform (e.g. supabase)', null)
	.describe('Initialize a starter project')
	.example('dbd init')
	.example('dbd init -p app')
	.example('dbd init -p app --target supabase')
	.action((opts) => {
		if (fs.existsSync(opts.project)) {
			console.error(`Error: folder "${opts.project}" already exists.`)
			process.exit(1)
		}
		const templateDir = path.join(location, '../example')
		const skip = ['migrations', 'snapshots', 'design.yaml']
		fs.cpSync(templateDir, opts.project, {
			recursive: true,
			filter: (src) => !skip.some((d) => src.startsWith(path.join(templateDir, d)))
		})
		const designYaml =
			opts.target === 'supabase'
				? [
						`project:`,
						`  name: ${opts.project}`,
						`  database: PostgreSQL`,
						``,
						`# Schemas exposed via PostgREST (dbd grants --target supabase)`,
						`supabase:`,
						`  - public`,
						``,
						`schemas:`,
						`  - public`,
						``,
						`extensions:`,
						`  - uuid-ossp`,
						``,
						`# External tables managed by Supabase — stubs for DBML FK references`,
						`external:`,
						`  - name: auth.users`,
						`    note: Supabase managed authentication table`,
						`    columns:`,
						`      - id: uuid`,
						``
					].join('\n')
				: [
						`project:`,
						`  name: ${opts.project}`,
						`  database: PostgreSQL`,
						``,
						`schemas:`,
						`  - public`,
						``,
						`extensions:`,
						`  - uuid-ossp`,
						``
					].join('\n')
		fs.writeFileSync(path.join(opts.project, 'design.yaml'), designYaml)
		console.log(`Initialized project in "${opts.project}".`)
	})

prog
	.command('inspect')
	.option('-n, --name', 'Name of specific entity to inspect.')
	.option('-vv, --verbose', 'Verbose output', false)
	.option('--no-cache', 'Skip DB reference cache', false)
	.describe('Inspect the current folder.')
	.example('dbd inspect')
	.action(
		withSource(async (opts) => {
			const design = (await using(opts.config, opts.database)).validate()

			try {
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
				// Export view column consistency check
				const adapter = await design.getAdapter()
				const exportIssues = checkExportColumns(design.config, adapter)
				if (exportIssues.length > 0) {
					console.log('\nExport view column issues:')
					for (const issue of exportIssues) {
						console.log(`  ${issue.export} ← ${issue.stagingTable}`)
						if (issue.missingColumns.length > 0)
							console.log(`    columns not in staging: ${issue.missingColumns.join(', ')}`)
						if (issue.orderMismatch) console.log(`    column order differs from staging table`)
					}
				} else if (issues.length === 0 && warnings.length === 0) {
					console.log('Everything looks ok')
				}
			} finally {
				await design.disconnect()
			}
		})
	)

prog
	.command('doctor')
	.option('--fix', 'Remove stale entries from design.yaml', false)
	.describe('Audit design.yaml for stale entries and optionally remove them.')
	.example('dbd doctor')
	.example('dbd doctor --fix')
	.action(
		withSource((opts) => {
			const audit = auditDesign(opts.config)
			const hasIssues = Object.values(audit).some((arr) => arr.length > 0)

			if (!hasIssues) {
				console.log('design.yaml is clean — no stale entries found.')
				return
			}

			if (audit.staleSchemas.length > 0)
				console.log(`Stale schemas:         ${audit.staleSchemas.join(', ')}`)
			if (audit.staleStaging.length > 0)
				console.log(`Stale staging schemas: ${audit.staleStaging.join(', ')}`)
			if (audit.staleMigrate.length > 0)
				console.log(`Stale migrate schemas: ${audit.staleMigrate.join(', ')}`)
			if (audit.staleImport.length > 0) {
				const names = audit.staleImport.map((e) => (typeof e === 'string' ? e : Object.keys(e)[0]))
				console.log(`Stale import tables:   ${names.join(', ')}`)
			}
			if (audit.staleExport.length > 0)
				console.log(`Stale export entries:  ${audit.staleExport.join(', ')}`)

			if (opts.fix) {
				fs.writeFileSync(opts.config, fixDesign(opts.config))
				console.log(`\nFixed ${opts.config}`)
			} else {
				console.log('\nRun with --fix to remove stale entries.')
			}
		})
	)

prog
	.command('apply')
	.option('-n, --name', 'apply a specific entity or file only')
	.option('--dry-run', 'just print the entities', false)
	.describe('Apply the database scripts to database.')
	.example('dbd apply')
	.example('dbd apply --dry-run')
	.action(
		withSource(async (opts) => {
			const dx = await using(opts.config, opts.database)
			try {
				await dx.apply(opts.name, opts['dry-run'])
			} finally {
				await dx.disconnect()
			}
		})
	)

prog
	.command('combine')
	.option('-f, --file', 'Destination sql file', 'init.sql')
	.describe('Combine all ddl scripts into one script.')
	.example('dbd combine')
	.example('dbd combine -f init.sql')
	.action(
		withSource(async (opts) => {
			const dx = await using(opts.config, opts.database)
			try {
				dx.combine(opts.file)
				console.log(`Generated ${opts.file}`)
			} finally {
				await dx.disconnect()
			}
		})
	)

prog
	.command('import')
	.option('-n, --name', 'Optional name or file to be imported.')
	.option('--dry-run', 'just print the entities', false)
	.describe('Load csv files into database')
	.example('dbd import')
	.example('dbd import -n staging.lookups')
	.action(
		withSource(async (opts) => {
			const env = normalizeEnv(opts.environment)
			const dx = await using(opts.config, opts.database, env)
			try {
				await dx.importData(opts.name, opts['dry-run'])
				console.log('Import complete.')
			} finally {
				await dx.disconnect()
			}
		})
	)

prog
	.command('export')
	.option('-n, --name', 'Name of specific entity to export.')
	.describe('Export specific tables from the database')
	.example('dbd export')
	.example('dbd export -n staging.lookups')
	.action(
		withSource(async (opts) => {
			const dx = await using(opts.config, opts.database)
			try {
				await dx.exportData(opts.name)
				console.log('Export complete.')
			} finally {
				await dx.disconnect()
			}
		})
	)

prog
	.command('dbml')
	.option('-f, --file', 'Destination dbml file', 'design.dbml')
	.describe('Combine table ddl scripts and generate dbml.')
	.example('dbd dbml')
	.example('dbd dbml -f design.dbml')
	.action(
		withSource(async (opts) => {
			const dx = await using(opts.config, opts.database)
			try {
				dx.dbml(opts.file)
			} finally {
				await dx.disconnect()
			}
		})
	)

prog
	.command('graph')
	.option('-n, --name', 'Entity name to scope the subgraph to')
	.describe('Output the dependency graph as JSON.')
	.example('dbd graph')
	.example('dbd graph -n config.users')
	.action(
		withSource(async (opts) => {
			const dx = await using(opts.config, opts.database)
			try {
				const result = dx.graph(opts.name)
				console.log(JSON.stringify(result, null, 2))
			} finally {
				await dx.disconnect()
			}
		})
	)

prog
	.command('reset')
	.option('--target', 'Target platform: supabase or postgres', 'supabase')
	.option('--dry-run', 'Print what would be dropped without executing', false)
	.describe('Drop all design.yaml schemas (bare state). Run dbd apply to rebuild.')
	.example('dbd reset')
	.example('dbd reset --target postgres')
	.example('dbd reset --dry-run')
	.action(
		withSource(async (opts) => {
			const dx = await using(opts.config, opts.database)
			try {
				await dx.reset(opts.target, opts['dry-run'])
			} finally {
				await dx.disconnect()
			}
		})
	)

prog
	.command('policies')
	.option('-n, --name', 'Apply policies for a specific entity only (e.g. config.lookups)')
	.option('--dry-run', 'Print policy files that would be applied without executing', false)
	.describe('Apply RLS policies and grants from the policies/ folder.')
	.example('dbd policies')
	.example('dbd policies --name config.lookups')
	.example('dbd policies --dry-run')
	.action(
		withSource(async (opts) => {
			const dx = await using(opts.config, opts.database)
			try {
				await dx.policies(opts.name, opts['dry-run'])
			} finally {
				await dx.disconnect()
			}
		})
	)

prog
	.command('grants')
	.option('--target', 'Target platform: supabase or postgres', 'supabase')
	.option('--dry-run', 'Print what would be granted without executing', false)
	.describe('Apply schema grants declared in design.yaml (Supabase only).')
	.example('dbd grants')
	.example('dbd grants --dry-run')
	.action(
		withSource(async (opts) => {
			const dx = await using(opts.config, opts.database)
			try {
				await dx.grants(opts.target, opts['dry-run'])
			} finally {
				await dx.disconnect()
			}
		})
	)

prog
	.command('snapshot')
	.option('-n, --name', 'Description for this snapshot')
	.option('--list', 'List all existing snapshots', false)
	.describe('Create a versioned schema snapshot and generate a migration SQL file.')
	.example('dbd snapshot')
	.example('dbd snapshot --name "add email column"')
	.example('dbd snapshot --list')
	.action(
		withSource(async (opts) => {
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

			const dx = await using(opts.config, opts.database)
			try {
				dx.validate()
				const adapter = await dx.getAdapter()

				const { version, migrationDir, snapshot } = await createSnapshot(
					adapter,
					dx.entities,
					opts.name || '',
					{ dir: '.' }
				)

				console.log(`Snapshot ${padVersion(version)} created (${snapshot.tables.length} tables).`)
				if (migrationDir) {
					console.log(`Migration folder: ${migrationDir}`)
				} else if (version === 1) {
					console.log('First snapshot — no migration generated.')
				} else {
					console.log('No schema changes detected — no migration generated.')
				}
			} finally {
				await dx.disconnect()
			}
		})
	)

prog
	.command('migrate')
	.option('--apply', 'Apply pending migrations to the database', false)
	.option('--status', 'Show local version vs database version', false)
	.option('--to', 'Apply migrations up to this version number', null)
	.option('--dry-run', 'Print migration SQL without executing', false)
	.describe('Apply pending schema migrations independently of dbd apply.')
	.example('dbd migrate --status')
	.example('dbd migrate --apply')
	.example('dbd migrate --apply --to 3')
	.example('dbd migrate --apply --dry-run')
	.action(
		withSource(async (opts) => {
			const dx = await using(opts.config, opts.database)
			const adapter = await dx.getAdapter()

			try {
				const latest = latestSnapshot('.')
				const localVersion = latest ? latest.version : 0

				const dbVersion = await adapter.getDbVersion()
				const maxVersion = opts.to ? parseInt(opts.to, 10) : localVersion
				const pending = pendingMigrations(dbVersion, '.').filter(
					({ toVersion }) => toVersion <= maxVersion
				)

				if (opts.status || (!opts.apply && !opts['dry-run'])) {
					console.log(`Local version:    ${localVersion}`)
					console.log(`Database version: ${dbVersion}`)
					if (pending.length === 0) {
						console.log('Up to date — no pending migrations.')
					} else {
						console.log(`\nPending migrations (${pending.length}):`)
						pending.forEach(({ fromVersion, toVersion, altered, dropped }) => {
							const summary = []
							if (altered.length > 0) summary.push(`alter: ${altered.join(', ')}`)
							if (dropped.length > 0) summary.push(`drop: ${dropped.join(', ')}`)
							console.log(
								`  ${padVersion(fromVersion)} → ${padVersion(toVersion)}  ${summary.join(' | ') || '(no table changes)'}`
							)
						})
					}
					return
				}

				if (pending.length === 0) {
					console.log('No pending migrations.')
					return
				}

				// Collect all SQL for each migration in graph order
				const migrationSteps = pending.map((migration) => {
					const steps = []
					for (const tableName of migration.altered) {
						const parts = tableName.split('.')
						const schema = parts.length > 1 ? parts[0] : null
						const tbl = parts[parts.length - 1]
						const sqlFile = schema
							? path.join(migration.migrationDir, schema, `${tbl}.sql`)
							: path.join(migration.migrationDir, `${tbl}.sql`)
						if (fs.existsSync(sqlFile)) {
							steps.push({ tableName, sql: fs.readFileSync(sqlFile, 'utf-8') })
						}
					}
					for (const tableName of migration.dropped) {
						const parts = tableName.split('.')
						const schema = parts.length > 1 ? parts[0] : null
						const tbl = parts[parts.length - 1]
						const sqlFile = schema
							? path.join(migration.migrationDir, schema, `${tbl}.drop.sql`)
							: path.join(migration.migrationDir, `${tbl}.drop.sql`)
						if (fs.existsSync(sqlFile)) {
							steps.push({
								tableName,
								sql: fs.readFileSync(sqlFile, 'utf-8'),
								drop: true
							})
						}
					}
					return { migration, steps }
				})

				if (opts['dry-run']) {
					for (const { migration, steps } of migrationSteps) {
						console.log(
							`\n-- Migration v${migration.fromVersion} → v${migration.toVersion} (${migration.migrationDir})`
						)
						for (const { tableName, sql } of steps) {
							console.log(`\n-- Table: ${tableName}`)
							console.log(sql)
						}
					}
					return
				}

				await adapter.ensureMigrationsTable()

				for (const { migration, steps } of migrationSteps) {
					console.log(`Applying migration v${migration.fromVersion} → v${migration.toVersion}`)
					for (const { tableName, sql, drop } of steps) {
						const action = drop ? 'Dropping' : 'Migrating'
						console.log(`  ${action} ${tableName}`)
						await adapter.executeScript(sql)
					}
					const snap = latestSnapshot('.')
					const description = snap && snap.version === migration.toVersion ? snap.description : ''
					await adapter.applyMigration(migration.toVersion, '', description, migration.checksum)
					console.log(`  Version ${migration.toVersion} recorded.`)
				}
			} finally {
				await dx.disconnect()
			}
		})
	)

prog
	.command('deploy')
	.option('--dry-run', 'Preview what would be executed', false)
	.describe('Deploy from a source: fetch, apply, migrate, and import in one step.')
	.example('dbd deploy --source sensei-hq/daemon/database -d postgres://...')
	.example('dbd deploy --source sensei-hq/daemon/database@v2.1 -d $DATABASE_URL')
	.example('dbd deploy --source ./local-db-project -d $DATABASE_URL')
	.action(async (opts) => {
		const source = opts.source
		if (!source || source === '.') {
			console.error('deploy requires --source (GitHub repo or local path)')
			process.exit(1)
		}
		if (!opts.database) {
			console.error('deploy requires --database (-d)')
			process.exit(1)
		}

		const originalDir = process.cwd()
		let cleanup

		if (isGitHubSource(source)) {
			const result = downloadGitHubSource(source)
			process.chdir(result.workDir)
			cleanup = () => {
				process.chdir(originalDir)
				result.cleanup()
			}
		} else {
			if (!fs.existsSync(source)) {
				console.error(`Source directory not found: ${source}`)
				process.exit(1)
			}
			process.chdir(source)
			cleanup = () => process.chdir(originalDir)
		}

		try {
			const env = normalizeEnv(opts.environment)
			const dx = await using(opts.config, opts.database, env)

			try {
				// Apply handles schemas, entities, and pending migrations in one pass
				console.info('\n--- apply ---')
				await dx.apply(null, opts['dry-run'])

				// Import staging data
				console.info('\n--- import ---')
				await dx.importData(null, opts['dry-run'])
				console.log('Import complete.')

				console.info('\nDeploy complete.')
			} finally {
				await dx.disconnect()
			}
		} finally {
			cleanup()
		}
	})

process.on('unhandledRejection', (err) => {
	console.error(err instanceof Error ? err.message : String(err))
	process.exit(1)
})

prog.parse(process.argv)
