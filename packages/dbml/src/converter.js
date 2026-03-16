/**
 * DBML conversion — converts SQL DDL to DBML format.
 *
 * Extracts the conversion logic from Design.dbml() into reusable functions.
 * Uses @dbml/core importer for the actual SQL→DBML conversion,
 * with pre-processing (cleanup) and post-processing (schema qualification).
 */
import { importer } from '@dbml/core'

// --- DDL cleanup for DBML conversion ---

/**
 * Remove SQL comment blocks (COMMENT ON, line comments, block comments).
 * Preserves COMMENT ON as a placeholder for downstream processing.
 */
export function removeCommentBlocks(sqlScript) {
	const commentOnRegex = /comment\s+on\s+.*\s+is\s*('[^']*'|"[^"]*");/gis
	const lineCommentRegex = /--[^\n]*(\n|$)/g
	const blockCommentRegex = /\/\*[\s\S]*?\*\//g

	return sqlScript
		.replace(commentOnRegex, '-- COMMENT_PLACEHOLDER;')
		.replace(lineCommentRegex, '\n')
		.replace(blockCommentRegex, ' ')
}

/**
 * Remove CREATE INDEX statements from DDL text.
 */
export function removeIndexCreationStatements(ddlText) {
	const indexCreationRegex = /create\s+(.+)?index[\s\S]*?;\n?/gim
	return ddlText.replace(indexCreationRegex, '')
}

/**
 * Normalize multi-line COMMENT ON TABLE statements to single-line.
 */
export function normalizeComment(inputString) {
	const regex = /comment on table\s+(\w+)\s+IS\s*'([^']*)';/i
	return inputString.replace(regex, (match, tableName, commentContent) => {
		const singleLineComment = commentContent.replace(/\n/g, '\\n').replace(/[\r]+/g, '')
		return `comment on table ${tableName} IS '${singleLineComment.trim()}';`
	})
}

/**
 * Remove COMMENT ON statements from DDL text (including multi-line).
 * These cause @dbml/core to crash on functions, procedures, etc.
 */
export function removeCommentOnStatements(ddlText) {
	const commentOnRegex = /comment\s+on\s+[\s\S]*?'[\s\S]*?'\s*;/gi
	return ddlText.replace(commentOnRegex, '')
}

/**
 * Schema-qualify unqualified CREATE TABLE statements using the entity's schema.
 * @dbml/core doesn't understand `set search_path`, so tables created without
 * a schema prefix won't match cross-schema FK references like `config.profiles(id)`.
 *
 * @param {string} ddlText - DDL text
 * @param {string} schema - entity schema name
 * @returns {string} DDL with schema-qualified CREATE TABLE
 */
/**
 * Build a lookup from unqualified table name to schema-qualified name.
 * When multiple schemas have a table with the same name, the first one wins.
 *
 * @param {Array} entities - entities with name and schema
 * @returns {Object} map of unqualified name → schema.name
 */
export function buildTableLookup(entities) {
	const lookup = {}
	entities
		.filter((e) => e.type === 'table')
		.forEach((e) => {
			const shortName = e.name.replace(e.schema + '.', '')
			if (!lookup[shortName]) {
				lookup[shortName] = e.name
			}
		})
	return lookup
}

export function qualifyTableNames(ddlText, schema, tableLookup) {
	if (!ddlText || !schema) return ddlText
	// Qualify unqualified CREATE TABLE names using entity schema
	let result = ddlText.replace(
		/(create\s+table\s+(?:if\s+not\s+exists\s+)?)([a-z_][a-z0-9_]*)(\s*[(\n])/gi,
		(match, prefix, tableName, suffix) => {
			return `${prefix}${schema}.${tableName}${suffix}`
		}
	)
	// Qualify unqualified REFERENCES <table> using table lookup.
	// Lookahead handles both REFERENCES table(col) and bare REFERENCES table (no column spec).
	if (tableLookup) {
		result = result.replace(
			/(\breferences\s+)([a-z_][a-z0-9_]*)(?=[\s(,;]|$)/gi,
			(match, prefix, tableName) => {
				const qualified = tableLookup[tableName] || `${schema}.${tableName}`
				return `${prefix}${qualified}`
			}
		)
	}
	return result
}

/**
 * Remove inline REFERENCES clauses from column definitions that also appear in
 * table-level FOREIGN KEY constraints. Prevents duplicate FK refs in @dbml/core.
 *
 * @param {string} ddlText - DDL text
 * @returns {string} DDL with redundant inline refs removed
 */
export function removeRedundantInlineRefs(ddlText) {
	const fkColumns = new Set()
	const fkRegex = /\bforeign\s+key\s*\(([^)]+)\)/gi
	let matchResult
	while ((matchResult = fkRegex.exec(ddlText)) !== null) {
		matchResult[1].split(',').forEach((col) => fkColumns.add(col.trim().toLowerCase()))
	}
	if (fkColumns.size === 0) return ddlText

	return ddlText
		.split('\n')
		.map((line) => {
			const colMatch = line.match(/^[ \t]*,?[ \t]*([a-z_][a-z0-9_]*)\s/i)
			if (!colMatch) return line
			if (!fkColumns.has(colMatch[1].toLowerCase())) return line
			return line.replace(/\s+references\s+.+$/i, '')
		})
		.join('\n')
}

/**
 * Clean up DDL text for DBML conversion — removes index statements, COMMENT ON statements,
 * and schema-qualifies unqualified CREATE TABLE statements.
 *
 * @param {string} ddlText - DDL text
 * @param {string} [schema] - entity schema for qualifying table names
 * @param {Object} [tableLookup] - map of unqualified name → schema.name for FK resolution
 */
export function cleanupDDLForDBML(ddlText, schema, tableLookup) {
	if (!ddlText) return ddlText
	let cleaned = removeIndexCreationStatements(ddlText)
	cleaned = removeCommentOnStatements(cleaned)
	if (schema) {
		cleaned = qualifyTableNames(cleaned, schema, tableLookup)
	}
	cleaned = removeRedundantInlineRefs(cleaned)
	return cleaned
}

// --- DBML conversion ---

/**
 * Build schema-qualified table name replacements for DBML output.
 *
 * @param {Array} entities - entities filtered for DBML
 * @returns {Array} replacement rules [{original, replacement}]
 */
export function buildTableReplacements(entities) {
	return entities
		.filter((entity) => entity.type === 'table')
		.map(({ name, schema }) => ({
			name: name.replace(schema + '.', ''),
			schema
		}))
		.map(({ name, schema }) => ({
			original: `Table "${name}"`,
			replacement:
				schema === 'public'
					? `Table "${schema}"."${name}"`
					: `Table "${schema}"."${name}" as "${name}"`
		}))
}

/**
 * Apply schema-qualified table name replacements to DBML output.
 *
 * @param {string} dbml - raw DBML string
 * @param {Array} replacements - from buildTableReplacements()
 * @returns {string} DBML with schema-qualified table names
 */
export function applyTableReplacements(dbml, replacements) {
	let result = dbml
	replacements.map(({ original, replacement }) => {
		result = result.replace(new RegExp(original, 'g'), replacement)
	})
	return result
}

/**
 * Generate the DBML Project block header.
 *
 * @param {string} projectName - project name
 * @param {string} database - database type (e.g. 'PostgreSQL')
 * @param {string} note - project note
 * @returns {string} DBML Project block
 */
export function buildProjectBlock(projectName, database, note) {
	return `Project "${projectName}" {\n database_type: '${database}'\n Note: "${note}" \n}\n`
}

/**
 * Convert combined SQL DDL to DBML format.
 *
 * @param {string} combinedSql - SQL DDL statements joined
 * @param {string} dialect - SQL dialect for @dbml/core (default: 'postgres')
 * @returns {string} raw DBML output
 */
export function convertToDBML(combinedSql, dialect = 'postgres') {
	return importer.import(combinedSql, dialect)
}

/**
 * Generate a complete DBML document from entities.
 *
 * This is the main entry point — takes filtered entities, DDL generator,
 * and project info, and returns {fileName, content} for each dbdocs config.
 *
 * @param {object} params
 * @param {Array} params.entities - all entities
 * @param {object} params.project - project config {name, database, note, dbdocs}
 * @param {function} params.ddlFromEntity - function to generate DDL from entity
 * @param {function} params.filterEntities - function to filter entities for DBML
 * @param {string} [params.file='design.dbml'] - base output filename
 * @returns {Array<{fileName, content}>} generated DBML documents
 */
export function generateDBML({
	entities,
	project,
	ddlFromEntity,
	filterEntities,
	file = 'design.dbml'
}) {
	const keys = Object.keys(project.dbdocs)
	let docs = []

	if (keys.includes('exclude') || keys.includes('include')) {
		docs = [
			{
				config: project.dbdocs,
				project: project.name
			}
		]
	}
	docs = [
		...docs,
		...keys
			.filter((key) => key !== 'exclude' && key !== 'include')
			.map((key) => ({
				config: project.dbdocs[key],
				project: project.name + '-' + key
			}))
	]

	return docs.map((doc) => {
		const filtered = filterEntities(entities, doc.config)
		const tableLookup = buildTableLookup(filtered)
		const combined = filtered.map((entity) =>
			cleanupDDLForDBML(ddlFromEntity(entity), entity.schema, tableLookup)
		)

		const replacements = buildTableReplacements(filtered)
		const combinedSql = combined.join('\n')

		const projectBlock = buildProjectBlock(doc.project, project.database, project.note)
		const fileName = [doc.project, file].join('-')

		try {
			const dbml = convertToDBML(combinedSql)
			const qualifiedDbml = applyTableReplacements(dbml, replacements)

			return {
				fileName,
				content: projectBlock + qualifiedDbml
			}
		} catch (err) {
			return {
				fileName,
				content: null,
				error: err
			}
		}
	})
}
