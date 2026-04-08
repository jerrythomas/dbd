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
 * Remove statements that @dbml/core cannot parse and are not needed for schema generation:
 * GRANT, REVOKE, CREATE/DROP POLICY, ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY.
 */
export function removeNonSchemaStatements(ddlText) {
	return ddlText
		.replace(/^\s*grant\s[\s\S]*?;\n?/gim, '')
		.replace(/^\s*revoke\s[\s\S]*?;\n?/gim, '')
		.replace(/^\s*create\s+(?:or\s+replace\s+)?policy\s[\s\S]*?;\n?/gim, '')
		.replace(/^\s*drop\s+policy\s[\s\S]*?;\n?/gim, '')
		.replace(/^\s*alter\s+table\s+\S+\s+(?:enable|disable)\s+row\s+level\s+security\s*;\n?/gim, '')
}

/**
 * Normalize multi-line COMMENT ON TABLE statements to single-line.
 * @deprecated Use normalizeComments() instead.
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
 * @deprecated Use normalizeComments() instead.
 */
export function removeCommentOnStatements(ddlText) {
	const commentOnRegex = /comment\s+on\s+[\s\S]*?'[\s\S]*?'\s*;/gi
	return ddlText.replace(commentOnRegex, '')
}

// SQL string literal pattern — handles '' as escaped apostrophe
const SQL_STR = "'[^']*(?:''[^']*)*'"

/**
 * Normalize COMMENT ON TABLE and COMMENT ON COLUMN statements for @dbml/core:
 * - Flattens multi-line comment strings to single-line
 * - Converts SQL escaped apostrophes ('') to Unicode right single quotation mark
 * - Removes COMMENT ON for other object types (function, procedure, etc.)
 *
 * @dbml/core v6 parses TABLE and COLUMN comments natively but crashes on
 * multi-line strings and SQL apostrophe escapes.
 *
 * @param {string} ddlText - DDL text
 * @returns {string} DDL with normalized COMMENT ON TABLE/COLUMN, others removed
 */
export function normalizeComments(ddlText) {
	// Normalize COMMENT ON TABLE/COLUMN: flatten and sanitize the string value
	const tableColPattern = new RegExp(
		`(comment\\s+on\\s+(?:table|column)\\s+\\S+\\s+is\\s*)(${SQL_STR})\\s*;`,
		'gi'
	)
	let result = ddlText.replace(tableColPattern, (match, prefix, quotedContent) => {
		const content = quotedContent.slice(1, -1)
		const normalized = content
			.replace(/\r?\n/g, ' ')
			.replace(/''/g, '\u2019') // SQL '' escape → Unicode right single quotation mark
			.trim()
		return `${prefix}'${normalized}';`
	})

	// Remove COMMENT ON for non-table/non-column object types
	const otherPattern = new RegExp(
		`comment\\s+on\\s+(?!table\\s|column\\s)\\S+[\\s\\S]*?${SQL_STR}\\s*;`,
		'gi'
	)
	return result.replace(otherPattern, '')
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
	// Qualify unqualified COMMENT ON TABLE names
	result = result.replace(
		/(comment\s+on\s+table\s+)([a-z_][a-z0-9_]*)(\s+is)/gi,
		(match, prefix, tableName, suffix) => `${prefix}${schema}.${tableName}${suffix}`
	)
	// Qualify unqualified COMMENT ON COLUMN table.column names
	result = result.replace(
		/(comment\s+on\s+column\s+)([a-z_][a-z0-9_]*)(\.[a-z_][a-z0-9_.]*\s+is)/gi,
		(match, prefix, tableName, suffix) => `${prefix}${schema}.${tableName}${suffix}`
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
	cleaned = removeNonSchemaStatements(cleaned)
	cleaned = normalizeComments(cleaned)
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
		.filter((entity) => entity.type === 'table' || entity.type === 'external')
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
	const noteBlock = note ? `\n Note: "${note}"` : ''
	return `Project "${projectName}" {\n database_type: '${database}'${noteBlock}\n}\n`
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
	const docs = buildDocList(project, file)

	return docs.map((doc) => {
		const filtered = filterEntities(entities, doc.config)
		const tableLookup = buildTableLookup(filtered)
		const combined = filtered.map((entity) =>
			cleanupDDLForDBML(ddlFromEntity(entity), entity.schema, tableLookup)
		)

		const replacements = buildTableReplacements(filtered)
		const projectBlock = buildProjectBlock(doc.project, project.database, project.note)

		try {
			const dbml = convertToDBML(combined.join('\n'))
			return {
				fileName: doc.fileName,
				content: projectBlock + applyTableReplacements(dbml, replacements)
			}
		} catch (err) {
			return { fileName: doc.fileName, content: null, error: err }
		}
	})
}

/**
 * Build the list of DBML doc descriptors from the project config.
 * When project.dbdocs is absent, returns a single descriptor covering all entities.
 * @param {Object} project
 * @param {string} file - base filename
 * @returns {Array<{config, project, fileName}>}
 */
function buildDocList(project, file) {
	if (!project.dbdocs) {
		return [{ config: {}, project: project.name, fileName: file }]
	}

	const keys = Object.keys(project.dbdocs)
	let docs = []

	if (keys.includes('exclude') || keys.includes('include')) {
		docs = [
			{ config: project.dbdocs, project: project.name, fileName: [project.name, file].join('-') }
		]
	}

	return [
		...docs,
		...keys
			.filter((key) => key !== 'exclude' && key !== 'include')
			.map((key) => ({
				config: project.dbdocs[key],
				project: project.name + '-' + key,
				fileName: [project.name + '-' + key, file].join('-')
			}))
	]
}
