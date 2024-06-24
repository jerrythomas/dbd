// Define variables for the 'input' section elements that are used more than once
const configLookups = {
	type: 'table',
	name: 'config.lookups'
}

const configLookupValuesRefersConfigLookups = {
	type: 'table',
	name: 'config.lookup_values',
	refers: ['config.lookups']
}

const stagingLookupValues = {
	type: 'table',
	name: 'staging.lookup_values'
}

// Define variables for the 'output' section elements that are used more than once
const referenceUuid = {
	name: 'uuid_generate_v4',
	type: null,
	error: 'Reference uuid_generate_v4 not found in [config, extensions]'
}

const referenceConfigLookups = {
	name: 'config.lookups',
	schema: 'config',
	type: 'table'
}

const referenceConfigLookupValues = {
	name: 'config.lookup_values',
	schema: 'config',
	type: 'table'
}

const outputEntityStagingLookupValues = {
	type: 'table',
	name: 'staging.lookup_values',
	file: 'ddl/table/staging/lookup_values.ddl',
	format: 'ddl',
	refers: [],
	references: [],
	schema: 'staging',
	searchPaths: ['staging'],
	errors: []
}

// Assemble and export the full objects using ESM syntax
export const input = {
	project: {
		staging: []
	},
	schemas: ['extensions', 'config'],
	entities: [
		{
			type: 'role',
			name: 'advanced',
			refers: ['basic']
		},
		configLookups,
		configLookupValuesRefersConfigLookups,
		{
			type: 'view',
			name: 'config.genders',
			refers: ['config.lookups', 'config.lookup_values']
		},
		stagingLookupValues
	],
	roles: [],
	import: {
		tables: ['staging.lookup_values']
	}
}

export const output = {
	project: {
		staging: []
	},
	schemas: ['extensions', 'config', 'staging', 'migrate'],
	entities: [
		{
			type: 'table',
			name: 'config.lookups',
			file: 'ddl/table/config/lookups.ddl',
			format: 'ddl',
			refers: [],
			references: [referenceUuid],
			schema: 'config',
			searchPaths: ['config', 'extensions'],
			errors: []
		},
		{
			type: 'table',
			name: 'config.lookup_values',
			file: 'ddl/table/config/lookup_values.ddl',
			format: 'ddl',
			refers: ['config.lookups'],
			references: [referenceUuid, referenceConfigLookups],
			schema: 'config',
			searchPaths: ['config', 'extensions'],
			errors: []
		},
		{
			type: 'view',
			name: 'config.genders',
			file: 'ddl/view/config/genders.ddl',
			format: 'ddl',
			refers: ['config.lookups', 'config.lookup_values'],
			references: [referenceConfigLookups, referenceConfigLookupValues],
			schema: 'config',
			searchPaths: ['config'],
			errors: []
		},
		outputEntityStagingLookupValues,
		{
			type: 'procedure',
			name: 'staging.import_lookup_values',
			file: 'ddl/procedure/staging/import_lookup_values.ddl',
			format: 'ddl',
			refers: ['config.lookups', 'config.lookup_values', 'staging.lookup_values'],
			references: [
				referenceConfigLookups,
				referenceConfigLookupValues,
				{
					name: 'staging.lookup_values',
					schema: 'staging',
					type: 'table'
				}
			],
			schema: 'staging',
			searchPaths: ['staging'],
			errors: []
		},
		{
			type: 'procedure',
			name: 'staging.import_lookups',
			file: 'ddl/procedure/staging/import_lookups.ddl',
			format: 'ddl',
			refers: ['config.lookups', 'staging.lookups'],
			references: [
				referenceConfigLookups,
				{
					name: 'staging.lookups',
					schema: 'staging',
					type: 'table'
				}
			],
			schema: 'staging',
			searchPaths: ['staging'],
			errors: []
		},
		{
			type: 'procedure',
			name: 'staging.import_jsonb_to_table',
			file: 'ddl/procedure/staging/import_jsonb_to_table.ddl',
			format: 'ddl',
			refers: [],
			references: [],
			schema: 'staging',
			searchPaths: ['staging'],
			errors: []
		},
		{
			type: 'view',
			name: 'migrate.lookup_values',
			file: 'ddl/view/migrate/lookup_values.ddl',
			format: 'ddl',
			references: [referenceConfigLookups, referenceConfigLookupValues],
			refers: ['config.lookups', 'config.lookup_values'],
			schema: 'migrate',
			searchPaths: ['migrate'],
			errors: []
		},
		{
			type: 'table',
			name: 'staging.lookups',
			file: 'ddl/table/staging/lookups.ddl',
			format: 'ddl',
			refers: [],
			references: [],
			schema: 'staging',
			searchPaths: ['staging'],
			errors: []
		}
	],
	roles: [
		{
			type: 'role',
			name: 'advanced',
			refers: ['basic']
		}
	],
	import: {
		tables: ['staging.lookup_values']
	},
	importTables: [
		{
			type: 'import',
			name: 'staging.lookup_values',
			schema: 'staging',
			format: 'csv',
			nullValue: '',
			truncate: true,
			file: 'import/staging/lookup_values.csv'
		}
	]
}
