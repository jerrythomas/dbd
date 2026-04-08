import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { auditDesign, fixDesign, checkExportColumns, findDDLFile } from '../src/doctor.js'
import { load } from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const exampleDir = join(__dirname, '..', 'example')
const doctorFixture = join(__dirname, 'fixtures', 'doctor')

describe('findDDLFile', () => {
	beforeAll(() => process.chdir(exampleDir))

	it('finds a table DDL file', () => {
		expect(findDDLFile('table', 'config', 'lookups')).toMatch(/lookups\.ddl$/)
	})

	it('finds a view DDL file', () => {
		expect(findDDLFile('view', 'migrate', 'lookup_values')).toMatch(/lookup_values\.ddl$/)
	})

	it('returns null when file does not exist', () => {
		expect(findDDLFile('table', 'config', 'nonexistent')).toBeNull()
	})
})

describe('auditDesign — clean project', () => {
	beforeAll(() => process.chdir(exampleDir))

	it('reports no stale entries in the example project', () => {
		const audit = auditDesign('design.yaml')
		expect(audit.staleSchemas).toEqual([])
		expect(audit.staleStaging).toEqual([])
		expect(audit.staleImport).toEqual([])
		expect(audit.staleExport).toEqual([])
	})
})

describe('auditDesign — stale entries', () => {
	let originalDir

	beforeEach(() => {
		originalDir = process.cwd()
		process.chdir(doctorFixture)
	})

	afterEach(() => process.chdir(originalDir))

	it('detects schemas with no DDL files', () => {
		const { staleSchemas } = auditDesign('design.yaml')
		expect(staleSchemas).toContain('orphan')
	})

	it('does not flag schemas protected by project.staging, project.migrate, or extensionSchema', () => {
		const { staleSchemas } = auditDesign('design.yaml')
		expect(staleSchemas).not.toContain('staging')
		expect(staleSchemas).not.toContain('migrate')
		expect(staleSchemas).not.toContain('extensions')
	})

	it('detects staging schemas with no DDL files', () => {
		const { staleStaging } = auditDesign('design.yaml')
		expect(staleStaging).toContain('orphan_staging')
		expect(staleStaging).not.toContain('staging')
	})

	it('detects migrate schemas with no DDL files', () => {
		const { staleMigrate } = auditDesign('design.yaml')
		expect(staleMigrate).toContain('orphan_migrate')
		expect(staleMigrate).not.toContain('migrate')
	})

	it('detects import tables with no corresponding file', () => {
		const { staleImport } = auditDesign('design.yaml')
		const names = staleImport.map((e) => (typeof e === 'string' ? e : Object.keys(e)[0]))
		expect(names).toContain('config.items')
		expect(names).toContain('config.missing_table')
	})

	it('detects export entries with no DDL file', () => {
		const { staleExport } = auditDesign('design.yaml')
		expect(staleExport).toContain('config.nonexistent')
		expect(staleExport).not.toContain('config.items')
	})
})

describe('fixDesign', () => {
	let originalDir

	beforeEach(() => {
		originalDir = process.cwd()
		process.chdir(doctorFixture)
	})

	afterEach(() => process.chdir(originalDir))

	it('removes stale entries and returns valid YAML', () => {
		const fixed = fixDesign('design.yaml')
		const parsed = load(fixed)

		expect(parsed.schemas).not.toContain('orphan')
		expect(parsed.schemas).toContain('config')
		expect(parsed.project?.staging ?? []).not.toContain('orphan_staging')
		expect(parsed.project?.staging ?? []).toContain('staging')
		expect(parsed.project?.migrate ?? []).not.toContain('orphan_migrate')
		expect(parsed.project?.migrate ?? []).toContain('migrate')
		expect(parsed.export).not.toContain('config.nonexistent')
		expect(parsed.export).toContain('config.items')
	})

	it('removes all stale import tables', () => {
		const fixed = fixDesign('design.yaml')
		const parsed = load(fixed)
		expect(parsed.import?.tables ?? []).toHaveLength(0)
	})
})

describe('checkExportColumns', () => {
	let originalDir

	beforeAll(() => {
		originalDir = process.cwd()
		process.chdir(exampleDir)
	})

	afterEach(() => process.chdir(originalDir))

	// Columns from example DDL files:
	// migrate.lookup_values view: name, value, details, is_active, modified_at, modified_by
	// staging.lookup_values table: name, value, sequence, is_active, is_hidden, details, description, modified_at, modified_by
	// 'details' is at index 2 in view but index 5 in staging (after is_active at 3) → order mismatch
	const viewCols = ['name', 'value', 'details', 'is_active', 'modified_at', 'modified_by']
	const stagingCols = [
		'name',
		'value',
		'sequence',
		'is_active',
		'is_hidden',
		'details',
		'description',
		'modified_at',
		'modified_by'
	]

	it('detects column order mismatch between export view and staging table', () => {
		const config = {
			export: ['migrate.lookup_values'],
			project: { staging: ['staging'] }
		}
		const mockAdapter = {
			parseViewColumns: () => viewCols,
			parseTableSnapshot: () => ({ columns: stagingCols.map((name) => ({ name })) })
		}
		const issues = checkExportColumns(config, mockAdapter)
		expect(issues).toHaveLength(1)
		expect(issues[0].export).toBe('migrate.lookup_values')
		expect(issues[0].stagingTable).toBe('staging.lookup_values')
		expect(issues[0].orderMismatch).toBe(true)
		expect(issues[0].missingColumns).toEqual([])
	})

	it('detects view columns not present in staging table', () => {
		const config = {
			export: ['migrate.lookup_values'],
			project: { staging: ['staging'] }
		}
		const mockAdapter = {
			parseViewColumns: () => ['name', 'value', 'extra_col'],
			parseTableSnapshot: () => ({ columns: [{ name: 'name' }, { name: 'value' }] })
		}
		const issues = checkExportColumns(config, mockAdapter)
		expect(issues).toHaveLength(1)
		expect(issues[0].missingColumns).toEqual(['extra_col'])
	})

	it('returns no issues when view columns are a valid ordered subset of staging', () => {
		const config = {
			export: ['migrate.lookup_values'],
			project: { staging: ['staging'] }
		}
		const mockAdapter = {
			parseViewColumns: () => ['name', 'value', 'modified_at'],
			parseTableSnapshot: () => ({
				columns: stagingCols.map((name) => ({ name }))
			})
		}
		const issues = checkExportColumns(config, mockAdapter)
		expect(issues).toHaveLength(0)
	})

	it('skips export entries with no corresponding view DDL file', () => {
		// config.lookups is a table, not a view — findDDLFile('view', ...) returns null → skipped
		const config = {
			export: ['config.lookups'],
			project: { staging: ['staging'] }
		}
		const mockAdapter = {
			parseViewColumns: () => viewCols,
			parseTableSnapshot: () => ({ columns: [] })
		}
		expect(checkExportColumns(config, mockAdapter)).toHaveLength(0)
	})

	it('skips export views with no corresponding staging table', () => {
		// migrate.lookup_values view exists, but no staging schema with same name
		const config = {
			export: ['migrate.lookup_values'],
			project: { staging: [] }
		}
		const mockAdapter = {
			parseViewColumns: () => viewCols,
			parseTableSnapshot: () => ({ columns: [] })
		}
		expect(checkExportColumns(config, mockAdapter)).toHaveLength(0)
	})
})
