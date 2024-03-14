export const typesWithSchema = ['table', 'view', 'function', 'procedure', 'import']
export const typesWithoutSchema = ['role', 'schema', 'extension']
export const allowedTypes = [...typesWithSchema, ...typesWithoutSchema]
export const defaultExportOptions = { format: 'csv' }
export const defaultImportOptions = {
	format: 'csv',
	nullValue: '',
	truncate: true
}
