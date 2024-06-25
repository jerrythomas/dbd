// Define variables for reused items
const schemaCore = 'core'
const schemaStaging = 'staging'
const schemaPublic = 'public'

const importSchemaCsv = {
	format: 'csv',
	nullValue: '',
	truncate: true,
	listed: true
}

const errorMissingFile = 'File missing for import entity'
const errorUnsupportedEntity = 'Unknown or unsupported entity type.'
const errorUnsupportedDDLScript = 'Unknown or unsupported entity ddl script.'

// Export the JavaScript module using ESM syntax
export const importTables = [
	{
		type: 'import',
		name: 'staging.lookup',
		schema: schemaStaging,
		format: 'csv',
		nullValue: null,
		truncate: false,
		listed: true,
		errors: [errorMissingFile],
		order: -1,
		refers: [],
		schema: 'staging',
		warnings: []
	},

	{
		type: 'import',
		name: 'core.lookups',
		schema: schemaCore,
		...importSchemaCsv,
		errors: [errorMissingFile, 'Import is only allowed for staging schemas'],
		order: 0,
		refers: [],
		warnings: []
	},
	{
		type: 'import',
		name: 'core.lookup_values',
		file: 'import/core/lookup_values.csv',
		schema: schemaCore,
		...importSchemaCsv,
		errors: ['Import is only allowed for staging schemas'],
		order: 4,
		refers: ['core.lookups'],
		warnings: []
	}
]

export const entities = [
	{
		type: 'schema',
		name: schemaCore
	},
	{
		type: 'schema',
		name: schemaStaging
	},
	{
		type: 'schema',
		name: 'no_schema'
	},
	{
		type: 'schema',
		name: schemaPublic
	},
	{
		type: 'extension',
		name: 'uuid-ossp',
		schema: schemaPublic
	},
	{
		refers: [],
		name: 'core.lookups',
		type: 'table',
		errors: [errorMissingFile]
	},
	{
		refers: [],
		name: 'no_schema',
		type: 'table',
		errors: ['Use fully qualified name <schema>.<name>', errorMissingFile]
	},
	{
		type: null,
		name: null,
		file: 'ddl/core/stuff.ddl',
		refers: [],
		references: [],
		errors: ['Location of the file is incorrect', errorUnsupportedEntity, errorUnsupportedDDLScript]
	},
	{
		type: 'table',
		name: 'public.test',
		file: 'ddl/test.ddl',
		schema: schemaPublic,
		refers: [],
		references: [],
		searchPaths: [schemaPublic],
		errors: []
	},
	{
		refers: [],
		name: 'staging.lookup_values',
		type: 'table',
		errors: [errorMissingFile]
	},
	{
		type: 'table',
		name: 'core.lookup_values',
		refers: ['core.lookups'],
		errors: [errorMissingFile]
	}
]
