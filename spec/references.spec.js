import { describe, expect, it, beforeAll } from 'bun:test'
import { chdir, cwd } from 'process'
import {
	cleanDDLEntities,
	getSearchPaths,
	getLookupTree,
	getTableReferences
} from '../src/references'

describe('references', () => {
	beforeAll(() => {
		chdir('spec/fixtures/references')
	})

	it('should identify search paths', () => {
		let paths = getSearchPaths('set search_path to config, extensions;')
		expect(paths).toEqual(['config', 'extensions'])
		paths = getSearchPaths('set search_path to staging;')
		expect(paths).toEqual(['staging'])
		paths = getSearchPaths(
			[
				'',
				'set search_path to staging;',
				'',
				'set search_path to config, extensions;'
			].join('\n')
		)
		expect(paths).toEqual(['config', 'extensions'])
	})

	it('should generate a lookup tree', () => {
		const entities = cleanDDLEntities()
		const tree = getLookupTree(entities)
		expect(tree).toEqual({
			table: {
				config: {
					lookup_values: 'config.lookup_values',
					lookups: 'config.lookups'
				},
				core: {
					users: 'core.users'
				},
				staging: {
					lookup_values: 'staging.lookup_values'
				}
			},
			view: {
				config: {
					genders: 'config.genders'
				},
				migrate: {
					lookup_values: 'migrate.lookup_values'
				}
			},
			procedure: {
				staging: {
					import_json_to_table: 'staging.import_json_to_table',
					import_lookups: 'staging.import_lookups'
				}
			}
		})
	})

	it('should identify table references', () => {
		let result = getTableReferences(
			', role_id int references lookup_values(id)'
		)
		expect(result).toEqual(['lookup_values'])
		result = getTableReferences(
			[
				', role_id int references lookup_values(id)',
				', gender_id int references lookup_values(id)',
				', other_id int references other(id)'
			].join('\n')
		)
		expect(result).toEqual(['lookup_values', 'other'])

		result = getTableReferences(
			[
				', alpha_id int references alpha(id)',
				', beta_id int references xyz.beta(id)',
				', gamma_id int references gamma(id)'
			].join('\n')
		)
		expect(result).toEqual(['alpha', 'xyz.beta', 'gamma'])
	})
})
