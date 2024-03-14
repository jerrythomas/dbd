import { describe, expect, it } from 'vitest'
import { fillMissingInfoForEntities } from '../src/filler.js'

describe('filler', () => {
	it('Should handle missing config attributes', () => {
		expect(fillMissingInfoForEntities({})).toEqual({
			roles: [],
			tables: [],
			views: [],
			functions: [],
			procedures: []
		})
	})

	it('Should handle missing data types for different types', () => {
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
			output[type + 's'] = values.map((value) => ({
				refers: [],
				...value,
				type
			}))

			expect(fillMissingInfoForEntities(input)).toEqual(output, `fill missing info for ${type}`)
			output[type + 's'].map((item, index) =>
				expect(item.type).toEqual(type, `type should be ${type} at ${index}`)
			)
		})
	})
})
