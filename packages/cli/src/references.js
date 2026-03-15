/**
 * Reference resolution — dialect-agnostic.
 *
 * Provides reference matching and warning resolution that work with any
 * database adapter. Postgres-specific code (parsing, regex extraction,
 * reference classification) now lives in @jerrythomas/dbd-postgres-adapter.
 */
import { pick } from 'ramda'
import { allowedTypes } from '@jerrythomas/dbd-db'

export function generateLookupTree(entities) {
	return entities.reduce(
		(cur, entity) => ({
			...cur,
			[entity.name]: pick(['name', 'schema', 'type'], entity)
		}),
		{}
	)
}

export function findEntityByName({ name, type }, searchPaths, lookup, classifier, installed = []) {
	let matched = null
	let internalType = classifier(name, installed)
	if (internalType) return { name, type: internalType }

	if (name.indexOf('.') > 0) {
		internalType = classifier(name.split('.').pop(), installed)
		if (internalType) return { name, type: internalType }

		matched = lookup[name]
		if (matched) return matched

		return { name, type, warning: `Reference ${name} not found` }
	}

	for (let i = 0; i < searchPaths.length && !matched; i++) {
		matched = lookup[searchPaths[i] + '.' + name]
	}
	if (matched) return matched

	return {
		name,
		type,
		warning: `Reference ${name} not found in [${searchPaths.join(', ')}]`
	}
}

export function matchReferences(entities, extensions = [], classifier) {
	const lookup = generateLookupTree(entities)

	return entities.map((entity) => {
		let references = entity.references.map((ref) =>
			findEntityByName(ref, entity.searchPaths, lookup, classifier, extensions)
		)
		const warnings = references.filter((r) => r.warning).map((r) => r.warning)
		return {
			...entity,
			references,
			warnings: [...(entity.warnings || []), ...warnings],
			refers: references
				.filter((r) => !r.error && !r.warning)
				.filter((r) => r.type !== 'extension')
				.filter((r) => allowedTypes.includes(r.type))
				.map((r) => r.name)
		}
	})
}

/**
 * Verify unresolved references against the database.
 * For each entity with warnings, queries the dbResolver to check if
 * the referenced entity actually exists in the database catalog.
 *
 * @param {Array} entities - Entities with resolved references (from matchReferences)
 * @param {Object} dbResolver - DbReferenceCache instance
 * @returns {Promise<Array>} Entities with warnings resolved where possible
 */
export async function resolveWarnings(entities, dbResolver) {
	if (!dbResolver) return entities

	const results = []
	for (const entity of entities) {
		if (!entity.warnings || entity.warnings.length === 0) {
			results.push(entity)
			continue
		}

		// Re-resolve references that had warnings
		const references = await Promise.all(
			entity.references.map(async (ref) => {
				if (!ref.warning) return ref
				const dbResult = await dbResolver.resolve(ref.name, entity.searchPaths)
				if (dbResult) {
					return { name: dbResult.name, schema: dbResult.schema, type: dbResult.type }
				}
				return ref
			})
		)

		const warnings = references.filter((r) => r.warning).map((r) => r.warning)
		results.push({
			...entity,
			references,
			warnings,
			refers: references
				.filter((r) => !r.error && !r.warning)
				.filter((r) => r.type !== 'extension')
				.filter((r) => allowedTypes.includes(r.type))
				.map((r) => r.name)
		})
	}

	return results
}
