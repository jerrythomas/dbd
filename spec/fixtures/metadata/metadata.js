// Define variables for elements that are used more than once
const roleAdvanced = {
	type: 'role',
	name: 'advanced',
	refers: ['basic']
}

const tblConfigLookups = {
	type: 'table',
	name: 'config.lookups',
	refers: []
}

const tblConfigLookupValues = {
	type: 'table',
	name: 'config.lookup_values',
	refers: ['config.lookups']
}

const tblStagingLookupValues = {
	type: 'table',
	name: 'staging.lookup_values',
	refers: []
}

const viewConfigGenders = {
	type: 'view',
	name: 'config.genders',
	refers: ['config.lookups', 'config.lookup_values']
}

// Assemble and export the full objects using ESM syntax
export const items = [
	roleAdvanced,
	tblConfigLookups,
	tblConfigLookupValues,
	tblStagingLookupValues,
	viewConfigGenders,
	{
		type: 'view',
		name: 'migrate.lookup_values',
		refers: ['config.lookups', 'config.lookup_values']
	}
]

export const read = {
	project: {
		name: 'Example',
		database: 'PostgreSQL',
		extensionSchema: 'extensions',
		staging: ['staging'],
		dbdocs: {
			exclude: {
				schemas: ['staging', 'migrate', 'extensions'],
				tables: []
			}
		}
	},
	schemas: ['config', 'extensions', 'staging', 'migrate'],
	extensions: ['uuid-ossp'],
	roles: [roleAdvanced],
	tables: [tblConfigLookups, tblConfigLookupValues, tblStagingLookupValues],
	views: [
		viewConfigGenders,
		{
			type: 'view',
			name: 'migrate.lookup_values',
			refers: ['config.lookups', 'config.lookup_values']
		}
	],
	functions: [],
	procedures: [],
	entities: [
		tblConfigLookups,
		tblConfigLookupValues,
		tblStagingLookupValues,
		viewConfigGenders,
		{
			type: 'view',
			name: 'migrate.lookup_values',
			refers: ['config.lookups', 'config.lookup_values']
		}
	],
	import: {
		options: {
			truncate: true,
			nullValue: ''
		},
		tables: ['staging.lookup_values'],
		after: ['import/loader.sql']
	},
	export: ['config.lookups', 'config.lookup_values', 'config.genders', 'migrate.lookup_values']
}

export const merge = [
	{
		input: {
			x: [
				{ type: 'table', name: 'config.lookups', file: 'ddl/table/config/lookups.ddl' },
				{ type: 'table', name: 'config.lookup_values', file: 'ddl/table/config/lookup_values.ddl' },
				{ type: 'view', name: 'config.genders', file: 'ddl/table/config/genders.ddl' },
				{
					type: 'table',
					name: 'staging.lookup_values',
					file: 'ddl/table/staging/lookup_values.ddl'
				}
			],
			y: [
				{ type: 'table', name: 'config.lookup_values', refers: ['config.lookups'] },
				{ type: 'view', name: 'config.genders', refers: ['config.lookups', 'config.lookup_values'] }
			]
		},
		output: [
			{
				type: 'table',
				name: 'config.lookup_values',
				file: 'ddl/table/config/lookup_values.ddl',
				refers: ['config.lookups']
			},
			{
				type: 'view',
				name: 'config.genders',
				file: 'ddl/table/config/genders.ddl',
				refers: ['config.lookups', 'config.lookup_values']
			},
			{ type: 'table', name: 'config.lookups', file: 'ddl/table/config/lookups.ddl' },
			{ type: 'table', name: 'staging.lookup_values', file: 'ddl/table/staging/lookup_values.ddl' }
		]
	},
	{
		input: {
			x: [
				{ type: 'table', name: 'config.lookups', file: 'ddl/table/config/lookups.ddl', refers: [] },
				{
					type: 'table',
					name: 'config.lookup_values',
					file: 'ddl/table/config/lookup_values.ddl',
					refers: []
				},
				{ type: 'view', name: 'config.genders', file: 'ddl/table/config/genders.ddl', refers: [] },
				{
					type: 'table',
					name: 'staging.lookup_values',
					file: 'ddl/table/staging/lookup_values.ddl',
					refers: []
				}
			],
			y: [
				{ type: 'table', name: 'config.lookups' },
				{ type: 'table', name: 'config.lookup_values', refers: ['config.lookups'] },
				{ type: 'view', name: 'config.genders', refers: ['config.lookups', 'config.lookup_values'] }
			]
		},
		output: [
			{ type: 'table', name: 'config.lookups', file: 'ddl/table/config/lookups.ddl', refers: [] },
			{
				type: 'table',
				name: 'config.lookup_values',
				file: 'ddl/table/config/lookup_values.ddl',
				refers: ['config.lookups']
			},
			{
				type: 'view',
				name: 'config.genders',
				file: 'ddl/table/config/genders.ddl',
				refers: ['config.lookups', 'config.lookup_values']
			},
			{
				type: 'table',
				name: 'staging.lookup_values',
				file: 'ddl/table/staging/lookup_values.ddl',
				refers: []
			}
		]
	}
]

export const clean = {
	entities: []
}

export const missingTypes = {
	input: {
		roles: [
			{ name: 'authenticated' },
			{ name: 'another', refers: ['authenticated'], type: 'role' }
		],
		tables: [
			{ name: 'config.lookups' },
			{ name: 'config.lookup_values', refers: ['config.lookups'] }
		],
		views: [
			{ name: 'config.genders' },
			{ name: 'config.types', refers: ['config.lookups', 'config.lookup_values'] }
		],
		functions: [
			{ name: 'config.get_lookup' },
			{ name: 'config.get_type', refers: ['config.lookup'] }
		],
		procedures: [
			{ name: 'config.import_lookups' },
			{ name: 'config.import_types', refers: ['config.lookup'] }
		]
	},
	output: {
		roles: [
			{ refers: [], name: 'authenticated', type: 'role' },
			{ name: 'another', refers: ['authenticated'], type: 'role' }
		],
		tables: [
			{ refers: [], name: 'config.lookups', type: 'table' },
			{ name: 'config.lookup_values', refers: ['config.lookups'], type: 'table' }
		],
		views: [
			{ refers: [], name: 'config.genders', type: 'view' },
			{ name: 'config.types', refers: ['config.lookups', 'config.lookup_values'], type: 'view' }
		],
		functions: [
			{ refers: [], name: 'config.get_lookup', type: 'function' },
			{ name: 'config.get_type', refers: ['config.lookup'], type: 'function' }
		],
		procedures: [
			{ refers: [], name: 'config.import_lookups', type: 'procedure' },
			{ name: 'config.import_types', refers: ['config.lookup'], type: 'procedure' }
		]
	}
}
