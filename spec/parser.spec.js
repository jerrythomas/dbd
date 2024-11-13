import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { chdir, cwd } from 'process'
import {
	extractWithAliases,
	extractReferences,
	extractSearchPaths,
	extractTableReferences,
	extractTriggerReferences,
	extractEntity,
	parseEntityScript,
	generateLookupTree,
	findEntityByName,
	matchReferences,
	removeIndexCreationStatements,
	normalizeComment
} from '../src/parser'
import { entityFromFile } from '../src/entity'
import { scan } from '../src/metadata'
import fs from 'fs'
import { extname, join } from 'path'
import { resetCache } from '../src/exclusions'
import references from './fixtures/references/references.json'
import exclusions from './fixtures/references/exclusions.json'

describe('parser', () => {
	const originalPath = cwd()
	const expectedPath = join(originalPath, 'spec/fixtures/references')
	beforeAll(() => {
		resetCache()
		chdir('spec/fixtures/references')
	})

	describe('extractWithAliases', () => {
		it('should identify aliases', () => {
			const script = 'with recursive cte as (select * from table1) select * from cte;'
			const aliases = extractWithAliases(script)
			expect(aliases).toEqual(['cte'])
		})
	})

	describe('extractFunctionCalls', () => {
		it('should extract all references without schema names', () => {
			const content = `SELECT uuid_generate_v4(), count(*) FROM users
		  JOIN orders ON users.id = orders.user_id
		  WHERE now() > orders.created_at
		  UPDATE lookup_values SET value = 'example' WHERE id = uuid_generate_v4();
		  INSERT INTO log_entries (id, message) VALUES (uuid_generate_v4(), 'Insert completed');
		  CREATE INDEX idx_user_id ON users (user_id);`
			const references = extractReferences(content)
			expect(references).toEqual([
				{ name: 'uuid_generate_v4', type: null },
				{ name: 'log_entries', type: 'table/view' },
				{ name: 'users', type: 'table/view' }
			])
		})

		it('should extract all references with schema names', () => {
			const content = `SELECT extensions.uuid_generate_v4(), count(*) FROM users
		  JOIN core.orders ON users.id = orders.user_id
		  WHERE now() > orders.created_at
		  UPDATE config.lookup_values SET value = 'example' WHERE id = extensions.uuid_generate_v4();
		  INSERT INTO logging.log_entries (id, message) VALUES (extensions.uuid_generate_v4(), 'Insert completed');
		  CREATE INDEX idx_user_id ON core.users (user_id);`
			const references = extractReferences(content)
			expect(references).toEqual([
				{ name: 'extensions.uuid_generate_v4', type: null },
				{ name: 'logging.log_entries', type: 'table/view' },
				{ name: 'core.users', type: 'table/view' }
			])
		})

		it('should extract references from create table', () => {
			const content = fs.readFileSync('ddl/table/config/lookup_values.ddl', 'utf8')
			const references = extractReferences(content)
			expect(references).toEqual([
				{ name: 'lookup_values', type: 'table/view' },
				{ name: 'uuid_generate_v4', type: null },
				{ name: 'lookups', type: 'table/view' }
			])
		})

		it('should exclude built in functions', () => {
			const content = fs.readFileSync('ddl/procedure/staging/import_json_to_table.ddl', 'utf8')
			const references = extractReferences(content)
			expect(references).toEqual([
				{ name: 'import_jsonb_to_table', type: 'procedure' },
				{ name: 'rec', type: 'alias' }
			])
		})

		it('should exclude indexes', () => {
			const content = `
        , PRIMARY KEY (id)
        , UNIQUE INDEX xyz_ukey (name ASC) VISIBLE
        , INDEX fk_reason_type_id (reason_type_id ASC) VISIBLE
        , CONSTRAINT fk_reason_type_id FOREIGN KEY (reason_type_id) REFERENCES dayamed.reason_type (id)`
			const references = extractReferences(content)
			expect(references).toEqual([
				{
					name: 'dayamed.reason_type',
					type: 'table/view'
				}
			])
		})
	})

	describe('extractSearchPaths', () => {
		let samples = [
			{ input: '', expected: ['public'] },
			{
				input: 'set search_path to history, extensions;',
				expected: ['history', 'extensions']
			},
			{ input: 'set search_path to staging;', expected: ['staging'] },
			{
				input: `set search_path to staging;
		 set search_path to config, extensions;`,
				expected: ['config', 'extensions']
			}
		]
		it.each(samples)('should extract search paths', ({ input, expected }) => {
			expect(extractSearchPaths(input)).toEqual(expected)
		})
	})

	describe('extractTableReferences', () => {
		it('should extract table references from view', () => {
			const content = fs.readFileSync('ddl/view/config/genders.ddl', 'utf8')
			const references = extractTableReferences(content)
			expect(references).toEqual([
				{ name: 'lookups', type: 'table/view' },
				{ name: 'lookup_values', type: 'table/view' }
			])
		})

		it('should extract table references from procedure', () => {
			const content = fs.readFileSync('ddl/procedure/staging/import_lookups.ddl', 'utf8')
			const references = extractTableReferences(content)
			expect(references).toEqual([
				{ name: 'staging.lookup_values', type: 'table/view' },
				{ name: 'config.lookups', type: 'table/view' },
				{ name: 'config.lookup_values', type: 'table/view' }
			])
		})

		it('should exclude built in tables', () => {
			const content = fs.readFileSync('ddl/procedure/staging/import_json_to_table.ddl', 'utf8')
			const references = extractTableReferences(content)
			expect(references).toEqual([])
		})
	})

	describe('extractTriggerReferences', () => {
		it('should extract trigger references', () => {
			const content = `
        create trigger add_tenant_partitions_trigger
         after insert on core.tenants
           for each row execute function add_tenant_partitions();`
			const references = extractTriggerReferences(content)
			expect(references).toEqual([{ name: 'core.tenants', type: 'table' }])
		})
		it('should extract trigger references', () => {
			const content = `drop trigger if exists add_tenant_partitions_trigger on core.tenants;
        create trigger add_tenant_partitions_trigger
         after insert on core.tenants
           for each row execute function add_tenant_partitions();`
			const references = extractTriggerReferences(content)
			expect(references).toEqual([{ name: 'core.tenants', type: 'table' }])
		})
	})

	describe('extractEntity', () => {
		it('should extract entity info from script', () => {
			const content = fs.readFileSync('ddl/procedure/staging/import_json_to_table.ddl', 'utf8')
			const result = extractEntity(content)
			expect(result).toEqual({
				name: 'import_jsonb_to_table',
				schema: undefined,
				type: 'procedure'
			})
		})

		it('should extract entity info from script with schema', () => {
			const content =
				'CREATE TABLE IF NOT EXISTS config.lookup_values \n(id uuid PRIMARY KEY\n, value text);'
			const result = extractEntity(content)
			expect(result).toEqual({
				name: 'lookup_values',
				schema: 'config',
				type: 'table'
			})
		})
	})

	describe('parseEntityScript', () => {
		it('should parse procedure script and list name mismatch', () => {
			const entity = {
				name: 'staging.import_json_to_table',
				type: 'procedure',
				schema: 'staging',
				file: 'ddl/procedure/staging/import_json_to_table.ddl'
			}
			const result = parseEntityScript(entity)

			expect(result).toEqual({
				name: 'staging.import_jsonb_to_table',
				type: 'procedure',
				schema: 'staging',
				file: 'ddl/procedure/staging/import_json_to_table.ddl',
				searchPaths: ['staging'],
				references: [],
				errors: ['Entity name in script does not match file name']
			})
		})

		it('should parse procedure script and list references', () => {
			const entity = {
				name: 'staging.import_lookups',
				type: 'procedure',
				schema: 'staging',
				file: 'ddl/procedure/staging/import_lookups.ddl'
			}
			const result = parseEntityScript(entity)

			expect(result).toEqual({
				name: 'staging.import_lookups',
				type: 'procedure',
				schema: 'staging',
				file: 'ddl/procedure/staging/import_lookups.ddl',
				searchPaths: ['staging'],
				references: [
					{ name: 'config.lookups', type: 'table/view' },
					{ name: 'config.lookup_values', type: 'table/view' },
					{ name: 'staging.lookup_values', type: 'table/view' }
				],
				errors: []
			})
		})

		it('should parse table script and list references', () => {
			const entity = {
				name: 'config.lookup_values',
				type: 'table',
				schema: 'config',
				file: 'ddl/table/config/lookup_values.ddl'
			}
			const result = parseEntityScript(entity)

			expect(result).toEqual({
				...entity,
				searchPaths: ['config', 'extensions'],
				references: [
					{ name: 'uuid_generate_v4', type: null },
					{ name: 'lookups', type: 'table/view' }
				],
				errors: []
			})
		})

		it('should parse view script and list references', () => {
			const entity = {
				name: 'config.genders',
				type: 'view',
				schema: 'config',
				file: 'ddl/view/config/genders.ddl'
			}
			const result = parseEntityScript(entity)

			expect(result).toEqual({
				...entity,
				searchPaths: ['config'],
				references: [
					{ name: 'lookups', type: 'table/view' },
					{ name: 'lookup_values', type: 'table/view' }
				],
				errors: []
			})
		})
	})

	describe('generateLookupTree', () => {
		it('should generate a lookup tree', () => {
			const entities = scan('ddl')
				.filter((file) => ['.ddl', '.sql'].includes(extname(file)))
				.map((file) => entityFromFile(file))

			const tree = generateLookupTree(entities)
			expect(tree).toEqual({
				'config.genders': {
					name: 'config.genders',
					schema: 'config',
					type: 'view'
				},
				'config.lookup_values': {
					name: 'config.lookup_values',
					schema: 'config',
					type: 'table'
				},
				'config.lookups': {
					name: 'config.lookups',
					schema: 'config',
					type: 'table'
				},
				'core.users': {
					name: 'core.users',
					schema: 'core',
					type: 'table'
				},
				'migrate.lookup_values': {
					name: 'migrate.lookup_values',
					schema: 'migrate',
					type: 'view'
				},
				'staging.import_json_to_table': {
					name: 'staging.import_json_to_table',
					schema: 'staging',
					type: 'procedure'
				},
				'staging.import_lookups': {
					name: 'staging.import_lookups',
					schema: 'staging',
					type: 'procedure'
				},
				'staging.lookup_values': {
					name: 'staging.lookup_values',
					schema: 'staging',
					type: 'table'
				}
			})
		})
	})

	describe('findEntityByName', () => {
		let entities = []
		let lookupTree = null
		beforeAll(() => {
			if (cwd() !== expectedPath) chdir('spec/fixtures/references')
			entities = scan('ddl')
				.filter((file) => ['.ddl', '.sql'].includes(extname(file)))
				.map((file) => entityFromFile(file))
			lookupTree = generateLookupTree(entities)
		})
		afterAll(() => {
			chdir(originalPath)
		})
		it('should find procedure by name', () => {
			let entity = findEntityByName(
				{ name: 'staging.import_json_to_table', type: null },
				['staging'],
				lookupTree
			)
			expect(entity).toEqual({
				name: 'staging.import_json_to_table',
				schema: 'staging',
				type: 'procedure'
			})
			entity = findEntityByName(
				{ name: 'import_lookups', type: 'table' },
				['core', 'config', 'staging'],
				lookupTree
			)
			expect(entity).toEqual({
				name: 'staging.import_lookups',
				schema: 'staging',
				type: 'procedure'
			})
			entity = findEntityByName({ name: 'unknown' }, ['core', 'config', 'staging'], lookupTree)
			expect(entity).toEqual({
				name: 'unknown',
				type: undefined,
				error: 'Reference unknown not found in [core, config, staging]'
			})
		})

		it('should find table by name', () => {
			let entity = findEntityByName(
				{ name: 'config.lookups', type: 'table' },
				['staging', 'config'],
				lookupTree
			)
			expect(entity).toEqual({
				name: 'config.lookups',
				schema: 'config',
				type: 'table'
			})

			entity = findEntityByName({ name: 'lookup_values' }, ['config', 'staging'], lookupTree)
			expect(entity).toEqual({
				name: 'config.lookup_values',
				schema: 'config',
				type: 'table'
			})

			entity = findEntityByName({ name: 'unknown' }, ['core', 'config', 'staging'], lookupTree)
			expect(entity).toEqual({
				name: 'unknown',
				type: undefined,
				error: 'Reference unknown not found in [core, config, staging]'
			})
		})
	})

	describe('matchReferences', () => {
		let entities = null

		beforeAll(() => {
			if (cwd() !== expectedPath) chdir('spec/fixtures/references')
			entities = scan('ddl')
				.filter((file) => ['.ddl', '.sql'].includes(extname(file)))
				.map((file) => entityFromFile(file))
				.map((entity) => parseEntityScript(entity))
		})
		beforeEach(() => resetCache())

		it('should match all references', () => {
			let result = matchReferences(entities).sort((a, b) => a.name.localeCompare(b.name))
			let expected = references.sort((a, b) => a.name.localeCompare(b.name))

			for (let i = 0; i < result.length; i++) expect(result[i]).toEqual(expected[i])
		})

		it('should identify installed extension entities', () => {
			const result = matchReferences(entities, ['uuid-ossp']).sort((a, b) =>
				a.name.localeCompare(b.name)
			)
			let expected = exclusions.sort((a, b) => a.name.localeCompare(b.name))
			for (let i = 0; i < result.length; i++) expect(result[i]).toEqual(expected[i])
		})
	})

	describe('removeIndexCreationStatements', () => {
		it('should remove index creation statements', () => {
			const ddl = [
				`create table a( id serial);`,
				`create unique index if not exists a_ukey`,
				`on a (id );`,
				'',
				`comment on table a is 'a table';`
			]
			const expected = [ddl[0], ddl[3], ddl[4]]
			expect(removeIndexCreationStatements(ddl.join('\n'))).toEqual(expected.join('\n'))
		})

		it('should remove index creation statements with schema', () => {
			const ddl = [
				'create unique index if not exists subscriptions_ukey ',
				'   on subscriptions(tenant_id, subscriber_id, region_id, subscribed_on , expires_on)  ;',
				''
			]
			expect(removeIndexCreationStatements(ddl.join('\n'))).toEqual('')
		})

		it('should remove function based indexes', () => {
			const ddl = [
				'some statments before index',
				'create unique index if not exists organizations_ukey',
				'on organizations (lower(name));',
				'some statments after index'
			]
			const expected = [ddl[0], ddl[3]]
			expect(removeIndexCreationStatements(ddl.join('\n'))).toEqual(expected.join('\n'))
		})
	})

	describe('normalizeComments', () => {
		it('should normalize a multi line comment', () => {
			const inputArray = [
				'Some initial text that should remain intact.',
				'',
				'comment on table xyz IS',
				"'User roles for application access.\n",
				'- Each role has a name and description.',
				'- Roles are associated with privileges and users.',
				'- Users can have multiple roles.',
				'- Roles can have multiple privileges.',
				"- Roles are not tenant specific.';",
				'',
				'Some additional text that should remain intact.'
			]

			const inputString = inputArray.join('\n')
			const expectedOutput = [
				'Some initial text that should remain intact.\n',
				"comment on table xyz IS 'User roles for application access.\\n\\n- Each role has a name and description.\\n- Roles are associated with privileges and users.\\n- Users can have multiple roles.\\n- Roles can have multiple privileges.\\n- Roles are not tenant specific.';",
				'\nSome additional text that should remain intact.'
			].join('\n')
			const outputString = normalizeComment(inputString)
			expect(outputString).toEqual(expectedOutput)
		})
	})
})
