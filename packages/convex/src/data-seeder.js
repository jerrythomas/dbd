import { execFileSync } from 'child_process'
import { resolveTableName } from './schema-generator.js'

const FORMAT_MAP = {
	csv: 'csv',
	jsonl: 'jsonl',
	json: 'jsonl'
}

/**
 * Build the argument array for `npx convex import`.
 * Uses an array (not a shell string) to prevent injection.
 *
 * @param {string} tableName - Convex table name
 * @param {string} file - Path to the data file
 * @param {string} format - Source format: 'csv', 'jsonl', or 'json'
 * @param {boolean} isProd - Whether to target the prod deployment
 * @returns {string[]}
 */
export function buildImportArgs(tableName, file, format, isProd) {
	const fmt = FORMAT_MAP[format] ?? 'jsonl'
	const args = ['convex', 'import', '--table', tableName, '--format', fmt]
	if (isProd) args.push('--prod')
	args.push(file)
	return args
}

/**
 * Build a human-readable `npx convex import` command string for dry-run display.
 *
 * @param {string} tableName
 * @param {string} file
 * @param {string} format
 * @param {boolean} isProd
 * @returns {string}
 */
export function convexImportCommand(tableName, file, format, isProd) {
	return ['npx', ...buildImportArgs(tableName, file, format, isProd)].join(' ')
}

/**
 * Seed a single table into Convex by shelling to `npx convex import`.
 * Uses execFileSync with an argument array (not a shell string).
 *
 * @param {{ name: string, schema: string, file: string, format?: string }} table
 * @param {{ schemaPrefix?: boolean, schemaPrefixSkip?: string[] }} convexConfig
 * @param {boolean} isProd
 */
export function seedTable(table, convexConfig, isProd = false) {
	const tableName = resolveTableName(table, convexConfig)
	const args = buildImportArgs(tableName, table.file, table.format ?? 'csv', isProd)
	execFileSync('npx', args, { stdio: 'inherit', env: { ...process.env } })
}
