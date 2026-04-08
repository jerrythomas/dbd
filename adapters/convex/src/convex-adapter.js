import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { BaseDatabaseAdapter } from '@jerrythomas/dbd-db'
import { generateSchemaTs, resolveTableName } from './schema-generator.js'
import { seedTable, convexImportCommand } from './data-seeder.js'

/**
 * Convex adapter for DBD.
 *
 * apply  → generates convex/schema.ts from DDL table entities, optionally deploys
 * import → seeds data via `npx convex import`
 *
 * Convex does not use SQL, so executeScript and applyEntity are no-ops.
 * applyEntities() is overridden because schema generation requires all entities at once.
 */
export class ConvexAdapter extends BaseDatabaseAdapter {
	get #convexConfig() {
		return this.options.convex ?? {}
	}

	get #isProd() {
		return (this.options.env ?? 'prod') === 'prod'
	}

	async connect() {}
	async disconnect() {}
	async executeScript() {}
	async applyEntity() {}

	prefersBatchApply() {
		return true
	}

	async applyEntities(entities, _options = {}) {
		const { content, warnings } = generateSchemaTs(entities, this.#convexConfig)
		warnings.forEach((w) => console.warn(w))

		if (this.dryRun) {
			console.info(content)
			return
		}

		mkdirSync('convex', { recursive: true })
		writeFileSync('convex/schema.ts', content)
		console.info('Generated convex/schema.ts')

		if (process.env.CONVEX_URL && process.env.CONVEX_DEPLOY_KEY) {
			execFileSync('npx', ['convex', 'deploy'], { stdio: 'inherit', env: { ...process.env } })
		} else {
			console.info('CONVEX_URL or CONVEX_DEPLOY_KEY not set — skipping deploy')
		}
	}

	async importData(entity, options = {}) {
		if (entity.errors && entity.errors.length > 0) {
			this.log(`Skipping import of ${entity.name} (has errors)`, 'warn')
			return
		}

		if (this.dryRun || options.dryRun) {
			const tableName = resolveTableName(entity, this.#convexConfig)
			console.info(
				convexImportCommand(tableName, entity.file, entity.format ?? 'csv', this.#isProd)
			)
			return
		}

		this.log(`Seeding ${entity.name} into Convex`)
		seedTable(entity, this.#convexConfig, this.#isProd)
	}

	parseEntityScript(entity) {
		// Convex has no SQL parser — return entity with no references so dependency
		// resolution uses config order.
		return { ...entity, searchPaths: [], references: [], errors: [] }
	}

	classifyReference() {
		return null
	}
}
