// Define variables for items that are reused
const roleBasic = {
	type: 'role',
	name: 'basic',
	refers: [],
	errors: []
}

const roleAdvanced = {
	type: 'role',
	name: 'advanced',
	refers: ['basic'],
	errors: []
}

const tblConfigLookups = {
	type: 'table',
	name: 'config.lookups',
	file: 'ddl/table/config/lookups.ddl',
	format: 'ddl',
	schema: 'config',
	refers: []
}

const tblConfigLookupValues = {
	type: 'table',
	name: 'config.lookup_values',
	file: 'ddl/table/config/lookup_values.ddl',
	format: 'ddl',
	schema: 'config',
	refers: ['config.lookups']
}

const tblStagingLookupValues = {
	type: 'table',
	name: 'staging.lookup_values',
	file: 'ddl/table/staging/lookup_values.ddl',
	format: 'ddl',
	schema: 'staging',
	refers: []
}

const viewConfigGenders = {
	type: 'view',
	name: 'config.genders',
	file: 'ddl/view/config/genders.ddl',
	format: 'ddl',
	schema: 'config',
	refers: ['config.lookups', 'config.lookup_values']
}
const viewConfigRangeValues = {
	type: 'view',
	name: 'config.range_values',
	file: 'ddl/view/config/range_values.ddl',
	format: 'ddl',
	schema: 'config',
	refers: ['config.lookups', 'config.lookup_values']
}

const viewMigrateLookupValues = {
	type: 'view',
	name: 'migrate.lookup_values',
	file: 'ddl/view/migrate/lookup_values.ddl',
	format: 'ddl',
	schema: 'migrate',
	refers: ['config.lookups', 'config.lookup_values']
}

const procStagingImportLookups = {
	type: 'procedure',
	name: 'staging.import_lookups',
	file: 'ddl/procedure/staging/import_lookups.ddl',
	format: 'ddl',
	schema: 'staging',
	refers: ['config.lookups', 'staging.lookups']
}

// Export the full objects using ESM syntax
export const config = {
	roles: [roleBasic, roleAdvanced],
	entities: [
		tblConfigLookups,
		tblStagingLookupValues,
		{
			type: 'procedure',
			name: 'staging.import_json_to_table',
			file: 'ddl/procedure/staging/import_json_to_table.ddl',
			format: 'ddl',
			schema: 'staging',
			refers: [],
			errors: ['Entity name in script does not match file name']
		},
		tblConfigLookupValues,
		viewConfigGenders,
		viewConfigRangeValues,
		viewMigrateLookupValues,
		procStagingImportLookups
	]
}

export const roles = [roleBasic, roleAdvanced]

export const entities = [
	{
		type: 'schema',
		name: 'config'
	},
	{
		type: 'schema',
		name: 'extensions'
	},
	{
		type: 'schema',
		name: 'staging'
	},
	{
		type: 'schema',
		name: 'migrate'
	},
	{
		type: 'extension',
		name: 'uuid-ossp',
		schema: 'extensions'
	},
	roleBasic,
	roleAdvanced,
	{
		...tblConfigLookups,
		references: [
			{
				name: 'uuid_generate_v4',
				type: 'extension'
			}
		],
		searchPaths: ['config', 'extensions'],
		errors: []
	},
	{
		type: 'procedure',
		name: 'staging.import_jsonb_to_table',
		file: 'ddl/procedure/staging/import_jsonb_to_table.ddl',
		format: 'ddl',
		schema: 'staging',
		refers: [],
		references: [],
		searchPaths: ['staging'],
		errors: []
	},
	{
		...tblStagingLookupValues,
		references: [],
		errors: [],
		searchPaths: ['staging']
	},
	{
		errors: [],
		file: 'ddl/table/staging/lookups.ddl',
		format: 'ddl',
		name: 'staging.lookups',
		references: [],
		refers: [],
		schema: 'staging',
		searchPaths: ['staging'],
		type: 'table'
	},
	{
		...tblConfigLookupValues,
		references: [
			{
				name: 'uuid_generate_v4',
				type: 'extension'
			},
			{
				name: 'config.lookups',
				type: 'table',
				schema: 'config'
			}
		],
		searchPaths: ['config', 'extensions'],
		errors: []
	},
	{
		...procStagingImportLookups,
		references: [
			{
				name: 'config.lookups',
				type: 'table',
				schema: 'config'
			},
			{
				name: 'staging.lookups',
				type: 'table',
				schema: 'staging'
			}
		],
		searchPaths: ['staging'],
		errors: []
	},
	{
		...viewConfigGenders,
		references: [
			{
				name: 'config.lookups',
				type: 'table',
				schema: 'config'
			},
			{
				name: 'config.lookup_values',
				type: 'table',
				schema: 'config'
			}
		],
		searchPaths: ['config'],
		errors: []
	},
	{
		...viewConfigRangeValues,
		references: [
			{
				name: 'config.lookups',
				type: 'table',
				schema: 'config'
			},
			{
				name: 'config.lookup_values',
				type: 'table',
				schema: 'config'
			}
		],
		searchPaths: ['config'],
		errors: []
	},
	{
		...viewMigrateLookupValues,
		references: [
			{
				name: 'config.lookups',
				type: 'table',
				schema: 'config'
			},
			{
				name: 'config.lookup_values',
				type: 'table',
				schema: 'config'
			}
		],
		searchPaths: ['migrate'],
		errors: []
	},

	{
		errors: [],
		file: 'ddl/procedure/staging/import_lookup_values.ddl',
		format: 'ddl',
		name: 'staging.import_lookup_values',
		references: [
			{
				name: 'config.lookups',
				schema: 'config',
				type: 'table'
			},
			{
				name: 'config.lookup_values',
				schema: 'config',
				type: 'table'
			},
			{
				name: 'staging.lookup_values',
				schema: 'staging',
				type: 'table'
			}
		],
		refers: ['config.lookups', 'config.lookup_values', 'staging.lookup_values'],
		schema: 'staging',
		searchPaths: ['staging'],
		type: 'procedure'
	}
]

export const beforeApply = {
	schemas: [],
	tables: []
}

export const afterApply = {
	schemas: [
		{ schema_name: 'config' },
		{ schema_name: 'extensions' },
		{ schema_name: 'staging' },
		{ schema_name: 'migrate' }
	],
	tables: [
		{
			table_schema: 'config',
			table_name: 'genders',
			table_type: 'VIEW'
		},
		{
			table_schema: 'config',
			table_name: 'range_values',
			table_type: 'VIEW'
		},
		{
			table_schema: 'config',
			table_name: 'lookup_values',
			table_type: 'BASE TABLE'
		},
		{
			table_schema: 'config',
			table_name: 'lookups',
			table_type: 'BASE TABLE'
		},
		{
			table_schema: 'migrate',
			table_name: 'lookup_values',
			table_type: 'VIEW'
		},
		{
			table_schema: 'staging',
			table_name: 'lookup_values',
			table_type: 'BASE TABLE'
		},
		{
			table_schema: 'public',
			table_name: 'test',
			table_type: 'BASE TABLE'
		}
	]
}
