// Define variables for elements that are used more than once
const competencyViewsRefers = ['public.lookups', 'public.lookup_values']

// Define dependencies
export const dependencies = [
	{
		type: 'role',
		name: 'role_b',
		refers: ['role_a']
	},
	{
		type: 'table',
		name: 'public.table_b',
		refers: ['public.table_a']
	},
	{
		type: 'table',
		name: 'public.competencies',
		refers: ['public.lookup_values']
	},
	{
		type: 'table',
		name: 'public.skills',
		refers: ['public.competencies']
	},
	{
		type: 'table',
		name: 'public.teams',
		refers: ['public.clients']
	},
	{
		type: 'table',
		name: 'public.associates',
		refers: ['public.lookup_values']
	},
	{
		type: 'table',
		name: 'public.allocations',
		refers: ['public.teams', 'public.associates']
	},
	{
		type: 'view',
		name: 'public.competency_categories',
		refers: competencyViewsRefers
	},
	{
		type: 'view',
		name: 'public.blood_groups',
		refers: competencyViewsRefers
	},
	{
		type: 'view',
		name: 'public.genders',
		refers: competencyViewsRefers
	},
	{
		type: 'view',
		name: 'public.search_types',
		refers: ['public.lookup_values', 'public.lookups']
	},
	{
		type: 'view',
		name: 'public.app_configuration',
		refers: ['public.properties']
	},
	{
		type: 'view',
		name: 'public.all_skills',
		refers: ['public.competencies', 'public.skills']
	},
	{
		type: 'view',
		name: 'public.all_competencies',
		refers: ['public.competencies', 'public.competency_categories']
	},
	{
		type: 'view',
		name: 'public.identity_card',
		refers: ['public.associates', 'public.blood_groups']
	},
	{
		type: 'view',
		name: 'public.skill_search_results',
		refers: ['public.skill_search_options']
	},
	{
		type: 'view',
		name: 'public.skill_search_options',
		refers: ['public.all_competencies']
	}
]

// Define ddlScripts
export const ddlScripts = [
	{
		input: {
			type: 'schema',
			name: 'private'
		},
		output: 'create schema if not exists private;',
		message: 'Should create private schema'
	},
	{
		input: {
			type: 'extension',
			name: 'uuid-ossp'
		},
		output: 'create extension if not exists "uuid-ossp" with schema public;',
		message: 'Should create extension "uuid-ossp"'
	},
	{
		input: {
			type: 'extension',
			name: 'uuid-ossp',
			schema: 'extensions'
		},
		output: 'create extension if not exists "uuid-ossp" with schema extensions;',
		message: 'Should create extension "uuid-ossp" with extension schema'
	},
	{
		input: {
			type: 'role',
			name: 'basic',
			refers: []
		},
		output: [
			'DO',
			'$do$',
			'BEGIN',
			'   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles',
			"                   WHERE rolname = 'basic') THEN",
			'      CREATE ROLE basic;',
			'   END IF;',
			'END',
			'$do$;\n'
		].join('\n'),
		message: 'Should create basic role'
	},
	{
		input: {
			type: 'role',
			name: 'advanced',
			refers: ['basic']
		},
		output: [
			'DO',
			'$do$',
			'BEGIN',
			'   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles',
			"                   WHERE rolname = 'advanced') THEN",
			'      CREATE ROLE advanced;',
			'   END IF;',
			'END',
			'$do$;',
			'grant basic to advanced;'
		].join('\n'),
		message: 'Should create role with grants'
	},
	{
		input: {
			type: 'table',
			name: 'test',
			file: 'ddl/test/test.ddl'
		},
		output: 'create table test (id int);',
		message: 'Should create table "test" from file'
	}
]

// Define dataFiles
export const dataFiles = {
	json: {
		input: { file: 'import/staging/test.json' },
		output: [{ name: 'genders' }],
		message: 'Should read data from json'
	},
	csv: {
		input: { file: 'import/staging/lookup.csv' },
		output: [{ name: 'genders' }, { name: 'roles' }],
		message: 'Should read data from csv'
	}
}

// Define validations
export const validations = [
	{
		input: { entity: { type: 'schema', name: 'test' }, ddl: true },
		output: { type: 'schema', name: 'test' },
		message: 'No errors for schema'
	},
	{
		input: { entity: { type: 'extension', name: 'test' }, ddl: true },
		output: { type: 'extension', name: 'test' },
		message: 'No errors for extension'
	},
	{
		input: { entity: { type: 'extension', name: 'test', file: 'ddl/test.ddl' }, ddl: true },
		output: {
			type: 'extension',
			name: 'test',
			file: 'ddl/test.ddl',
			errors: ['"extension" does not need a ddl file.', 'File does not exist']
		},
		message: 'File is not allowed for extension'
	},
	{
		input: { entity: { type: 'ddl', name: 'test', file: 'ddl/test.ddl' }, ddl: true },
		output: {
			type: 'ddl',
			name: 'test',
			file: 'ddl/test.ddl',
			errors: [
				'Unknown or unsupported entity type.',
				'Unknown or unsupported entity ddl script.',
				'File does not exist'
			]
		},
		message: 'Unsupported entity type'
	},
	{
		input: { entity: { type: 'table', name: 'test' }, ddl: true },
		output: {
			type: 'table',
			name: 'test',
			errors: ['Use fully qualified name <schema>.<name>', 'File missing for import entity']
		},
		message: 'File missing for import entity'
	},
	{
		input: {
			entity: { type: 'table', name: 'test.missing', file: 'ddl/test/missing.ddl' },
			ddl: true
		},
		output: {
			type: 'table',
			name: 'test.missing',
			file: 'ddl/test/missing.ddl',
			errors: ['File does not exist']
		},
		message: 'File does not exist'
	},
	{
		input: {
			entity: { type: 'table', name: 'test.invalid', file: 'ddl/test/invalid.sql' },
			ddl: true
		},
		output: {
			type: 'table',
			name: 'test.invalid',
			file: 'ddl/test/invalid.sql',
			errors: ['Unsupported file type for ddl']
		},
		message: 'Unsupported file type for ddl'
	},
	{
		input: {
			entity: { type: 'table', name: 'test', file: 'import/other/invalid.ddl' },
			ddl: false
		},
		output: {
			type: 'table',
			name: 'test',
			file: 'import/other/invalid.ddl',
			errors: ['Use fully qualified name <schema>.<name>', 'Unsupported data format']
		},
		message: 'Unsupported data format'
	},
	{
		input: {
			entity: { type: 'table', name: 'staging.lookup', file: 'import/staging/lookup.csv' },
			ddl: false
		},
		output: {
			type: 'table',
			name: 'staging.lookup',
			file: 'import/staging/lookup.csv'
		},
		message: 'No errors in this entity'
	}
]

// Define importScripts
export const importScripts = [
	{
		input: {
			type: 'import',
			name: 'staging.lookup',
			file: 'lookup.csv',
			format: 'csv',
			nullValue: '',
			truncate: true
		},
		output: [
			'do $$',
			'begin',
			'  truncate table staging.lookup;',
			'exception',
			'  when others then',
			'    delete from staging.lookup;',
			'    commit;',
			'end $$;',
			"\\copy staging.lookup from 'lookup.csv' with delimiter E',' NULL as '' csv header;"
		].join('\n'),
		message: 'Should use defaults with name'
	},
	{
		input: {
			type: 'import',
			name: 'staging.lookup',
			file: 'lookup.csv',
			format: 'csv',
			nullValue: 'NULL',
			truncate: true
		},
		output: [
			'do $$',
			'begin',
			'  truncate table staging.lookup;',
			'exception',
			'  when others then',
			'    delete from staging.lookup;',
			'    commit;',
			'end $$;',
			`\\copy staging.lookup from 'lookup.csv' with delimiter E',' NULL as 'NULL' csv header;`
		].join('\n'),
		message: 'Should override nullValue option when provided'
	},
	{
		input: {
			type: 'import',
			name: 'staging.test',
			file: 'lookup.jsonl',
			format: 'jsonl',
			nullValue: '',
			truncate: false
		},
		output: [
			'create table if not exists _temp (data jsonb);',
			// "set client_encoding to 'UTF8';",
			"\\copy _temp from 'lookup.jsonl';",
			"call staging.import_jsonb_to_table('_temp', 'staging.test');",
			'drop table if exists _temp;'
		].join('\n'),
		message: 'Should override truncate option when provided'
	}
]

// Define exportScripts
export const exportScripts = [
	{
		input: { name: 'staging.lookup' },
		output:
			"\\copy (select * from staging.lookup) to 'export/staging/lookup.csv' with delimiter E'\\t' csv header;",
		message: 'Should generate export script'
	},
	{
		input: { name: 'staging.lookup', format: 'jsonl' },
		output:
			"\\copy (select row_to_json(t) from staging.lookup t) to 'export/staging/lookup.jsonl';",
		message: 'Should generate export script'
	}
]
