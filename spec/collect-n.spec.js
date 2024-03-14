import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { MockConsole } from '@vanillaes/mock-console'
import { using } from '../src/collect.js'

describe('collect-invalid', async () => {
	let context = {}

	beforeAll(() => {
		context.logger = new MockConsole()
		context.databaseURL = 'postgresql://postgres:pg-test@localhost:5234/postgres'
		context.path = process.cwd()
	})

	beforeEach(() => {
		context.logger.capture()
		process.chdir('spec/fixtures/references')
	})

	afterEach(() => {
		process.chdir(context.path)
		context.logger.flush()
		context.logger.restore()
	})

	afterAll(() => {
		process.chdir(context.path)
	})

	it('should generate report for individual entity', () => {
		const issues = JSON.parse(readFileSync('issues.json'))
		const other = JSON.parse(readFileSync('references.json'))

		const dx = using('design.yaml', context.databaseURL).validate()

		let result = dx.report('staging.import_jsonb_to_table')
		expect(result).toEqual({ entity: issues[0], issues: [issues[0]] })
		result = dx.report('staging.import_lookups')
		expect(result).toEqual({ entity: other[0], issues: [] })
	})

	it('Should list issues in report', () => {
		const expected = JSON.parse(readFileSync('issues.json'))
		const result = using('design.yaml', context.databaseURL).validate().report()
		// writeFileSync('issues.json', JSON.stringify(result.issues, null, 2))
		expect(result.issues).toEqual(expected)
		expect(result.entity).toBeUndefined()
	})
})
