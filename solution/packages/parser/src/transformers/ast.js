/**
 * AST transformation utilities
 * @module transformers/ast
 */

import { curry, pipe, map, when, propEq, assoc, prop, has } from 'ramda'

/**
 * Normalize AST structure to make it consistent regardless of SQL dialect
 * @param {Array} ast - SQL AST to normalize
 * @returns {Array} Normalized AST
 */
export const normalizeAst = (ast) => {
	// Handle case where ast is a single statement
	const statements = Array.isArray(ast) ? ast : [ast]

	return map(
		pipe(
			normalizeCreateTable,
			normalizeCreateView,
			normalizeCreateProcedure,
			normalizeCreateIndex,
			normalizeComment
		),
		statements
	)
}

/**
 * Normalize CREATE TABLE statements
 * @param {Object} stmt - Statement to normalize
 * @returns {Object} Normalized statement
 */
export const normalizeCreateTable = when(
	(stmt) => stmt.type === 'create' && stmt.keyword === 'table',
	(stmt) => ({
		...stmt,
		tableName: extractTableName(stmt),
		tableSchema: extractTableSchema(stmt),
		columns: extractNormalizedColumns(stmt),
		constraints: extractNormalizedConstraints(stmt)
	})
)

/**
 * Normalize CREATE VIEW statements
 * @param {Object} stmt - Statement to normalize
 * @returns {Object} Normalized statement
 */
export const normalizeCreateView = when(
	(stmt) => stmt.type === 'create' && stmt.keyword === 'view',
	(stmt) => ({
		...stmt,
		viewName: extractViewName(stmt),
		viewSchema: extractViewSchema(stmt),
		isReplace: !!stmt.replace,
		columns: extractViewColumns(stmt),
		dependencies: extractViewDependencies(stmt)
	})
)

/**
 * Normalize CREATE PROCEDURE statements
 * @param {Object} stmt - Statement to normalize
 * @returns {Object} Normalized statement
 */
export const normalizeCreateProcedure = when(
	(stmt) => stmt.type === 'create' && stmt.keyword === 'procedure',
	(stmt) => ({
		...stmt,
		procedureName: stmt.procedure,
		procedureSchema: stmt.schema,
		isReplace: !!stmt.replace,
		language: stmt.language || 'sql',
		parameters: normalizeParameters(stmt.parameters),
		body: stmt.as || ''
	})
)

/**
 * Normalize CREATE INDEX statements
 * @param {Object} stmt - Statement to normalize
 * @returns {Object} Normalized statement
 */
export const normalizeCreateIndex = when(
	(stmt) => stmt.type === 'create' && stmt.keyword === 'index',
	(stmt) => ({
		...stmt,
		indexName: extractIndexName(stmt),
		indexSchema: extractIndexSchema(stmt),
		tableName: extractIndexTable(stmt),
		tableSchema: extractIndexTableSchema(stmt),
		isUnique: !!stmt.unique,
		columns: extractIndexColumns(stmt)
	})
)

/**
 * Normalize COMMENT statements
 * @param {Object} stmt - Statement to normalize
 * @returns {Object} Normalized statement
 */
export const normalizeComment = when(propEq('type', 'comment'), (stmt) => ({
	...stmt,
	targetType: stmt.target?.type || stmt.on?.type,
	targetName: extractCommentTargetName(stmt),
	targetSchema: extractCommentTargetSchema(stmt),
	targetColumn: extractCommentTargetColumn(stmt),
	comment: extractCommentText(stmt)
}))

/**
 * Extract table name from CREATE TABLE statement
 * @param {Object} stmt - Statement to extract from
 * @returns {string} Table name
 */
export const extractTableName = (stmt) => {
	if (stmt.table && Array.isArray(stmt.table) && stmt.table.length > 0) {
		return stmt.table[0].table
	}
	return null
}

/**
 * Extract table schema from CREATE TABLE statement
 * @param {Object} stmt - Statement to extract from
 * @returns {string|null} Table schema or null
 */
export const extractTableSchema = (stmt) => {
	if (stmt.table && Array.isArray(stmt.table) && stmt.table.length > 0) {
		return stmt.table[0].schema
	}
	return null
}

/**
 * Extract view name from CREATE VIEW statement
 * @param {Object} stmt - Statement to extract from
 * @returns {string} View name
 */
export const extractViewName = (stmt) => {
	if (typeof stmt.view === 'object' && stmt.view.view) {
		return stmt.view.view
	}
	return stmt.view
}

/**
 * Extract view schema from CREATE VIEW statement
 * @param {Object} stmt - Statement to extract from
 * @returns {string|null} View schema or null
 */
export const extractViewSchema = (stmt) => {
	if (typeof stmt.view === 'object' && stmt.view.schema) {
		return stmt.view.schema
	}
	return stmt.schema
}

/**
 * Extract index name from CREATE INDEX statement
 * @param {Object} stmt - Statement to extract from
 * @returns {string|null} Index name
 */
export const extractIndexName = (stmt) => {
	if (stmt.index?.name) {
		return stmt.index.name
	} else if (stmt.IndexName) {
		return stmt.IndexName
	} else if (stmt.indexname) {
		return stmt.indexname
	}
	return null
}

/**
 * Extract index schema from CREATE INDEX statement
 * @param {Object} stmt - Statement to extract from
 * @returns {string|null} Index schema or null
 */
export const extractIndexSchema = (stmt) => {
	if (stmt.index?.schema) {
		return stmt.index.schema
	}
	return null
}

/**
 * Extract table name from CREATE INDEX statement
 * @param {Object} stmt - Statement to extract from
 * @returns {string|null} Table name
 */
export const extractIndexTable = (stmt) => {
	if (stmt.table?.table) {
		return stmt.table.table
	} else if (stmt.table_name?.[0]?.table) {
		return stmt.table_name[0].table
	} else if (stmt.relationName) {
		return stmt.relationName
	}
	return null
}

/**
 * Extract table schema from CREATE INDEX statement
 * @param {Object} stmt - Statement to extract from
 * @returns {string|null} Table schema or null
 */
export const extractIndexTableSchema = (stmt) => {
	if (stmt.table?.schema) {
		return stmt.table.schema
	} else if (stmt.table_name?.[0]?.schema) {
		return stmt.table_name[0].schema
	}
	return null
}

/**
 * Extract normalized columns from CREATE TABLE statement
 * @param {Object} stmt - Statement to extract from
 * @returns {Array} Normalized column definitions
 */
export const extractNormalizedColumns = (stmt) => {
	if (!stmt.create_definitions) return []

	return stmt.create_definitions
		.filter((colDef) => colDef.column || colDef.ColumnDef)
		.map((colDef) => {
			const columnDef = colDef.ColumnDef || colDef

			// Extract column name from nested structure
			let columnName
			if (columnDef.column?.column?.expr?.value) {
				columnName = columnDef.column.column.expr.value
			} else if (columnDef.column?.column) {
				columnName = columnDef.column.column
			} else {
				columnName = columnDef.colname
			}

			// Extract data type
			let dataType = null
			if (columnDef.definition) {
				const def = columnDef.definition
				dataType =
					def.dataType?.toLowerCase() ||
					def.typeName?.names
						?.map((n) => n.String?.str)
						.join('.')
						?.toLowerCase()

				// Add length/precision specification
				if (def.length?.value) {
					dataType += `(${def.length.value})`
				} else if (def.typeName?.typmods && def.typeName.typmods.length > 0) {
					const typmods = def.typeName.typmods
						.map((tm) => tm.A_Const?.val?.Integer?.ival)
						.filter((t) => t !== undefined)

					if (typmods.length > 0) {
						dataType += `(${typmods.join(', ')})`
					}
				}
			}

			// Check if nullable
			const isNullable = !checkNotNull(columnDef)

			// Extract default value
			const defaultValue = extractDefaultValue(columnDef)

			// Extract constraints
			const constraints = extractColumnConstraints(columnDef)

			return {
				name: columnName,
				dataType,
				nullable: isNullable,
				defaultValue,
				constraints
			}
		})
}

/**
 * Check if a column is NOT NULL
 * @param {Object} columnDef - Column definition
 * @returns {boolean} True if the column is NOT NULL
 */
export const checkNotNull = (columnDef) => {
	// Check various ways nullability might be specified
	if (columnDef.nullable?.not) return true
	if (columnDef.nullable?.type === 'not null') return true
	if (columnDef.nullable?.value === 'not null') return true

	// Primary key columns are implicitly NOT NULL
	if (columnDef.primary_key) return true

	// Check constraints for NOT NULL
	if (columnDef.constraints) {
		for (const constraint of columnDef.constraints) {
			if (constraint.Constraint?.contype === 'CONSTR_NOTNULL' || constraint.type === 'not null') {
				return true
			}
		}
	}

	return false
}

/**
 * Extract column constraints from column definition
 * @param {Object} columnDef - Column definition
 * @returns {Array} Extracted constraints
 */
export const extractColumnConstraints = (columnDef) => {
	const constraints = []

	// Primary key
	if (columnDef.primary_key) {
		constraints.push({ type: 'PRIMARY KEY' })
	} else if (columnDef.constraints) {
		for (const constraint of columnDef.constraints) {
			if (
				constraint.Constraint?.contype === 'CONSTR_PRIMARY' ||
				constraint.type === 'primary key'
			) {
				constraints.push({ type: 'PRIMARY KEY' })
				break
			}
		}
	}

	// Foreign key
	if (columnDef.reference_definition) {
		// Extract column name from the nested structure if present
		let refColumn = 'id'
		const refDefinition = columnDef.reference_definition.definition
		if (refDefinition && refDefinition.length > 0) {
			if (refDefinition[0].column?.expr?.value) {
				refColumn = refDefinition[0].column.expr.value
			} else if (refDefinition[0].column) {
				refColumn = refDefinition[0].column
			}
		}

		const fk = {
			type: 'FOREIGN KEY',
			table: columnDef.reference_definition.table[0].table,
			schema: columnDef.reference_definition.table[0].schema,
			column: refColumn
		}
		constraints.push(fk)
	} else if (columnDef.constraints) {
		for (const constraint of columnDef.constraints) {
			if (constraint.Constraint?.contype === 'CONSTR_FOREIGN') {
				const fk = {
					type: 'FOREIGN KEY',
					table: constraint.Constraint.pktable.relname,
					schema: constraint.Constraint.pktable.schemaname,
					column: constraint.Constraint.pk_attrs?.[0]?.String?.str || 'id'
				}
				constraints.push(fk)
				break
			}
		}
	}

	return constraints
}

/**
 * Extract default value from column definition
 * @param {Object} columnDef - Column definition
 * @returns {string|null} Default value or null
 */
export const extractDefaultValue = (columnDef) => {
	if (!columnDef) return null

	const defaultVal = columnDef.default_val
	if (!defaultVal) return null

	if (typeof defaultVal === 'string') {
		return defaultVal
	} else if (defaultVal.type === 'default') {
		if (typeof defaultVal.value === 'string') {
			return defaultVal.value
		} else if (defaultVal.value?.type === 'function') {
			return formatFunction(defaultVal.value)
		}
	}

	return null
}

/**
 * Format function call for default values
 * @param {Object} func - Function object
 * @returns {string} Formatted function call
 */
export const formatFunction = (func) => {
	if (!func.name) return '[FUNCTION]'

	const name =
		func.name.name?.[0]?.value ||
		(Array.isArray(func.name.name)
			? func.name.name.map((n) => n.value || n).join('.')
			: func.name.name)

	const args = func.args?.value || []
	const argsStr = args
		.map((arg) => {
			if (typeof arg === 'string') return arg
			if (arg.value) return arg.value
			return ''
		})
		.join(', ')

	return `${name}(${argsStr})`
}

/**
 * Extract comment target name from COMMENT statement
 * @param {Object} stmt - Comment statement
 * @returns {string|null} Target name or null
 */
export const extractCommentTargetName = (stmt) => {
	const target = stmt.target || stmt.on
	if (!target) return null

	if (target.type === 'table') {
		return target.name?.table || target.target?.[0]?.table
	} else if (target.type === 'column') {
		return target.name?.table || target.target?.[0]?.table
	}

	return null
}

/**
 * Extract comment target schema from COMMENT statement
 * @param {Object} stmt - Comment statement
 * @returns {string|null} Target schema or null
 */
export const extractCommentTargetSchema = (stmt) => {
	const target = stmt.target || stmt.on
	if (!target) return null

	if (target.type === 'table') {
		return target.name?.schema || target.target?.[0]?.schema
	} else if (target.type === 'column') {
		return target.name?.schema || target.target?.[0]?.schema
	}

	return null
}

/**
 * Extract comment target column from COMMENT statement
 * @param {Object} stmt - Comment statement
 * @returns {string|null} Target column or null
 */
export const extractCommentTargetColumn = (stmt) => {
	const target = stmt.target || stmt.on
	if (!target || target.type !== 'column') return null

	if (target.name?.column?.expr?.value) {
		return target.name.column.expr.value
	} else if (target.target?.[1]?.column) {
		return target.target[1].column
	}

	return null
}

/**
 * Extract comment text from COMMENT statement
 * @param {Object} stmt - Comment statement
 * @returns {string|null} Comment text or null
 */
export const extractCommentText = (stmt) => {
	if (stmt.expr?.expr?.value) {
		return stmt.expr.expr.value
	} else if (stmt.comment?.value) {
		return stmt.comment.value
	}

	return null
}

/**
 * Extract normalized constraints from CREATE TABLE statement
 * @param {Object} stmt - Statement to extract from
 * @returns {Array} Normalized table constraints
 */
export const extractNormalizedConstraints = (stmt) => {
	const constraints = []

	// TODO: Extract table-level constraints

	return constraints
}

/**
 * Extract view columns from CREATE VIEW statement
 * @param {Object} stmt - Statement to extract from
 * @returns {Array} Extracted view columns
 */
export const extractViewColumns = (stmt) => {
	if (!stmt.select || !stmt.select.columns) return []

	return stmt.select.columns.map((col) => {
		let name, source

		// Handle column alias
		if (col.as) {
			name = col.as
		} else if (col.expr.column) {
			name = col.expr.column
		} else {
			name = '[EXPRESSION]'
		}

		// Handle column source
		if (col.expr.type === 'column_ref') {
			source = {
				table: col.expr.table,
				column: col.expr.column
			}
		} else if (col.expr.type === 'binary_expr' && col.expr.operator === '->') {
			// JSONB operator extraction
			source = {
				type: 'json_extract',
				expression: `${col.expr.left.column} -> ${col.expr.right.value}`
			}
		}

		return { name, source }
	})
}

/**
 * Extract view dependencies from CREATE VIEW statement
 * @param {Object} stmt - Statement to extract from
 * @returns {Array} Extracted dependencies
 */
export const extractViewDependencies = (stmt) => {
	if (!stmt.select || !stmt.select.from) return []

	const dependencies = []
	const addDependency = (table) => {
		if (table.table) {
			dependencies.push({
				table: table.table,
				schema: table.db || table.schema
			})
		}
	}

	const from = stmt.select.from

	// Handle simple FROM tables
	if (Array.isArray(from)) {
		from.forEach((item) => {
			if (item.table) {
				addDependency(item)
			} else if (item.expr) {
				// Subquery - could recursively extract but for now just mark as expression
				dependencies.push({ type: 'subquery' })
			}
		})
	}

	// Handle JOINs
	from.forEach((item) => {
		if (item.join) {
			addDependency(item.join)
		}
	})

	return dependencies
}

/**
 * Extract index columns from CREATE INDEX statement
 * @param {Object} stmt - Statement to extract from
 * @returns {Array} Extracted index columns
 */
export const extractIndexColumns = (stmt) => {
	if (!stmt.columns || !Array.isArray(stmt.columns)) return []

	return stmt.columns
		.map((col) => {
			let colName = null

			if (col.column?.column?.expr?.value) {
				colName = col.column.column.expr.value
			} else if (col.column?.column) {
				colName = col.column.column
			} else if (col.name) {
				colName = col.name
			} else if (col.expr?.column) {
				colName = col.expr.column
			}

			return {
				name: colName,
				order: col.order || 'asc'
			}
		})
		.filter((col) => col.name)
}

/**
 * Normalize procedure parameters
 * @param {Array} parameters - Procedure parameters
 * @returns {Array} Normalized parameters
 */
export const normalizeParameters = (parameters) => {
	if (!parameters) return []

	if (Array.isArray(parameters)) {
		return parameters.map((param) => ({
			name: param.name,
			dataType: param.dataType?.dataType?.toLowerCase() || 'unknown',
			mode: param.mode?.toLowerCase() || 'in'
		}))
	}

	return []
}
