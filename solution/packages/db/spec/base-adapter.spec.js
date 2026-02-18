import { describe, it, expect, vi } from 'vitest'
import { BaseDatabaseAdapter } from '../src/base-adapter.js'

describe('BaseDatabaseAdapter', () => {
	describe('constructor', () => {
		it('stores connectionString and options', () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test', {
				verbose: true,
				dryRun: true
			})
			expect(adapter.connectionString).toBe('postgres://localhost/test')
			expect(adapter.options).toEqual({ verbose: true, dryRun: true })
			expect(adapter.verbose).toBe(true)
			expect(adapter.dryRun).toBe(true)
		})

		it('defaults verbose and dryRun to false', () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test')
			expect(adapter.verbose).toBe(false)
			expect(adapter.dryRun).toBe(false)
		})

		it('returns a copy of options (not the internal reference)', () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test', { verbose: true })
			const opts = adapter.options
			opts.verbose = false
			expect(adapter.verbose).toBe(true)
		})
	})

	describe('abstract methods throw "not implemented"', () => {
		const adapter = new BaseDatabaseAdapter('postgres://localhost/test')

		it('connect()', async () => {
			await expect(adapter.connect()).rejects.toThrow('not implemented')
		})

		it('disconnect()', async () => {
			await expect(adapter.disconnect()).rejects.toThrow('not implemented')
		})

		it('executeScript()', async () => {
			await expect(adapter.executeScript('SELECT 1')).rejects.toThrow('not implemented')
		})

		it('applyEntity()', async () => {
			await expect(adapter.applyEntity({})).rejects.toThrow('not implemented')
		})

		it('importData()', async () => {
			await expect(adapter.importData({})).rejects.toThrow('not implemented')
		})

		it('exportData()', async () => {
			await expect(adapter.exportData({})).rejects.toThrow('not implemented')
		})

		it('inspect()', async () => {
			await expect(adapter.inspect()).rejects.toThrow('not implemented')
		})

		it('parseScript()', () => {
			expect(() => adapter.parseScript('CREATE TABLE t (id int);')).toThrow('not implemented')
		})

		it('parseEntityScript()', () => {
			expect(() => adapter.parseEntityScript({ file: 'test.ddl' })).toThrow('not implemented')
		})
	})

	describe('testConnection()', () => {
		it('returns true when inspect() reports connected', async () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test')
			adapter.inspect = async () => ({ connected: true, version: '15.0' })
			expect(await adapter.testConnection()).toBe(true)
		})

		it('returns false when inspect() reports not connected', async () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test')
			adapter.inspect = async () => ({ connected: false })
			expect(await adapter.testConnection()).toBe(false)
		})

		it('returns false when inspect() throws', async () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test')
			adapter.inspect = async () => {
				throw new Error('connection refused')
			}
			expect(await adapter.testConnection()).toBe(false)
		})
	})

	describe('applyEntities()', () => {
		it('calls applyEntity for each entity in order', async () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test')
			const calls = []
			adapter.applyEntity = async (entity) => {
				calls.push(entity.name)
			}

			await adapter.applyEntities([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
			expect(calls).toEqual(['a', 'b', 'c'])
		})
	})

	describe('batchImport()', () => {
		it('calls importData for each entity in order', async () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test')
			const calls = []
			adapter.importData = async (entity) => {
				calls.push(entity.name)
			}

			await adapter.batchImport([{ name: 'x' }, { name: 'y' }])
			expect(calls).toEqual(['x', 'y'])
		})
	})

	describe('batchExport()', () => {
		it('calls exportData for each entity in order', async () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test')
			const calls = []
			adapter.exportData = async (entity) => {
				calls.push(entity.name)
			}

			await adapter.batchExport([{ name: 'p' }, { name: 'q' }])
			expect(calls).toEqual(['p', 'q'])
		})
	})

	describe('default implementations', () => {
		const adapter = new BaseDatabaseAdapter('postgres://localhost/test')

		it('resolveEntity() returns null', async () => {
			expect(await adapter.resolveEntity('public.users')).toBeNull()
		})

		it('initParser() resolves without error', async () => {
			await expect(adapter.initParser()).resolves.toBeUndefined()
		})

		it('classifyReference() returns null', () => {
			expect(adapter.classifyReference('count')).toBeNull()
			expect(adapter.classifyReference('my_func', ['uuid-ossp'])).toBeNull()
		})
	})

	describe('log()', () => {
		it('logs when verbose is true', () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test', { verbose: true })
			const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
			adapter.log('hello')
			expect(spy).toHaveBeenCalledWith('hello')
			spy.mockRestore()
		})

		it('does not log when verbose is false', () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test')
			const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
			adapter.log('hello')
			expect(spy).not.toHaveBeenCalled()
			spy.mockRestore()
		})

		it('uses console.error for error level', () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test', { verbose: true })
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
			adapter.log('fail', 'error')
			expect(spy).toHaveBeenCalledWith('fail')
			spy.mockRestore()
		})

		it('uses console.warn for warn level', () => {
			const adapter = new BaseDatabaseAdapter('postgres://localhost/test', { verbose: true })
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
			adapter.log('warning', 'warn')
			expect(spy).toHaveBeenCalledWith('warning')
			spy.mockRestore()
		})
	})
})
