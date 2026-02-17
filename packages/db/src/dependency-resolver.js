/**
 * Dependency resolution for entities.
 *
 * Pure functions extracted from src/metadata.js organize/regroup.
 * Handles topological sorting, cycle detection, and dependency grouping.
 */

/**
 * Build an adjacency-list dependency graph from entities.
 *
 * @param {Array} entities — each must have `name` and `refers` (array of names)
 * @returns {Map<string, Set<string>>} — map of entity name → set of dependency names
 */
export function buildDependencyGraph(entities) {
	const graph = new Map()
	for (const entity of entities) {
		graph.set(entity.name, new Set(entity.refers || []))
	}
	return graph
}

/**
 * Find cycles in a dependency graph using iterative grouping (same algorithm as src/metadata.js:regroup).
 *
 * @param {Map<string, Set<string>>} graph
 * @returns {string[][]} — array of cycle groups (each is an array of names involved in a cycle)
 */
export function findCycles(graph) {
	const lookup = {}
	for (const [name, deps] of graph) {
		lookup[name] = { name, refers: [...deps] }
	}

	const result = regroupLookup(lookup)
	if (result.errors.length === 0) return []
	return [result.errors]
}

/**
 * Validate that all dependencies can be resolved (no cycles, missing deps added).
 *
 * @param {Array} entities
 * @returns {{ isValid: boolean, cycles: string[][], warnings: string[] }}
 */
export function validateDependencies(entities) {
	const lookup = buildLookup(entities)
	const { missing } = addMissingDeps(entities, lookup)
	const fullLookup = { ...lookup, ...missing }
	const result = regroupLookup(fullLookup)

	return {
		isValid: result.errors.length === 0,
		cycles: result.errors.length > 0 ? [result.errors] : [],
		warnings: Object.keys(missing).map((name) => `Missing dependency: ${name}`)
	}
}

/**
 * Sort entities by dependencies (topological order).
 * Entities with cycles get an error marker. Missing dependencies are added as stubs.
 *
 * This replicates src/metadata.js:organize exactly.
 *
 * @param {Array} entities — each must have `name` and `refers`
 * @returns {Array} — sorted entities with `errors` array on cyclic ones
 */
export function sortByDependencies(entities) {
	const lookup = buildLookup(entities)
	const { missing } = addMissingDeps(entities, lookup)
	const fullLookup = { ...lookup, ...missing }

	const result = regroupLookup(fullLookup)
	return result.groups
		.flatMap((items) => items.map((name) => fullLookup[name]))
		.map((entity) => ({
			...entity,
			errors: result.errors.includes(entity.name) ? ['Cyclic dependency found'] : []
		}))
}

/**
 * Group entities by dependency level (layered groups).
 * Each layer depends only on entities in previous layers.
 *
 * @param {Array} entities
 * @returns {Array[]} — array of arrays, each layer is a group of entities
 */
export function groupByDependencyLevel(entities) {
	const lookup = buildLookup(entities)
	const { missing } = addMissingDeps(entities, lookup)
	const fullLookup = { ...lookup, ...missing }

	const result = regroupLookup(fullLookup)
	return result.groups.map((names) => names.map((name) => fullLookup[name]))
}

// --- Internal helpers ---

function buildLookup(entities) {
	return entities.reduce((obj, item) => ({ ...obj, [item.name]: item }), {})
}

function addMissingDeps(entities, lookup) {
	const missing = []
		.concat(...entities.map(({ refers }) => refers || []))
		.filter((entity) => !(entity in lookup))
		.reduce((obj, entity) => ({ ...obj, [entity]: { name: entity, refers: [] } }), {})

	return { missing }
}

/**
 * Core regrouping algorithm — same as src/metadata.js:regroup.
 * Iteratively separates entities that depend on others in the same group
 * until no more splits are possible. If a group can't be split further
 * but still has internal dependencies, those entities are cyclic.
 */
function regroupLookup(lookup) {
	let groups = [Object.keys(lookup)]
	let errors = []
	let length = groups.length

	do {
		length = groups.length
		let thisGroup = groups.pop()

		const nextGroup = thisGroup.filter((k) =>
			(lookup[k].refers || []).some((x) => thisGroup.includes(x))
		)
		thisGroup = thisGroup.filter((k) => !nextGroup.includes(k))

		if (thisGroup.length > 0) groups.push(thisGroup)
		if (nextGroup.length > 0) groups.push(nextGroup)
		if (groups.length === length) errors = [...nextGroup]
	} while (groups.length > length)

	return { groups: groups.map((items) => items.sort()), errors }
}
