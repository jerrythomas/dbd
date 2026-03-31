/**
 * Doctor — audit and fix design.yaml for stale entries.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, extname } from 'path'
import { load, dump } from 'js-yaml'
import { scan } from './config.js'

/**
 * Find a DDL file path for the given type/schema/name, checking both .ddl and .sql extensions.
 *
 * @param {string} type - DDL type directory (table, view, function, procedure)
 * @param {string} schema
 * @param {string} name
 * @returns {string|null}
 */
export function findDDLFile(type, schema, name) {
	for (const ext of ['ddl', 'sql']) {
		const p = join('ddl', type, schema, `${name}.${ext}`)
		if (existsSync(p)) return p
	}
	return null
}

/**
 * Returns the set of schema names that have at least one DDL file.
 *
 * @returns {Set<string>}
 */
function schemasWithDDL() {
	const schemas = new Set()
	for (const type of ['table', 'view', 'function', 'procedure']) {
		const typeDir = join('ddl', type)
		if (!existsSync(typeDir)) continue
		for (const entry of readdirSync(typeDir, { withFileTypes: true })) {
			if (entry.isDirectory()) schemas.add(entry.name)
		}
	}
	return schemas
}

/**
 * Returns true if any DDL file exists for the given entity name (schema.name).
 *
 * @param {string} entityName - qualified name like "config.lookups"
 * @returns {boolean}
 */
function ddlFileExists(entityName) {
	if (!entityName.includes('.')) return false
	const [schema, name] = entityName.split('.')
	return ['table', 'view', 'function', 'procedure'].some(
		(type) => findDDLFile(type, schema, name) !== null
	)
}

/**
 * Audit design.yaml for stale entries — entries that reference schemas, import files,
 * or export DDL that no longer exist on the filesystem.
 *
 * @param {string} [configPath] - path to design.yaml
 * @returns {{ staleSchemas: string[], staleStaging: string[], staleImport: Array, staleExport: string[] }}
 */
export function auditDesign(configPath = 'design.yaml') {
	const raw = load(readFileSync(configPath, 'utf8'))
	const activeSchemas = schemasWithDDL()

	// Schemas referenced elsewhere in config are protected even if they have no DDL
	const protectedSchemas = new Set(
		[...(raw.project?.staging ?? []), raw.project?.extensionSchema].filter(Boolean)
	)

	const staleSchemas = (raw.schemas ?? [])
		.map((s) => (typeof s === 'string' ? s : Object.keys(s)[0]))
		.filter((s) => !activeSchemas.has(s) && !protectedSchemas.has(s))

	const staleStaging = (raw.project?.staging ?? []).filter((s) => !activeSchemas.has(s))

	const importFiles = existsSync('import')
		? scan('import').filter((f) => ['.csv', '.tsv', '.jsonl'].includes(extname(f)))
		: []

	const staleImport = (raw.import?.tables ?? []).filter((entry) => {
		const name = typeof entry === 'string' ? entry : Object.keys(entry)[0]
		const [schema, table] = name.split('.')
		return !importFiles.some((f) =>
			f.replace(/\\/g, '/').match(new RegExp(`(?:^|/)${schema}/${table}\\.[^/]+$`))
		)
	})

	const staleExport = (raw.export ?? []).filter((e) => !ddlFileExists(e))

	return { staleSchemas, staleStaging, staleImport, staleExport }
}

/**
 * Remove all stale entries identified by auditDesign and return the updated YAML string.
 *
 * @param {string} [configPath] - path to design.yaml
 * @returns {string} Updated YAML content
 */
export function fixDesign(configPath = 'design.yaml') {
	const raw = load(readFileSync(configPath, 'utf8'))
	const audit = auditDesign(configPath)

	if (audit.staleSchemas.length > 0) {
		raw.schemas = (raw.schemas ?? []).filter((s) => {
			const name = typeof s === 'string' ? s : Object.keys(s)[0]
			return !audit.staleSchemas.includes(name)
		})
	}

	if (raw.project?.staging && audit.staleStaging.length > 0) {
		raw.project.staging = raw.project.staging.filter((s) => !audit.staleStaging.includes(s))
		if (raw.project.staging.length === 0) delete raw.project.staging
	}

	if (raw.import?.tables && audit.staleImport.length > 0) {
		const staleNames = new Set(
			audit.staleImport.map((e) => (typeof e === 'string' ? e : Object.keys(e)[0]))
		)
		raw.import.tables = raw.import.tables.filter((e) => {
			const name = typeof e === 'string' ? e : Object.keys(e)[0]
			return !staleNames.has(name)
		})
	}

	if (raw.export && audit.staleExport.length > 0) {
		raw.export = raw.export.filter((e) => !audit.staleExport.includes(e))
	}

	return dump(raw, { indent: 2 })
}

/**
 * For each export view, check that its columns exist in the corresponding staging table
 * and are in the same relative order.
 *
 * A "corresponding staging table" is a table with the same entity name in any of the
 * project.staging schemas.
 *
 * @param {Object} config - loaded design config (config.project, config.export)
 * @param {Object} adapter - database adapter with parseViewColumns and parseTableSnapshot
 * @returns {Array<{ export: string, stagingTable: string, missingColumns: string[], orderMismatch: boolean }>}
 */
export function checkExportColumns(config, adapter) {
	const stagingSchemas = config.project?.staging ?? []
	const exportEntries = config.export ?? []
	const issues = []

	for (const entry of exportEntries) {
		if (!entry.includes('.')) continue
		const [schema, name] = entry.split('.')

		const viewFile = findDDLFile('view', schema, name)
		if (!viewFile) continue

		// Find corresponding staging table (same entity name in any staging schema)
		let stagingFile = null
		let stagingSchema = null
		for (const s of stagingSchemas) {
			const f = findDDLFile('table', s, name)
			if (f) {
				stagingFile = f
				stagingSchema = s
				break
			}
		}
		if (!stagingFile) continue

		const viewCols = adapter.parseViewColumns({ file: viewFile, name: entry, schema })
		const stagingSnap = adapter.parseTableSnapshot({
			file: stagingFile,
			name: `${stagingSchema}.${name}`,
			schema: stagingSchema
		})
		const stagingCols = stagingSnap.columns.map((c) => c.name)

		const missingColumns = viewCols.filter((c) => !stagingCols.includes(c))
		const shared = viewCols.filter((c) => stagingCols.includes(c))
		const positions = shared.map((c) => stagingCols.indexOf(c))
		const orderMismatch = positions.some((pos, i) => i > 0 && pos < positions[i - 1])

		if (missingColumns.length > 0 || orderMismatch) {
			issues.push({
				export: entry,
				stagingTable: `${stagingSchema}.${name}`,
				missingColumns,
				orderMismatch
			})
		}
	}

	return issues
}
