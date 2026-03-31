/**
 * Tests for Design.dbml() error paths.
 *
 * Uses vi.mock to intercept fs and @jerrythomas/dbd-dbml
 * since ESM module namespaces can't be spied on directly.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const exampleDir = join(__dirname, '..', 'example')

// Mock fs — wrap writeFileSync so we can control it per-test
const _writeFileSyncImpl = { fn: null }
vi.mock('fs', async () => {
	const actual = await vi.importActual('fs')
	return {
		...actual,
		default: {
			...actual,
			writeFileSync: (...args) => {
				if (_writeFileSyncImpl.fn) return _writeFileSyncImpl.fn(...args)
				return actual.writeFileSync(...args)
			}
		}
	}
})

// Mock generateDBML — wrap so we can control it per-test
const _generateDBMLImpl = { fn: null }
vi.mock('@jerrythomas/dbd-dbml', async () => {
	const actual = await vi.importActual('@jerrythomas/dbd-dbml')
	return {
		...actual,
		generateDBML: (...args) => {
			if (_generateDBMLImpl.fn) return _generateDBMLImpl.fn(...args)
			return actual.generateDBML(...args)
		}
	}
})

import { using } from '../src/design.js'

describe('Design.dbml() — error paths', () => {
	let originalPath

	beforeAll(() => {
		originalPath = process.cwd()
	})

	beforeEach(() => {
		process.chdir(exampleDir)
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'info').mockImplementation(() => {})
		vi.spyOn(console, 'warn').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		_writeFileSyncImpl.fn = null
		_generateDBMLImpl.fn = null
	})

	afterEach(() => {
		process.chdir(originalPath)
		vi.restoreAllMocks()
		_writeFileSyncImpl.fn = null
		_generateDBMLImpl.fn = null
	})

	it('dbml() catches writeFileSync errors and logs them', async () => {
		const dx = await using('design.yaml')

		_writeFileSyncImpl.fn = () => {
			throw new Error('disk full')
		}

		const result = dx.dbml()

		const errorCalls = console.error.mock.calls.map((c) => c[0])
		expect(errorCalls.some((e) => e instanceof Error && e.message === 'disk full')).toBe(true)
		expect(result).toBe(dx)
	})

	it('dbml() logs error when generateDBML returns error result', async () => {
		const dx = await using('design.yaml')
		const testError = new Error('conversion failed')

		_generateDBMLImpl.fn = () => [{ fileName: 'test.dbml', content: null, error: testError }]

		const result = dx.dbml()

		const errorCalls = console.error.mock.calls.map((c) => c[0])
		expect(errorCalls).toContainEqual(testError)
		expect(result).toBe(dx)
	})
})
