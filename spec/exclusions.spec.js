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
			expect(isAnsiiSQL('partition')).toEqual('internal')
			expect(isAnsiiSQL('over')).toEqual('internal')
			expect(isAnsiiSQL('count')).toEqual('internal')
			expect(isAnsiiSQL('rank')).toEqual('internal')
		})
		it('should return false for ', () => {
			expect(isAnsiiSQL('now')).toBeFalsy()
			expect(isAnsiiSQL('current_date')).toBeFalsy()
		})
	})
	describe('isPostgres', () => {
		it('should return true for known postgres functions', () => {
			expect(isPostgres('string_agg')).toEqual('internal')
			expect(isPostgres('jsonb_build_object')).toEqual('internal')
			expect(isPostgres('jsonb_to_record')).toEqual('internal')
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
			expect(isExtension('md5', ['pgcrypto'])).toEqual('extension')
			expect(isExtension('gen_salt', ['pgcrypto'])).toEqual('extension')
			expect(isExtension('uuid_generate_v4', ['uuid-ossp'])).toEqual('extension')
		})
		it('should return false for extensions not installed', () => {
			expect(isExtension('md5', [])).toBeFalsy()
			expect(isExtension('gen_salt', [])).toBeFalsy()
			expect(isExtension('crypt', [])).toBeFalsy()
		})
	})
	describe('isInternal', () => {
		it('should return true for known internal functions', () => {
			expect(isInternal('now')).toEqual('internal')
			expect(isInternal('coalesce')).toEqual('internal')
			expect(isInternal('crypt', ['pgcrypto'])).toEqual('extension')
			expect(getCache()).toEqual({
				internal: ['now', 'coalesce'],
				extension: ['crypt']
			})
		})
		it('should return false for unknown internal functions', () => {
			expect(isInternal('crypt', ['uuid-ossp'])).toEqual('extension')
			expect(isInternal('md5', ['uuid-ossp'])).toBeFalsy()
			expect(isInternal('gen_salt', ['uuid-ossp'])).toBeFalsy()
			expect(getCache()).toEqual({
				internal: ['now', 'coalesce'],
				extension: ['crypt']
			})
		})
	})
})
