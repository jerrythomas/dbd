// Define variables for reused items
const schemaStaging = 'staging'

const optsCsv = {
	format: 'csv'
}

const optsJson = {
	format: 'json'
}

// Export the JavaScript module using ESM syntax
export const designExport = [
	{
		input: 'staging.lookups',
		output: {
			schema: schemaStaging,
			name: 'lookups',
			opts: optsCsv
		}
	},
	{
		input: {
			'staging.lookup_values': {
				format: 'json'
			}
		},
		output: {
			schema: schemaStaging,
			name: 'lookup_values',
			opts: optsJson
		}
	}
]
