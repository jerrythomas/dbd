/**
 * Design class — orchestrates configuration, validation, and operations.
 *
 * Refactored from src/collect.js to use @jerrythomas/dbd-db packages.
 * The adapter provides all dialect-specific behavior (parsing, classification).
 */
import fs from 'fs'
import path from 'path'
import { omit, pick } from 'ramda'
import {
	entityFromSchemaName,
	entityFromExportConfig,
	entityFromExtensionConfig,
	ddlFromEntity,
	validateEntity,
	importScriptForEntity,
	exportScriptForEntity,
	filterEntitiesForDBML,
	sortByDependencies,
	graphFromEntities,
	buildImportPlan,
	buildResetScript,
	buildGrantsScript
} from '@jerrythomas/dbd-db'
import { generateDBML } from '@jerrythomas/dbd-dbml'
import { read, clean } from './config.js'
import { matchReferences } from './references.js'

class Design {
	#config = {}
	#roles = []
	#entities = []
	#isValidated = false
	#databaseURL
	#importTables
	#adapter = null
	#env = 'prod'

	constructor(rawConfig, adapter, databaseURL, env = 'prod') {
		const parseEntity = (entity) => adapter.parseEntityScript(entity)
		const externalEntities = rawConfig.externalEntities ?? []
		const matchRefs = (entities, exts) =>
			matchReferences([...entities, ...externalEntities], exts, (name, installed) =>
				adapter.classifyReference(name, installed)
			).filter((e) => e.type !== 'external')

		let config = clean(rawConfig, parseEntity, matchRefs)

		let extensionSchema = config.project.extensionSchema
		this.#databaseURL = databaseURL
		this.#adapter = adapter
		this.#config = omit(['importTables'], config)
		this.#config.extensions = this.#config.extensions ?? []
		this.#config.roles = sortByDependencies(config.roles)
		this.#config.entities = sortByDependencies(config.entities)

		this.#entities = [
			...this.#config.schemas.map((schema) => entityFromSchemaName(schema)),
			...this.#config.extensions.map((item) => entityFromExtensionConfig(item, extensionSchema)),
			...this.#config.roles,
			...this.#config.entities,
			...(this.#config.externalEntities ?? [])
		]

		this.#importTables = buildImportPlan(config.importTables, config.entities)
		this.#env = env
	}

	get config() {
		return this.#config
	}
	get entities() {
		return this.#entities
	}
	get roles() {
		return this.#roles
	}
	get isValidated() {
		return this.#isValidated
	}
	get databaseURL() {
		return this.#databaseURL
	}
	get importTables() {
		return this.#importTables.map(({ table, procedure, targets, warnings: planWarnings }) => ({
			...table,
			procedure,
			targets,
			warnings: [...(table.warnings || []), ...planWarnings]
		}))
	}

	/**
	 * Update entities after async DB resolution.
	 * Replaces the config entities and rebuilds the full entity list.
	 */
	updateEntities(resolvedEntities) {
		this.#config.entities = resolvedEntities
		this.#entities = [
			...this.#config.schemas.map((schema) => entityFromSchemaName(schema)),
			...this.#config.extensions.map((item) =>
				entityFromExtensionConfig(item, this.#config.project.extensionSchema)
			),
			...this.#config.roles,
			...this.#config.entities,
			...(this.#config.externalEntities ?? [])
		]
	}

	validate() {
		const allowedSchemas = this.#config.project.staging

		this.#roles = this.config.roles.map((role) => validateEntity(role))
		this.#entities = this.entities.map((entity) =>
			entity.type === 'external' ? entity : validateEntity(entity, true, this.config.ignore)
		)
		this.#importTables = this.#importTables
			.filter(({ table }) => table.env === null || table.env === this.#env)
			.map((entry) => ({ ...entry, table: validateEntity(entry.table, false) }))
			.map((entry) => {
				if (!allowedSchemas.includes(entry.table.schema)) {
					return {
						...entry,
						table: {
							...entry.table,
							errors: [...(entry.table.errors || []), 'Import is only allowed for staging schemas']
						}
					}
				}
				return entry
			})

		this.#isValidated = true
		return this
	}

	report(name) {
		if (!this.isValidated) this.validate()
		const issues = [
			...this.entities.filter((entity) => entity.errors && entity.errors.length > 0),
			...this.importTables.filter((table) => table.errors && table.errors.length > 0)
		].filter((entity) => !name || entity.name === name)
		const warnings = [
			...this.entities.filter((entity) => entity.warnings && entity.warnings.length > 0),
			...this.importTables.filter((table) => table.warnings && table.warnings.length > 0)
		].filter((entity) => !name || entity.name === name)
		const entity = this.entities.filter((entity) => entity.name === name).pop()
		return { entity, issues, warnings }
	}

	async apply(name, dryRun = false, target = null) {
		if (target === 'convex') {
			if (!this.isValidated) this.validate()
			const { generateSchemaTs } = await import('@jerrythomas/dbd-convex')
			const convexConfig = this.#config.convex ?? {}
			const { content, warnings } = generateSchemaTs(this.entities, convexConfig)
			warnings.forEach((w) => console.warn(w))

			if (dryRun) {
				console.info(content)
				return this
			}

			fs.mkdirSync('convex', { recursive: true })
			fs.writeFileSync('convex/schema.ts', content)
			console.info('Generated convex/schema.ts')

			const convexUrl = process.env.CONVEX_URL
			const convexKey = process.env.CONVEX_DEPLOY_KEY
			if (convexUrl && convexKey) {
				const { execFileSync } = await import('child_process')
				execFileSync('npx', ['convex', 'deploy'], { stdio: 'inherit', env: { ...process.env } })
			} else {
				console.info('CONVEX_URL or CONVEX_DEPLOY_KEY not set — skipping deploy')
			}
			return this
		}

		if (!this.isValidated) this.validate()

		if (dryRun) {
			this.entities
				.filter((entity) => entity.type !== 'external')
				.map((entity) => {
					const using =
						entity.file || entity.type === 'extension'
							? ` using "${entity.file || entity.schema}"`
							: ''
					const detail = `${entity.type} => ${entity.name}${using}`

					if (entity.errors && entity.errors.length > 0) {
						console.error(pick(['type', 'name', 'file', 'errors'], entity))
					} else {
						console.info(detail)
					}
				})
			return this
		}

		const adapter = await this.getAdapter()
		const validEntities = this.entities
			.filter((entity) => !entity.errors || entity.errors.length === 0)
			.filter((entity) => entity.type !== 'external')
			.filter((entity) => !name || entity.name === name)

		// When targeting a single named entity, skip migration phases
		if (name) {
			await adapter.applyEntities(validEntities)
			return this
		}

		const { pendingMigrations, latestSnapshot } = await import('./snapshot.js')
		const dbVersion = await adapter.getDbVersion()
		const latest = latestSnapshot('.')

		if (dbVersion === 0) {
			// DB has no migration history. Check whether tables actually exist to distinguish:
			//   - Truly fresh / post-reset: no tables → create from DDL, record latest version
			//   - Pre-snapshot existing DB: tables exist → run pending migrations normally
			const firstTable = validEntities.find((e) => e.type === 'table')
			const tableExists = firstTable ? await adapter.resolveEntity(firstTable.name) : null

			if (!tableExists) {
				// Truly fresh or post-reset: apply all entities then record current version
				for (const entity of validEntities) {
					await adapter.applyEntity(entity)
				}
				if (latest) {
					await adapter.ensureMigrationsTable()
					await adapter.applyMigration(latest.version, '', `fresh apply at v${latest.version}`, '')
				}
				return this
			}

			// Tables exist but no migration history — fall through to run pending migrations
		}

		// Existing DB: run pending migrations interleaved with entity apply.
		const pending = pendingMigrations(dbVersion)

		if (pending.length > 0) {
			await adapter.ensureMigrationsTable()
		}

		// Build map: table name → pending migrations that alter it (in version order)
		const tableMigrations = new Map()
		for (const migration of pending) {
			for (const tableName of migration.altered) {
				if (!tableMigrations.has(tableName)) tableMigrations.set(tableName, [])
				tableMigrations.get(tableName).push(migration)
			}
		}

		// Apply entities in dependency order.
		// Before each table entity, run its pending migration SQL (if any).
		// Interleaving ensures FK migrations to new tables run after those tables are created.
		for (const entity of validEntities) {
			if (entity.type === 'table') {
				const migrations = tableMigrations.get(entity.name)
				if (migrations) {
					for (const migration of migrations) {
						const parts = entity.name.split('.')
						const schema = parts.length > 1 ? parts[0] : null
						const tableName = parts[parts.length - 1]
						const sqlFile = schema
							? path.join(migration.migrationDir, schema, `${tableName}.sql`)
							: path.join(migration.migrationDir, `${tableName}.sql`)
						if (fs.existsSync(sqlFile)) {
							const sql = fs.readFileSync(sqlFile, 'utf-8')
							console.info(
								`Migrating ${entity.name} (v${migration.fromVersion} → v${migration.toVersion})`
							)
							await adapter.executeScript(sql)
						}
					}
				}
			}
			await adapter.applyEntity(entity)
		}

		// Handle dropped tables (destructive — run after all entities applied)
		for (const migration of pending) {
			for (const tableName of migration.dropped) {
				const parts = tableName.split('.')
				const schema = parts.length > 1 ? parts[0] : null
				const tbl = parts[parts.length - 1]
				const sqlFile = schema
					? path.join(migration.migrationDir, schema, `${tbl}.drop.sql`)
					: path.join(migration.migrationDir, `${tbl}.drop.sql`)
				if (fs.existsSync(sqlFile)) {
					const sql = fs.readFileSync(sqlFile, 'utf-8')
					console.info(
						`Dropping table ${tableName} (v${migration.fromVersion} → v${migration.toVersion})`
					)
					await adapter.executeScript(sql)
				}
			}
		}

		// Record applied migration versions in _dbd_migrations
		for (const migration of pending) {
			const description = `migration v${migration.fromVersion} to v${migration.toVersion}`
			await adapter.applyMigration(migration.toVersion, '', description, migration.checksum)
		}

		return this
	}

	combine(file) {
		if (!this.isValidated) this.validate()
		const combined = this.entities
			.filter((entity) => !entity.errors || entity.errors.length === 0)
			.filter((entity) => entity.type !== 'external')
			.map((entity) => ddlFromEntity(entity))

		fs.writeFileSync(file, combined.join('\n'))
		return this
	}

	dbml(file = 'design.dbml') {
		const results = generateDBML({
			entities: this.entities,
			project: this.config.project,
			ddlFromEntity,
			filterEntities: filterEntitiesForDBML,
			file
		})

		results.map(({ fileName, content, error }) => {
			if (error) {
				const messages = Array.isArray(error.diags)
					? error.diags.map((d) => d.message).join('\n  ')
					: (error.message ?? String(error))
				console.error(`DBML conversion failed for ${fileName}:\n  ${messages}`)
			} else {
				try {
					fs.writeFileSync(fileName, content)
					console.info(`Generated DBML in ${fileName}`)
				} catch (err) {
					console.error(err)
				}
			}
		})

		return this
	}

	async importData(name, dryRun = false, target = null) {
		if (target === 'convex') {
			if (!this.isValidated) this.validate()
			const { seedTable, convexImportCommand, resolveTableName } =
				await import('@jerrythomas/dbd-convex')
			const convexConfig = this.#config.convex ?? {}
			const isProd = this.#env === 'prod'

			const plan = this.importTables
				.filter((table) => !table.errors || table.errors.length === 0)
				.filter((table) => !name || table.name === name || table.file === name)

			if (dryRun) {
				for (const table of plan) {
					const tableName = resolveTableName(table, convexConfig)
					console.info(convexImportCommand(tableName, table.file, table.format ?? 'csv', isProd))
				}
				return this
			}

			for (const table of plan) {
				console.info(`Seeding ${table.name} into Convex`)
				table.warnings.forEach((w) => console.warn(w))
				seedTable(table, convexConfig, isProd)
			}
			return this
		}

		if (!this.isValidated) this.validate()

		const plan = this.importTables
			.filter((table) => !table.errors || table.errors.length === 0)
			.filter((table) => !name || table.name === name || table.file === name)

		if (dryRun) {
			for (const table of plan) {
				console.info(`Importing ${table.name}`)
				table.warnings.forEach((w) => console.warn(w))
				console.info(importScriptForEntity(table))
			}
			for (const table of plan) {
				if (table.procedure) console.info(`call ${table.procedure.name}();`)
			}
			return this
		}

		const adapter = await this.getAdapter()
		for (const table of plan) {
			console.info(`Importing ${table.name}`)
			table.warnings.forEach((w) => console.warn(w))
			await adapter.importData(table)
		}
		for (const table of plan) {
			if (table.procedure) {
				console.info(`Calling ${table.procedure.name}`)
				await adapter.executeScript(`call ${table.procedure.name}();`)
			}
		}

		const sharedAfter = this.config.import.after ?? []
		const envAfter = this.config.import[`after.${this.#env}`] ?? []
		for (const file of [...sharedAfter, ...envAfter]) {
			console.info(`Processing ${file}`)
			await adapter.executeFile(file)
		}

		return this
	}

	async exportData(name) {
		const entities = this.config.export
			.map((entity) => entityFromExportConfig(entity))
			.filter((entity) => !name || entity.name === name)

		const folders = [
			...new Set(entities.map((entity) => path.join('export', entity.name.split('.')[0])))
		]

		if (entities.length > 0) {
			folders.map((folder) => fs.mkdirSync(folder, { recursive: true }))
			const adapter = await this.getAdapter()
			await adapter.batchExport(entities)
		}

		return this
	}

	async reset(target = 'supabase', dryRun = false) {
		const script = buildResetScript(this.#config.schemas, this.#config.roles, target)
		if (!script) {
			console.info('No schemas to reset.')
			return this
		}
		if (dryRun) {
			console.info('[dry-run] reset script:')
			console.info(script)
			return this
		}
		const adapter = await this.getAdapter()
		await adapter.executeScript(script)
		await adapter.clearProjectMigrations()
		console.info('Reset complete.')
		return this
	}

	async policies(name, dryRun = false) {
		const files = (this.#config.policyFiles ?? []).filter((p) => !name || p.name === name)

		if (!files.length) {
			console.info(name ? `No policy file found for ${name}` : 'No policies found in policies/')
			return this
		}

		if (dryRun) {
			console.info('[dry-run] policy files:')
			files.forEach((p) => console.info(`  ${p.file}`))
			return this
		}

		const adapter = await this.getAdapter()
		for (const p of files) {
			const sql = fs.readFileSync(p.file, 'utf8')
			await adapter.executeScript(sql)
			console.info(`Applied policies from ${p.file}`)
		}
		return this
	}

	async grants(target = 'supabase', dryRun = false) {
		const script = buildGrantsScript(
			this.#config.schemaGrants ?? [],
			this.#config.supabaseSchemas ?? [],
			target
		)
		if (!script) {
			console.info('No grants configured in design.yaml')
			return this
		}
		if (dryRun) {
			console.info('[dry-run] grants script:')
			console.info(script)
			return this
		}
		const adapter = await this.getAdapter()
		await adapter.executeScript(script)
		console.info('Grants applied.')
		return this
	}

	async getAdapter() {
		return this.#adapter
	}

	async disconnect() {
		await this.#adapter.disconnect()
	}

	graph(name) {
		return graphFromEntities(this.config.entities, name)
	}
}

/**
 * Async factory function for creating a Design instance.
 * Loads the adapter based on the project's configured database dialect.
 *
 * @param {string} file - path to configuration file
 * @param {string} databaseURL - database connection URL
 * @param {string} [env] - environment name
 * @param {Object} [opts] - options
 * @param {BaseDatabaseAdapter} [opts.adapter] - pre-created adapter (skips factory lookup)
 * @returns {Promise<Design>}
 */
export async function using(file, databaseURL, env = 'prod', opts = {}) {
	const rawConfig = read(file)
	const dbType = rawConfig.project?.database || 'PostgreSQL'
	const project = rawConfig.project?.name || path.basename(path.resolve('.'))
	let adapter = opts.adapter
	if (!adapter) {
		const { createAdapter, registerAdapter } = await import('@jerrythomas/dbd-db')
		registerAdapter('postgres', () => import('@jerrythomas/dbd-postgres-adapter'))
		registerAdapter('postgresql', () => import('@jerrythomas/dbd-postgres-adapter'))
		adapter = await createAdapter(dbType.toLowerCase(), databaseURL, { project })
	}
	await adapter.initParser()
	return new Design(rawConfig, adapter, databaseURL, env)
}
