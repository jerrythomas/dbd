/**
 * Schema diff — pure functions for comparing two snapshots.
 * Only diffs tables, indexes, and FK references.
 * Views/functions/procedures/triggers are not diffed (they use CREATE OR REPLACE).
 */

/**
 * Compare two column definitions and return a list of changes.
 * @param {Object} from
 * @param {Object} to
 * @returns {Array<{field, from, to}>}
 */
const diffColumn = (from, to) => {
	const changes = []
	const normalizeType = (t) => (t || '').toLowerCase().trim()
	if (normalizeType(from.dataType) !== normalizeType(to.dataType))
		changes.push({ field: 'type', from: from.dataType, to: to.dataType })
	if (!!from.nullable !== !!to.nullable)
		changes.push({ field: 'nullable', from: from.nullable, to: to.nullable })
	if ((from.defaultValue ?? null) !== (to.defaultValue ?? null))
		changes.push({ field: 'default', from: from.defaultValue ?? null, to: to.defaultValue ?? null })
	return changes
}

/**
 * Compare two index definitions by name equality and column list.
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
const indexesEqual = (a, b) => {
	if (!!a.unique !== !!b.unique) return false
	if (a.columns.length !== b.columns.length) return false
	return a.columns.every(
		(col, i) => col.name === b.columns[i].name && col.order === b.columns[i].order
	)
}

/**
 * Compare two FK table constraints by structural equality.
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
const fkConstraintsEqual = (a, b) => {
	if (a.refTable !== b.refTable || a.refSchema !== b.refSchema) return false
	const colsMatch = (xs, ys) => xs.length === ys.length && xs.every((x, i) => x === ys[i])
	return (
		colsMatch(a.columns || [], b.columns || []) && colsMatch(a.refColumns || [], b.refColumns || [])
	)
}

/**
 * Diff two table entries from snapshots.
 * @param {Object} from - Old table snapshot
 * @param {Object} to - New table snapshot
 * @returns {{ addedColumns, droppedColumns, alteredColumns, addedIndexes, droppedIndexes, addedFKs, droppedFKs }}
 */
const diffTable = (from, to) => {
	const fromCols = new Map((from.columns || []).map((c) => [c.name, c]))
	const toCols = new Map((to.columns || []).map((c) => [c.name, c]))

	const addedColumns = [...toCols.values()].filter((c) => !fromCols.has(c.name))
	const droppedColumns = [...fromCols.values()].filter((c) => !toCols.has(c.name))
	const alteredColumns = [...toCols.values()]
		.filter((c) => fromCols.has(c.name))
		.map((c) => ({ column: c.name, changes: diffColumn(fromCols.get(c.name), c) }))
		.filter((c) => c.changes.length > 0)

	const fromIdxs = new Map((from.indexes || []).map((i) => [i.name, i]))
	const toIdxs = new Map((to.indexes || []).map((i) => [i.name, i]))

	const addedIndexes = [...toIdxs.values()].filter(
		(i) => !fromIdxs.has(i.name) || !indexesEqual(fromIdxs.get(i.name), i)
	)
	const droppedIndexes = [...fromIdxs.values()].filter(
		(i) => !toIdxs.has(i.name) || !indexesEqual(i, toIdxs.get(i.name))
	)

	const fromFKs = new Map(
		(from.tableConstraints || []).filter((c) => c.type === 'FOREIGN KEY').map((c) => [c.name, c])
	)
	const toFKs = new Map(
		(to.tableConstraints || []).filter((c) => c.type === 'FOREIGN KEY').map((c) => [c.name, c])
	)

	const addedFKs = [...toFKs.values()].filter(
		(fk) => !fromFKs.has(fk.name) || !fkConstraintsEqual(fromFKs.get(fk.name), fk)
	)
	const droppedFKs = [...fromFKs.values()].filter(
		(fk) => !toFKs.has(fk.name) || !fkConstraintsEqual(fk, toFKs.get(fk.name))
	)

	return {
		addedColumns,
		droppedColumns,
		alteredColumns,
		addedIndexes,
		droppedIndexes,
		addedFKs,
		droppedFKs
	}
}

/**
 * Diff two snapshots and return a change set.
 *
 * @param {Object} from - Source snapshot ({ version, tables: [] })
 * @param {Object} to - Target snapshot ({ version, tables: [] })
 * @returns {{
 *   fromVersion: number,
 *   toVersion: number,
 *   addedTables: Array,
 *   droppedTables: Array,
 *   alteredTables: Array<{ name, schema, addedColumns, droppedColumns, alteredColumns, addedIndexes, droppedIndexes, addedFKs, droppedFKs }>
 * }}
 */
export const diffSnapshots = (from, to) => {
	const fromTables = new Map((from.tables || []).map((t) => [t.name, t]))
	const toTables = new Map((to.tables || []).map((t) => [t.name, t]))

	const addedTables = [...toTables.values()].filter((t) => !fromTables.has(t.name))
	const droppedTables = [...fromTables.values()].filter((t) => !toTables.has(t.name))
	const alteredTables = [...toTables.values()]
		.filter((t) => fromTables.has(t.name))
		.map((t) => {
			const delta = diffTable(fromTables.get(t.name), t)
			const hasChanges = Object.values(delta).some((arr) => arr.length > 0)
			return hasChanges ? { name: t.name, schema: t.schema, ...delta } : null
		})
		.filter(Boolean)

	return {
		fromVersion: from.version,
		toVersion: to.version,
		addedTables,
		droppedTables,
		alteredTables
	}
}

/**
 * Returns true if the diff has no changes.
 * @param {Object} diff
 * @returns {boolean}
 */
export const isEmptyDiff = (diff) =>
	diff.addedTables.length === 0 &&
	diff.droppedTables.length === 0 &&
	diff.alteredTables.length === 0
