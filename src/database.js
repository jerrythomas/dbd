import path from 'path'
import createConnectionPool, { sql } from '@databases/pg'

const typesWithoutSchema = ['role']
const typesWithData = ['table', 'view']
const defaultOptions = { truncate: false, null_value: '' }
export const dbtypes = {
	role: 1,
	table: 2,
	index: 3,
	function: 4,
	view: 5,
	procedure: 6,
	synonym: 7,
	grant: 8,
	policy: 9
}
// execute script for an entity using file
function execute(type, name, file) {}

// process.once('SIGTERM', () => {
//   db.dispose().catch((ex) => {
//     console.error(ex);
//   });
// });

function scan(root, type) {
	// scan for files of type ddl or sql
	// returns an array of entities
}
export async function executeScriptFile(file) {
	const migration = sql.file(file)
	const db = createConnectionPool(process.env.DATABASE_URL)
	await db.query(sql`create extension if not exists "uuid-ossp";`)
	await db.query(migration)
	await db.dispose()
}
class Entity {
	#name
	#type
	#schema
	#file

	constructor(input) {
		if ('file' in input) {
			const parts = input.file.replace(path.extname(file), '').split(path.sep)
			this.#file = input.file
			this.#type = parts[0]
			this.#name = typesWithoutSchema.includes(this.#type) ? parts[1] : parts[2]
			this.#schema = typesWithoutSchema.includes(this.#type) ? null : parts[1]
		} else {
			this.#name = input.name
			this.#type = input.type
			this.#schema = input.schema
		}
	}

	get type() {
		return this.#type
	}
	get name() {
		return this.#name
	}
	get schema() {
		return this.#schema
	}
	get file() {
		return this.#file
	}

	get exportFile() {
		if (!typesWithData.includes(this.type)) return null
		return `export/${this.schema}/${this.name}.csv`
	}
	get importFile() {
		const importable =
			path.extname(file) === '.csv' && typesWithData.includes(this.type)

		return importable ? this.file : null
	}
	get ddlFile() {
		const isSQL = ['.ddl', '.sql'].includes(path.extname(this.file))
		return isSQL ? this.file : null
	}
}

export function entity(filepath, opts = defaultOptions) {
	const file = filepath
	const parts = file.replace(path.extname(file), '').split(path.sep)

	const type = parts[0]
	const name = typesWithoutSchema.includes(type) ? parts[1] : parts[2]
	const schema = typesWithoutSchema.includes(type) ? null : parts[1]

	const isCSV = path.extname(file) === '.csv'
	const isSQL = ['.ddl', '.sql'].includes(path.extname(file))

	let actions = { truncate: '', load: '', dump: '' }

	if (isCSV && type === 'table') {
		if (opts.truncate) {
			actions.truncate = `truncate table ${schema}.${name};`
		}

		if (type === 'table') {
			actions.load = `\\copy ${schema}.${name} from '${file}' with delimiter ',' NULL as '${opts.null_value}' csv header;`
		}

		if (['table', 'view'].includes(type)) {
			actions.dump = `\\copy (select * from ${name}) to '${file}' with delimiter ',' csv header;`
		}
	}

	return { type, name, schema, file, isCSV, isSQL, actions }
}

// scan('.csv').filter(opts).group()
// apply, import, export, combine, convert
