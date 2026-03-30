/**
 * Migration SQL generator — pure functions.
 * Converts a schema diff into ordered ALTER/CREATE/DROP SQL statements.
 *
 * Ordering within a generated migration:
 *   1. CREATE new schemas (IF NOT EXISTS)
 *   2. CREATE new tables
 *   3. ALTER TABLE ADD COLUMN / ALTER COLUMN
 *   4. CREATE / DROP INDEX
 *   5. ADD / DROP FK constraints
 *   6. ALTER TABLE DROP COLUMN (destructive — last for table changes)
 *   7. DROP TABLE (reverse dep order — destructive last)
 */

const quote = (name) => `"${name}"`
const qualifiedName = (schema, name) => (schema ? `${quote(schema)}.${quote(name)}` : quote(name))

// --- Column SQL helpers ---

const columnTypeSQL = (col) => {
	const base = col.dataType || 'text'
	const nullable = col.nullable === false ? ' NOT NULL' : ''
	const def =
		col.defaultValue !== null && col.defaultValue !== undefined
			? ` DEFAULT ${col.defaultValue}`
			: ''
	const pk = (col.constraints || []).some((c) => c.type === 'PRIMARY KEY') ? ' PRIMARY KEY' : ''
	return `${base}${nullable}${def}${pk}`
}

const addColumnSQL = (tableName, col) =>
	`ALTER TABLE ${tableName} ADD COLUMN ${quote(col.name)} ${columnTypeSQL(col)};`

const dropColumnSQL = (tableName, colName) =>
	`-- WARNING: Drops column and its data\nALTER TABLE ${tableName} DROP COLUMN ${quote(colName)};`

const alterColumnTypeSQL = (tableName, colName, toType) =>
	`-- WARNING: Type change may fail if existing data cannot be cast\nALTER TABLE ${tableName} ALTER COLUMN ${quote(colName)} TYPE ${toType};`

const alterColumnNullableSQL = (tableName, colName, nullable) =>
	nullable
		? `ALTER TABLE ${tableName} ALTER COLUMN ${quote(colName)} DROP NOT NULL;`
		: `-- WARNING: May fail if NULL values exist\nALTER TABLE ${tableName} ALTER COLUMN ${quote(colName)} SET NOT NULL;`

const alterColumnDefaultSQL = (tableName, colName, defaultValue) =>
	defaultValue !== null && defaultValue !== undefined
		? `ALTER TABLE ${tableName} ALTER COLUMN ${quote(colName)} SET DEFAULT ${defaultValue};`
		: `ALTER TABLE ${tableName} ALTER COLUMN ${quote(colName)} DROP DEFAULT;`

// --- Index SQL helpers ---

const createIndexSQL = (tableName, idx) => {
	const unique = idx.unique ? 'UNIQUE ' : ''
	const cols = idx.columns
		.map((c) => `${quote(c.name)}${c.order === 'DESC' ? ' DESC' : ''}`)
		.join(', ')
	return `CREATE ${unique}INDEX IF NOT EXISTS ${quote(idx.name)} ON ${tableName} (${cols});`
}

const dropIndexSQL = (idx) => `DROP INDEX IF EXISTS ${quote(idx.name)};`

// --- FK SQL helpers ---

const addFKSQL = (tableName, fk) => {
	const cols = fk.columns.map(quote).join(', ')
	const ref = qualifiedName(fk.refSchema, fk.refTable)
	const refCols = (fk.refColumns || []).map(quote).join(', ')
	const name = fk.name ? ` CONSTRAINT ${quote(fk.name)}` : ''
	return `ALTER TABLE ${tableName} ADD${name} FOREIGN KEY (${cols}) REFERENCES ${ref}${refCols ? ` (${refCols})` : ''};`
}

const dropFKSQL = (tableName, fk) =>
	fk.name
		? `ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${quote(fk.name)};`
		: `-- WARNING: Cannot drop unnamed FK constraint on ${tableName}`

// --- Table creation SQL helper (from snapshot table entry) ---

const createTableSQL = (table) => {
	const name = qualifiedName(table.schema, table.name.split('.').pop())
	const colDefs = (table.columns || []).map((col) => `  ${quote(col.name)} ${columnTypeSQL(col)}`)

	const tableConstraints = (table.tableConstraints || [])
		.map((c) => {
			if (c.type === 'FOREIGN KEY') {
				const cols = c.columns.map(quote).join(', ')
				const ref = qualifiedName(c.refSchema, c.refTable)
				const refCols = (c.refColumns || []).map(quote).join(', ')
				const constraintName = c.name ? `CONSTRAINT ${quote(c.name)} ` : ''
				return `  ${constraintName}FOREIGN KEY (${cols}) REFERENCES ${ref}${refCols ? ` (${refCols})` : ''}`
			}
			if (c.type === 'UNIQUE') {
				const cols = c.columns.map(quote).join(', ')
				const constraintName = c.name ? `CONSTRAINT ${quote(c.name)} ` : ''
				return `  ${constraintName}UNIQUE (${cols})`
			}
			return null
		})
		.filter(Boolean)

	const allDefs = [...colDefs, ...tableConstraints].join(',\n')
	return `CREATE TABLE IF NOT EXISTS ${name} (\n${allDefs}\n);`
}

/**
 * Generate ordered migration SQL from a schema diff.
 *
 * @param {Object} diff - Result of diffSnapshots()
 * @returns {string} SQL migration script
 */
export const generateMigrationSQL = (diff) => {
	const lines = [
		`-- Migration: version ${diff.fromVersion} → ${diff.toVersion}`,
		`-- Generated: ${new Date().toISOString()}`,
		''
	]

	// 1. CREATE new tables
	for (const table of diff.addedTables || []) {
		lines.push(createTableSQL(table))
		lines.push('')
	}

	// 2. ALTER TABLE ADD COLUMN / MODIFY COLUMN (on existing tables)
	for (const table of diff.alteredTables || []) {
		const tName = qualifiedName(table.schema, table.name.split('.').pop())

		for (const col of table.addedColumns || []) {
			lines.push(addColumnSQL(tName, col))
		}

		for (const { column, changes } of table.alteredColumns || []) {
			for (const change of changes) {
				if (change.field === 'type') lines.push(alterColumnTypeSQL(tName, column, change.to))
				else if (change.field === 'nullable')
					lines.push(alterColumnNullableSQL(tName, column, change.to))
				else if (change.field === 'default')
					lines.push(alterColumnDefaultSQL(tName, column, change.to))
			}
		}
	}

	// 3. CREATE / DROP INDEX
	for (const table of diff.alteredTables || []) {
		const tName = qualifiedName(table.schema, table.name.split('.').pop())
		for (const idx of table.droppedIndexes || []) lines.push(dropIndexSQL(idx))
		for (const idx of table.addedIndexes || []) lines.push(createIndexSQL(tName, idx))
	}
	for (const table of diff.addedTables || []) {
		const tName = qualifiedName(table.schema, table.name.split('.').pop())
		for (const idx of table.indexes || []) lines.push(createIndexSQL(tName, idx))
	}

	// 4. ADD / DROP FK constraints
	for (const table of diff.alteredTables || []) {
		const tName = qualifiedName(table.schema, table.name.split('.').pop())
		for (const fk of table.droppedFKs || []) lines.push(dropFKSQL(tName, fk))
		for (const fk of table.addedFKs || []) lines.push(addFKSQL(tName, fk))
	}

	// 5. DROP COLUMN (destructive — last for existing tables)
	for (const table of diff.alteredTables || []) {
		const tName = qualifiedName(table.schema, table.name.split('.').pop())
		for (const col of table.droppedColumns || []) lines.push(dropColumnSQL(tName, col.name))
	}

	// 6. DROP TABLE (destructive — reverse dep order, last)
	for (const table of [...(diff.droppedTables || [])].reverse()) {
		const tName = qualifiedName(table.schema, table.name.split('.').pop())
		lines.push(`-- WARNING: Drops table and all its data\nDROP TABLE IF EXISTS ${tName};`)
		lines.push('')
	}

	const sql = lines.join('\n').trimEnd()
	return sql
}
