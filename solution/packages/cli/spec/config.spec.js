/**
 * Tests for packages/cli/src/config.js
 *
 * Mirrors spec/compat/config.spec.js but imports from the new package.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { scan, read, fillMissingInfoForEntities, merge } from '../src/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..')
const exampleDir = join(repoRoot, 'example')

describe('config', () => {
	let originalPath

	beforeAll(() => {
		originalPath = process.cwd()
	})

	afterEach(() => {
		process.chdir(originalPath)
	})

	describe('scan()', () => {
		it('discovers DDL and import files', () => {
			process.chdir(exampleDir)
			const files = scan('ddl')
			expect(files.length).toBeGreaterThan(0)
			expect(files.every((f) => f.startsWith('ddl/'))).toBe(true)
		})
	})

	describe('read()', () => {
		it('parses design.yaml with project info', () => {
			process.chdir(exampleDir)
			const data = read('design.yaml')
			expect(data.project.name).toBe('Example')
			expect(data.project.database).toBe('PostgreSQL')
		})

		it('fills missing entity types with empty arrays', () => {
			process.chdir(exampleDir)
			const data = read('design.yaml')
			expect(Array.isArray(data.tables)).toBe(true)
			expect(Array.isArray(data.views)).toBe(true)
			expect(Array.isArray(data.functions)).toBe(true)
			expect(Array.isArray(data.procedures)).toBe(true)
			expect(Array.isArray(data.roles)).toBe(true)
		})

		it('entities array is union of tables+views+functions+procedures', () => {
			process.chdir(exampleDir)
			const data = read('design.yaml')
			expect(data.entities.length).toBe(
				data.tables.length + data.views.length + data.functions.length + data.procedures.length
			)
		})
	})

	describe('fillMissingInfoForEntities()', () => {
		it('fills empty data with default arrays', () => {
			const data = fillMissingInfoForEntities({})
			expect(data.tables).toEqual([])
			expect(data.views).toEqual([])
			expect(data.functions).toEqual([])
			expect(data.procedures).toEqual([])
			expect(data.roles).toEqual([])
		})

		it('adds type and refers to existing entries', () => {
			const data = fillMissingInfoForEntities({
				tables: [{ name: 'a' }],
				views: [{ name: 'b' }]
			})
			expect(data.tables[0]).toEqual({ name: 'a', refers: [], type: 'table' })
			expect(data.views[0]).toEqual({ name: 'b', refers: [], type: 'view' })
		})
	})

	describe('merge()', () => {
		it('y overrides x for matching names', () => {
			const x = [{ name: 'a', value: 1 }]
			const y = [{ name: 'a', value: 2 }]
			const result = merge(x, y)
			expect(result).toEqual([{ name: 'a', value: 2 }])
		})

		it('preserves items only in x', () => {
			const x = [{ name: 'a', value: 1 }]
			const y = [{ name: 'b', value: 2 }]
			const result = merge(x, y)
			expect(result.length).toBe(2)
			expect(result.find((r) => r.name === 'a').value).toBe(1)
			expect(result.find((r) => r.name === 'b').value).toBe(2)
		})
	})
})
