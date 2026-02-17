import { describe, it, expect } from 'vitest'
import { createAdapter, getAdapterInfo, SUPPORTED_DATABASES } from '../src/factory.js'

describe('factory', () => {
	describe('SUPPORTED_DATABASES', () => {
		it('includes postgres and postgresql', () => {
			expect(SUPPORTED_DATABASES).toContain('postgres')
			expect(SUPPORTED_DATABASES).toContain('postgresql')
		})
	})

	describe('getAdapterInfo()', () => {
		it('returns supported for postgres', () => {
			expect(getAdapterInfo('postgres')).toEqual({ type: 'postgres', supported: true })
		})

		it('returns supported for postgresql (alias)', () => {
			expect(getAdapterInfo('postgresql')).toEqual({ type: 'postgresql', supported: true })
		})

		it('is case-insensitive', () => {
			expect(getAdapterInfo('POSTGRES')).toEqual({ type: 'postgres', supported: true })
		})

		it('returns unsupported for unknown type', () => {
			expect(getAdapterInfo('mysql')).toEqual({ type: 'mysql', supported: false })
		})
	})

	describe('createAdapter()', () => {
		it('throws for unsupported database type', async () => {
			await expect(createAdapter('mysql', 'mysql://localhost')).rejects.toThrow(
				'Unsupported database: mysql'
			)
		})

		it('throws with helpful message listing supported databases', async () => {
			await expect(createAdapter('sqlite', 'sqlite://test.db')).rejects.toThrow(
				'Supported: postgres, postgresql'
			)
		})
	})
})
