import { describe, expect, it, beforeAll } from 'bun:test'
import {
	isAnsiiSQL,
	isPostgres,
	isExtension,
	isInternal,
	getCache,
	resetCache
} from '../src/exclusions'

describe('extensions', () => {
	describe('isAnsii', () => {
		it('should return true for known ansii functions', () => {
			expect(isAnsiiSQL('partition')).toBe(true)
			expect(isAnsiiSQL('over')).toBe(true)
			expect(isAnsiiSQL('count')).toBe(true)
			expect(isAnsiiSQL('rank')).toBe(true)
		})
		it('should return false for ', () => {
			expect(isAnsiiSQL('now')).toBeFalsy()
			expect(isAnsiiSQL('current_date')).toBeFalsy()
		})
	})
	describe('isPostgres', () => {
		it('should return true for known postgres functions', () => {
			expect(isPostgres('string_agg')).toBe(true)
			expect(isPostgres('jsonb_build_object')).toBe(true)
			expect(isPostgres('jsonb_to_record')).toBe(true)
		})
		it('should return false for unknown postgres functions', () => {
			expect(isPostgres('md5')).toBeFalsy()
			expect(isPostgres('gen_salt')).toBeFalsy()
			expect(isPostgres('crypt')).toBeFalsy()
		})
	})
	describe('isExtension', () => {
		beforeAll(() => resetCache())
		it('should return true for installed extension functions', () => {
			expect(isExtension('md5', ['pgcrypto'])).toBe(true)
			expect(isExtension('gen_salt', ['pgcrypto'])).toBe(true)
			expect(isExtension('uuid_generate_v4', ['uuid-ossp'])).toBe(true)
		})
		it('should return false for extensions not installed', () => {
			expect(isExtension('md5', [])).toBeFalsy()
			expect(isExtension('gen_salt', [])).toBeFalsy()
			expect(isExtension('crypt', [])).toBeFalsy()
		})
	})
	describe('isInternal', () => {
		it('should return true for known internal functions', () => {
			expect(isInternal('now')).toBe(true)
			expect(isInternal('coalesce')).toBe(true)
			expect(isInternal('crypt', ['pgcrypto'])).toBe(true)
			expect(getCache()).toEqual({
				internal: ['now', 'coalesce', 'crypt'],
				ignore: []
			})
		})
		it('should return false for unknown internal functions', () => {
			expect(isInternal('crypt', ['uuid-ossp'])).toBeTruthy()
			expect(isInternal('md5', ['uuid-ossp'])).toBeFalsy()
			expect(isInternal('gen_salt', ['uuid-ossp'])).toBeFalsy()
			expect(getCache()).toEqual({
				internal: ['now', 'coalesce', 'crypt'],
				ignore: ['md5', 'gen_salt']
			})
		})
	})
})
