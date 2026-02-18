import { describe, it, expect, beforeEach } from 'vitest'
import {
	isInternal,
	isAnsiiSQL,
	isPostgres,
	isExtension,
	matchesKnownExtension,
	getCache,
	resetCache,
	internals,
	extensions
} from '../src/reference-classifier.js'

describe('reference-classifier', () => {
	beforeEach(() => {
		resetCache()
	})

	describe('getCache / resetCache', () => {
		it('returns empty cache after reset', () => {
			const cache = getCache()
			expect(cache.internal).toEqual([])
			expect(cache.extension).toEqual([])
		})

		it('cache accumulates classified entries', () => {
			isInternal('count')
			isInternal('now')
			const cache = getCache()
			expect(cache.internal).toContain('count')
			expect(cache.internal).toContain('now')
		})
	})

	describe('isAnsiiSQL()', () => {
		it('returns internal for known ANSI SQL names', () => {
			expect(isAnsiiSQL('count')).toBe('internal')
			expect(isAnsiiSQL('avg')).toBe('internal')
			expect(isAnsiiSQL('coalesce')).toBe('internal')
		})

		it('returns null for unknown names', () => {
			expect(isAnsiiSQL('my_func')).toBeNull()
		})
	})

	describe('isPostgres()', () => {
		it('returns internal for postgres entities', () => {
			expect(isPostgres('now')).toBe('internal')
			expect(isPostgres('unnest')).toBe('internal')
		})

		it('returns internal for postgres patterns', () => {
			expect(isPostgres('pg_catalog')).toBe('internal')
			expect(isPostgres('array_agg')).toBe('internal')
			expect(isPostgres('json_build_object')).toBe('internal')
			expect(isPostgres('to_char')).toBe('internal')
		})

		it('returns null for unknown names', () => {
			expect(isPostgres('my_func')).toBeNull()
		})
	})

	describe('isExtension()', () => {
		it('returns extension for installed extension entities', () => {
			expect(isExtension('create_hypertable', ['timescaledb'])).toBe('extension')
			expect(isExtension('gen_salt', ['pgcrypto'])).toBe('extension')
		})

		it('returns extension for installed extension patterns', () => {
			expect(isExtension('uuid_generate_v4', ['uuid-ossp'])).toBe('extension')
			expect(isExtension('st_distance', ['postgis'])).toBe('extension')
		})

		it('returns null when extension not installed', () => {
			expect(isExtension('uuid_generate_v4', [])).toBeNull()
			expect(isExtension('uuid_generate_v4')).toBeNull()
		})

		it('returns null for unknown extension', () => {
			expect(isExtension('uuid_generate_v4', ['nonexistent'])).toBeNull()
		})
	})

	describe('matchesKnownExtension()', () => {
		it('returns extension name for known entity', () => {
			expect(matchesKnownExtension('create_hypertable')).toBe('timescaledb')
			expect(matchesKnownExtension('gen_salt')).toBe('pgcrypto')
		})

		it('returns extension name for known pattern', () => {
			expect(matchesKnownExtension('uuid_generate_v4')).toBe('uuid-ossp')
			expect(matchesKnownExtension('st_distance')).toBe('postgis')
		})

		it('returns null for unknown names', () => {
			expect(matchesKnownExtension('my_custom_func')).toBeNull()
		})
	})

	describe('isInternal()', () => {
		it('returns internal for ANSI SQL builtins', () => {
			expect(isInternal('count')).toBe('internal')
		})

		it('returns internal for postgres builtins', () => {
			expect(isInternal('now')).toBe('internal')
			expect(isInternal('pg_class')).toBe('internal')
		})

		it('returns extension for installed extension functions', () => {
			expect(isInternal('uuid_generate_v4', ['uuid-ossp'])).toBe('extension')
		})

		it('returns null for unknown references', () => {
			expect(isInternal('my_custom_func')).toBeNull()
		})

		it('returns cached internal result on second call', () => {
			isInternal('count')
			const cache = getCache()
			expect(cache.internal).toContain('count')

			// Second call should hit cache
			const result = isInternal('count')
			expect(result).toBe('internal')
		})

		it('returns cached extension result on second call', () => {
			isInternal('uuid_generate_v4', ['uuid-ossp'])
			const cache = getCache()
			expect(cache.extension).toContain('uuid_generate_v4')

			// Second call hits cache even without installed list
			const result = isInternal('uuid_generate_v4')
			expect(result).toBe('extension')
		})

		it('is case-insensitive', () => {
			expect(isInternal('COUNT')).toBe('internal')
			expect(isInternal('Now')).toBe('internal')
		})
	})

	describe('data structures', () => {
		it('exports internals with ansii and postgres sections', () => {
			expect(internals.ansii.entities).toContain('count')
			expect(internals.postgres.entities).toContain('now')
			expect(internals.postgres.patterns.length).toBeGreaterThan(0)
		})

		it('exports extensions with known extension configs', () => {
			expect(extensions['uuid-ossp']).toBeDefined()
			expect(extensions['uuid-ossp'].patterns).toContain('^uuid_')
			expect(extensions.timescaledb.entities).toContain('create_hypertable')
		})
	})
})
