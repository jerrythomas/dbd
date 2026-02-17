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
 * Clean up DDL text for DBML conversion — removes index statements and COMMENT ON statements.
 */
export function cleanupDDLForDBML(ddlText) {
	if (!ddlText) return ddlText
	let cleaned = removeIndexCreationStatements(ddlText)
	cleaned = removeCommentOnStatements(cleaned)
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
		const combined = filtered
			.map((entity) => ddlFromEntity(entity))
			.map((ddl) => cleanupDDLForDBML(ddl))

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
