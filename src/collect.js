import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

const typesWithData = ['table', 'view']
const defaultImportOptions = { truncate: false, null_value: '' }

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

const actions = {
	extension: (name, using) =>
		sql`create extension if not exists "${name}" with name "${
			using || 'public'
		}";`,
	schema: (name) => sql`create schema if not exists "${name}";`
}

class Design {
	#config = {}
	#data = []
	#allowedTypes = []
	#mode
	#dependencies = []

	constructor(mode) {
		this.#config = yaml.load(fs.readFileSync('db.yml', 'utf8'))
		const schemas = (this.config.schemas || []).map((name) => ({
			type: 'name',
			name
		}))
		const extensions = (this.config.extensions || []).map((item) =>
			entityForExtension(item)
		)
		this.#dependencies = this.config.dependencies || []

		delete this.#config.schemas
		delete this.#config.extensions
		delete this.#config.dependencies

		this.#mode = mode

		if (['ddl', 'import', 'export'].includes(mode)) {
			this.#allowedTypes = mode === 'ddl' ? ['.ddl'] : ['.csv', '.json']

			if (['ddl', 'import'].includes(mode)) {
				this.#data = scan(mode)
					.filter((file) => this.allowedTypes.includes(path.extname(file)))
					.map((file) => entity(file))
			}

			if (mode === 'ddl') {
				this.#data = [...schemas, ...extensions, ...this.data]
			}
			if (mode === 'export') {
				this.#data = this.config.export.map((item) => entityForExport(item))
			}
		}
	}

	get data() {
		return this.#data
	}
	get config() {
		return this.#config
	}
	get allowedTypes() {
		return this.#allowedTypes
	}
	get mode() {
		return thus.#mode
	}

	analyze() {
		return this
	}

	filter() {
		return this
	}
	group() {
		return this
	}
	sort() {
		return this
	}
	apply() {
		return this
	}
}

/**
 * Collects files from path or entities from configuration
 * and provides functions to process further
 *
 * @param {string} mode starting point for procesing
 * @returns
 */
export function collect(mode) {
	return new Design(mode)
}
