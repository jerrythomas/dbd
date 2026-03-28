import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildImportArgs, convexImportCommand } from '../src/data-seeder.js'

describe('buildImportArgs', () => {
	it('returns arg array for csv in dev', () => {
		expect(buildImportArgs('users', 'data.csv', 'csv', false)).toEqual([
			'convex',
			'import',
			'--table',
			'users',
			'--format',
			'csv',
			'data.csv'
		])
	})

	it('returns arg array with --prod flag', () => {
		expect(buildImportArgs('users', 'data.csv', 'csv', true)).toEqual([
			'convex',
			'import',
			'--table',
			'users',
			'--format',
			'csv',
			'--prod',
			'data.csv'
		])
	})

	it('maps json format to jsonl', () => {
		expect(buildImportArgs('users', 'data.json', 'json', false)).toEqual([
			'convex',
			'import',
			'--table',
			'users',
			'--format',
			'jsonl',
			'data.json'
		])
	})

	it('defaults unknown format to jsonl', () => {
		expect(buildImportArgs('users', 'data.tsv', 'tsv', false)).toEqual([
			'convex',
			'import',
			'--table',
			'users',
			'--format',
			'jsonl',
			'data.tsv'
		])
	})
})

describe('convexImportCommand', () => {
	it('returns a human-readable command string for dry-run display', () => {
		expect(convexImportCommand('users', 'data.csv', 'csv', false)).toBe(
			'npx convex import --table users --format csv data.csv'
		)
	})

	it('includes --prod in command string', () => {
		expect(convexImportCommand('users', 'data.csv', 'csv', true)).toBe(
			'npx convex import --table users --format csv --prod data.csv'
		)
	})
})
