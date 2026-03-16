/**
 * Translator for CREATE TABLE statements.
 * @module translators/create-table
 */

import { resolveTypeName, resolveDefaultExpr } from './types.js'

/**
 * Process raw pgsql-parser constraints for a single column.
 * Returns { nullable, defaultValue, isPrimaryKey, constraints }.
 */
const translateColumnConstraints = (rawConstraints) => {
	let nullable = true
	let defaultValue = null
	let isPrimaryKey = false
	const constraints = []

	for (const c of rawConstraints) {
		const con = c.Constraint
		switch (con.contype) {
			case 'CONSTR_NOTNULL':
				nullable = false
				break
			case 'CONSTR_DEFAULT':
				defaultValue = resolveDefaultExpr(con.raw_expr)
				break
			case 'CONSTR_PRIMARY':
				isPrimaryKey = true
				nullable = false
				constraints.push({ type: 'PRIMARY KEY' })
				break
			case 'CONSTR_UNIQUE':
				constraints.push({ type: 'UNIQUE' })
				break
			case 'CONSTR_FOREIGN':
				constraints.push({
					type: 'FOREIGN KEY',
					table: con.pktable.relname,
					schema: con.pktable?.schemaname || null,
					column: con.pk_attrs?.[0]?.String?.sval || 'id'
				})
				break
			case 'CONSTR_CHECK':
				constraints.push({ type: 'CHECK' })
				break
		}
	}

	return { nullable, defaultValue, isPrimaryKey, constraints }
}

/**
 * Build the compat spread properties expected by extractors.
 */
const buildColumnCompatShape = (
	name,
	dataType,
	nullable,
	defaultValue,
	isPrimaryKey,
	constraints
) => {
	const fk = constraints.find((c) => c.type === 'FOREIGN KEY')

	return {
		column: { column: { expr: { type: 'default', value: name } } },
		definition: { dataType: dataType.toUpperCase() },
		...(isPrimaryKey ? { primary_key: 'primary key' } : {}),
		...(nullable ? {} : { nullable: { type: 'not null', value: 'not null' } }),
		...(defaultValue !== null
			? {
					default_val: {
						type: 'default',
						value:
							typeof defaultValue === 'string' && defaultValue.includes('(')
								? {
										type: 'function',
										name: { name: [{ value: defaultValue.replace(/\(\)$/, '') }] },
										args: { type: 'expr_list', value: [] }
									}
								: defaultValue
					}
				}
			: {}),
		...(fk
			? {
					reference_definition: {
						table: [{ table: fk.table, schema: fk.schema }],
						definition: [{ column: { expr: { value: fk.column } } }]
					}
				}
			: {})
	}
}

export const translateColumnDef = (colDef) => {
	const cd = colDef.ColumnDef
	const dataType = resolveTypeName(cd.typeName)
	const { nullable, defaultValue, isPrimaryKey, constraints } = translateColumnConstraints(
		cd.constraints || []
	)

	return {
		name: cd.colname,
		dataType,
		nullable,
		defaultValue,
		constraints,
		...buildColumnCompatShape(
			cd.colname,
			dataType,
			nullable,
			defaultValue,
			isPrimaryKey,
			constraints
		)
	}
}

export const translateTableConstraint = (constraint) => {
	const con = constraint.Constraint
	const base = { resource: 'constraint' }

	switch (con.contype) {
		case 'CONSTR_PRIMARY':
			return {
				...base,
				type: 'primary_key',
				constraint: 'PRIMARY KEY',
				conname: con.conname,
				keys: con.keys.map((k) => k.String?.sval).filter(Boolean)
			}
		case 'CONSTR_UNIQUE':
			return {
				...base,
				type: 'unique',
				constraint: 'UNIQUE',
				conname: con.conname,
				keys: con.keys.map((k) => k.String?.sval).filter(Boolean)
			}
		case 'CONSTR_FOREIGN':
			return {
				...base,
				type: 'foreign_key',
				constraint: 'FOREIGN KEY',
				conname: con.conname,
				fk_attrs: con.fk_attrs.map((k) => k.String?.sval).filter(Boolean),
				pktable: {
					relname: con.pktable?.relname,
					schemaname: con.pktable?.schemaname
				},
				pk_attrs: (con.pk_attrs || []).map((k) => k.String?.sval).filter(Boolean)
			}
		case 'CONSTR_CHECK':
			return { ...base, type: 'check', constraint: 'CHECK', conname: con.conname }
		default:
			return null
	}
}

export const translateCreateStmt = (createStmt, originalSql) => {
	const rel = createStmt.relation
	const columnDefs = createStmt.tableElts.filter((e) => e.ColumnDef)
	const tableConstraints = createStmt.tableElts.filter((e) => e.Constraint)

	const columns = columnDefs.map(translateColumnDef).filter(Boolean)

	// Apply table-level FK constraints to matching columns
	for (const tc of tableConstraints) {
		const con = tc.Constraint
		if (con?.contype === 'CONSTR_FOREIGN' && con.fk_attrs?.length) {
			const fkColName = con.fk_attrs[0].String?.sval
			const col = columns.find((c) => c.name === fkColName)
			if (col) {
				const fk = {
					type: 'FOREIGN KEY',
					table: con.pktable.relname,
					schema: con.pktable?.schemaname || null,
					column: con.pk_attrs?.[0]?.String?.sval || 'id'
				}
				col.constraints.push(fk)
				col.reference_definition = {
					table: [{ table: fk.table, schema: fk.schema }],
					definition: [{ column: { expr: { value: fk.column } } }]
				}
			}
		}
		if (con?.contype === 'CONSTR_PRIMARY' && con.keys?.length) {
			for (const key of con.keys) {
				const colName = key.String?.sval
				const col = columns.find((c) => c.name === colName)
				if (col) {
					col.nullable = false
					if (!col.constraints.some((c) => c.type === 'PRIMARY KEY')) {
						col.constraints.push({ type: 'PRIMARY KEY' })
					}
					col.primary_key = 'primary key'
				}
			}
		}
	}

	return {
		type: 'create',
		keyword: 'table',
		table: [
			{
				db: rel.schemaname || null,
				schema: rel.schemaname || null,
				table: rel.relname,
				as: null
			}
		],
		if_not_exists: createStmt.if_not_exists || false,
		create_definitions: columns,
		_table_constraints: tableConstraints.map(translateTableConstraint).filter(Boolean),
		_original_sql: originalSql
	}
}
