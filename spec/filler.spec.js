import fs from 'fs'
import yaml from 'js-yaml'
import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import { fillMissingInfoForEntities } from '../src/filler.js'

const test = suite('Filler for missing information')

test('Should handle missing config attributes', () => {
	assert.equal(fillMissingInfoForEntities({}), {
		roles: [],
		tables: [],
		views: [],
		functions: [],
		procedures: []
	})
})

test('Should handle missing data types for different types', () => {
	const types = ['role', 'table', 'view', 'function', 'procedure']
	const base = types.reduce((obj, item) => ((obj[item + 's'] = []), obj), {})

	types.map((type) => {
		let input = {}
		let output = { ...base }
		const values = [
			{
				name: 'alpha'
			},
			{
				name: 'beta',
				refers: ['alpha'],
				type
			},
			{
				name: 'beta',
				refers: ['alpha'],
				type: 'invalid'
			}
		]
		input[type + 's'] = values
		output[type + 's'] = values.map((value) => ({ refers: [], ...value, type }))

		assert.equal(
			fillMissingInfoForEntities(input),
			output,
			`fill missing info for ${type}`
		)
		output[type + 's'].map((item, index) =>
			assert.equal(item.type, type, `type should be ${type} at ${index}`)
		)
	})
})

test.run()
