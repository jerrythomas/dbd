/**
 * Tests for packages/dbml/src/converter.js
 *
 * Tests the DBML conversion pipeline: DDL cleanup, SQL→DBML conversion,
 * schema qualification, and the full generateDBML orchestrator.
 */
import { describe, it, expect } from 'vitest'
import {
	removeCommentBlocks,
	removeIndexCreationStatements,
	removeCommentOnStatements,
	normalizeComment,
	normalizeComments,
	buildTableLookup,
	qualifyTableNames,
	cleanupDDLForDBML,
	removeRedundantInlineRefs,
	buildTableReplacements,
	applyTableReplacements,
	buildProjectBlock,
	convertToDBML,
	generateDBML
} from '../src/converter.js'

describe('DDL cleanup', () => {
	describe('removeCommentBlocks()', () => {
		it('removes COMMENT ON statements', () => {
			const sql = "CREATE TABLE t (id int);\nCOMMENT ON TABLE t IS 'a table';"
			const result = removeCommentBlocks(sql)
			expect(result).not.toContain('COMMENT ON')
			expect(result).toContain('CREATE TABLE')
		})

		it('removes line comments', () => {
			const sql = 'CREATE TABLE t (id int); -- this is a comment\nSELECT 1;'
			const result = removeCommentBlocks(sql)
			expect(result).not.toContain('-- this is a comment')
			expect(result).toContain('SELECT 1;')
		})

		it('removes block comments', () => {
			const sql = 'CREATE TABLE t (id int); /* block comment */ SELECT 1;'
			const result = removeCommentBlocks(sql)
			expect(result).not.toContain('block comment')
			expect(result).toContain('SELECT 1;')
		})
	})

	describe('removeIndexCreationStatements()', () => {
		it('removes CREATE INDEX statements', () => {
			const sql = 'CREATE TABLE t (id int);\nCREATE INDEX idx_t_id ON t(id);\nSELECT 1;'
			const result = removeIndexCreationStatements(sql)
			expect(result).not.toContain('CREATE INDEX')
			expect(result).toContain('CREATE TABLE')
			expect(result).toContain('SELECT 1;')
		})

		it('removes CREATE UNIQUE INDEX statements', () => {
			const sql = 'CREATE UNIQUE INDEX idx_t_id ON t(id);'
			const result = removeIndexCreationStatements(sql)
			expect(result).not.toContain('CREATE UNIQUE INDEX')
		})
	})

	describe('removeCommentOnStatements()', () => {
		it('removes single-line COMMENT ON statements', () => {
			const sql = "CREATE TABLE t (id int);\nCOMMENT ON TABLE t IS 'a table';\nSELECT 1;"
			const result = removeCommentOnStatements(sql)
			expect(result).not.toContain('COMMENT ON')
			expect(result).toContain('CREATE TABLE')
			expect(result).toContain('SELECT 1;')
		})

		it('removes multi-line COMMENT ON FUNCTION statements', () => {
			const sql = `CREATE FUNCTION foo() RETURNS void;
comment on function foo is
'Returns statistical information.
- Provides chunk count
- Useful for analytics';
SELECT 1;`
			const result = removeCommentOnStatements(sql)
			expect(result).not.toContain('comment on function')
			expect(result).not.toContain('Returns statistical')
			expect(result).toContain('CREATE FUNCTION')
			expect(result).toContain('SELECT 1;')
		})

		it('removes COMMENT ON COLUMN statements', () => {
			const sql = "COMMENT ON COLUMN users.id IS 'unique id';"
			const result = removeCommentOnStatements(sql)
			expect(result.trim()).toBe('')
		})
	})

	describe('normalizeComment()', () => {
		it('normalizes multi-line COMMENT ON TABLE to single line', () => {
			const input = "comment on table users IS 'line1\nline2\nline3';"
			const result = normalizeComment(input)
			expect(result).not.toContain('\n')
			expect(result).toContain('line1\\nline2\\nline3')
		})

		it('passes through non-matching strings unchanged', () => {
			const input = 'SELECT 1;'
			expect(normalizeComment(input)).toBe(input)
		})
	})

	describe('removeRedundantInlineRefs()', () => {
		it('removes inline references for columns covered by table-level FK constraints', () => {
			const sql = `CREATE TABLE subscribers (
  id uuid PRIMARY KEY,
  user_id uuid references users(id),
  CONSTRAINT subscribers_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);`
			const result = removeRedundantInlineRefs(sql)
			expect(result).not.toContain('references users(id)')
			expect(result).toContain('user_id uuid')
			expect(result).toContain('FOREIGN KEY (user_id)')
		})

		it('leaves inline references untouched when no table-level FK exists', () => {
			const sql = 'CREATE TABLE t (\n  user_id uuid references users(id)\n);'
			const result = removeRedundantInlineRefs(sql)
			expect(result).toContain('references users(id)')
		})

		it('strips bare references (no column spec) for FK-covered columns', () => {
			const sql = `CREATE TABLE t (
  user_id uuid references users,
  CONSTRAINT t_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);`
			const result = removeRedundantInlineRefs(sql)
			expect(result).not.toContain('references users')
			expect(result).toContain('user_id uuid')
		})

		it('returns unchanged DDL when no table-level FKs present', () => {
			const sql = 'CREATE TABLE t (id uuid PRIMARY KEY);'
			expect(removeRedundantInlineRefs(sql)).toBe(sql)
		})
	})

	describe('normalizeComments()', () => {
		it('flattens multi-line COMMENT ON TABLE to single-line', () => {
			const sql = `CREATE TABLE t (id uuid);\nCOMMENT ON TABLE t IS\n'line1\nline2';`
			const result = normalizeComments(sql)
			expect(result).toContain("'line1 line2'")
			expect(result).toContain('COMMENT ON TABLE t IS')
		})

		it('flattens multi-line COMMENT ON COLUMN to single-line', () => {
			const sql = `COMMENT ON COLUMN t.id IS\n'first line\nsecond line';`
			const result = normalizeComments(sql)
			expect(result).toContain("'first line second line'")
			expect(result).toContain('COMMENT ON COLUMN t.id IS')
		})

		it("converts SQL escaped apostrophes ('') to Unicode right single quotation mark", () => {
			const sql = `COMMENT ON TABLE t IS 'user''s table';`
			const result = normalizeComments(sql)
			expect(result).toContain("user\u2019s table")
			expect(result).not.toContain("''")
		})

		it('removes COMMENT ON FUNCTION statements', () => {
			const sql = `COMMENT ON FUNCTION foo IS 'A function';\nCREATE TABLE t (id uuid);`
			const result = normalizeComments(sql)
			expect(result).not.toContain('COMMENT ON FUNCTION')
			expect(result).toContain('CREATE TABLE')
		})

		it('preserves COMMENT ON TABLE and COMMENT ON COLUMN', () => {
			const sql = `CREATE TABLE t (id uuid);\nCOMMENT ON TABLE t IS 'A table';\nCOMMENT ON COLUMN t.id IS 'Primary key';`
			const result = normalizeComments(sql)
			expect(result).toContain("COMMENT ON TABLE t IS 'A table'")
			expect(result).toContain("COMMENT ON COLUMN t.id IS 'Primary key'")
		})
	})

	describe('cleanupDDLForDBML()', () => {
		it('removes index statements from DDL', () => {
			const sql = 'CREATE TABLE t (id int);\nCREATE INDEX idx ON t(id);'
			const result = cleanupDDLForDBML(sql)
			expect(result).not.toContain('CREATE INDEX')
			expect(result).toContain('CREATE TABLE')
		})

		it('preserves COMMENT ON TABLE/COLUMN but removes others', () => {
			const sql =
				"CREATE TABLE t (id int);\nCOMMENT ON TABLE t IS 'a table';\nCOMMENT ON FUNCTION f IS 'fn';"
			const result = cleanupDDLForDBML(sql)
			expect(result).toContain("COMMENT ON TABLE t IS 'a table'")
			expect(result).not.toContain('COMMENT ON FUNCTION')
			expect(result).toContain('CREATE TABLE')
		})

		it('returns null/empty for null/empty input', () => {
			expect(cleanupDDLForDBML(null)).toBeNull()
			expect(cleanupDDLForDBML('')).toBe('')
		})
	})
})

describe('Schema qualification', () => {
	describe('buildTableLookup()', () => {
		it('maps unqualified names to schema-qualified names', () => {
			const entities = [
				{ name: 'config.profiles', schema: 'config', type: 'table' },
				{ name: 'public.users', schema: 'public', type: 'table' },
				{ name: 'config.my_view', schema: 'config', type: 'view' }
			]
			const lookup = buildTableLookup(entities)
			expect(lookup).toEqual({
				profiles: 'config.profiles',
				users: 'public.users'
			})
		})

		it('first schema wins for duplicate short names', () => {
			const entities = [
				{ name: 'config.profiles', schema: 'config', type: 'table' },
				{ name: 'staging.profiles', schema: 'staging', type: 'table' }
			]
			const lookup = buildTableLookup(entities)
			expect(lookup.profiles).toBe('config.profiles')
		})
	})

	describe('qualifyTableNames()', () => {
		it('qualifies unqualified CREATE TABLE', () => {
			const sql = 'create table if not exists profiles (\n  id uuid\n);'
			const result = qualifyTableNames(sql, 'config')
			expect(result).toContain('config.profiles')
		})

		it('does not double-qualify already qualified tables', () => {
			const sql = 'create table if not exists config.profiles (\n  id uuid\n);'
			// Already has dot — regex won't match (dots excluded from name capture)
			const result = qualifyTableNames(sql, 'config')
			expect(result).toContain('config.profiles')
			expect(result).not.toContain('config.config.profiles')
		})

		it('qualifies FK references using table lookup', () => {
			const sql = ', model_id uuid not null references models(id)'
			const lookup = { models: 'config.models' }
			const result = qualifyTableNames(sql, 'public', lookup)
			expect(result).toContain('references config.models(')
		})

		it('falls back to entity schema when table not in lookup', () => {
			const sql = ', ref_id uuid references unknown_table(id)'
			const result = qualifyTableNames(sql, 'public', {})
			expect(result).toContain('references public.unknown_table(')
		})

		it('qualifies bare REFERENCES without column spec', () => {
			const sql = ', user_id uuid references users'
			const lookup = { users: 'auth.users' }
			const result = qualifyTableNames(sql, 'core', lookup)
			expect(result).toContain('references auth.users')
		})

		it('does not qualify column names that contain the word "references"', () => {
			const sql = ', preferences jsonb'
			const lookup = { preferences: 'core.preferences' }
			const result = qualifyTableNames(sql, 'core', lookup)
			expect(result).toBe(', preferences jsonb')
		})

		it('does not qualify already schema-qualified FK references', () => {
			const sql = ', profile_id uuid references config.profiles(id)'
			const lookup = { profiles: 'config.profiles' }
			const result = qualifyTableNames(sql, 'public', lookup)
			expect(result).toContain('references config.profiles(')
			expect(result).not.toContain('public.config')
		})

		it('returns unchanged for null/empty input', () => {
			expect(qualifyTableNames(null, 'config')).toBeNull()
			expect(qualifyTableNames('', 'config')).toBe('')
			expect(qualifyTableNames('some text', null)).toBe('some text')
		})
	})
})

describe('Table replacements', () => {
	describe('buildTableReplacements()', () => {
		it('builds replacements for tables with schemas', () => {
			const entities = [
				{ name: 'config.users', schema: 'config', type: 'table' },
				{ name: 'public.orders', schema: 'public', type: 'table' }
			]
			const replacements = buildTableReplacements(entities)
			expect(replacements).toHaveLength(2)
			expect(replacements[0]).toEqual({
				original: 'Table "users"',
				replacement: 'Table "config"."users" as "users"'
			})
			expect(replacements[1]).toEqual({
				original: 'Table "orders"',
				replacement: 'Table "public"."orders"'
			})
		})

		it('skips non-table entities', () => {
			const entities = [
				{ name: 'config.users', schema: 'config', type: 'table' },
				{ name: 'config.my_view', schema: 'config', type: 'view' }
			]
			const replacements = buildTableReplacements(entities)
			expect(replacements).toHaveLength(1)
		})

		it('returns empty array for no tables', () => {
			expect(buildTableReplacements([])).toEqual([])
		})
	})

	describe('applyTableReplacements()', () => {
		it('replaces table names in DBML output', () => {
			const dbml = 'Table "users" {\n  "id" int\n}\n'
			const replacements = [
				{ original: 'Table "users"', replacement: 'Table "config"."users" as "users"' }
			]
			const result = applyTableReplacements(dbml, replacements)
			expect(result).toContain('Table "config"."users" as "users"')
			expect(result).not.toContain('Table "users" {')
		})

		it('replaces all occurrences', () => {
			const dbml = 'Table "users" {\n}\nRef: Table "users"'
			const replacements = [{ original: 'Table "users"', replacement: 'Table "public"."users"' }]
			const result = applyTableReplacements(dbml, replacements)
			expect(result.match(/Table "public"\."users"/g)).toHaveLength(2)
		})

		it('returns unchanged DBML with empty replacements', () => {
			const dbml = 'Table "users" {\n}'
			expect(applyTableReplacements(dbml, [])).toBe(dbml)
		})
	})
})

describe('buildProjectBlock()', () => {
	it('generates a DBML Project block', () => {
		const block = buildProjectBlock('MyProject', 'PostgreSQL', 'A test project')
		expect(block).toContain('Project "MyProject"')
		expect(block).toContain("database_type: 'PostgreSQL'")
		expect(block).toContain('Note: "A test project"')
	})
})

describe('convertToDBML()', () => {
	it('converts SQL to DBML via @dbml/core', () => {
		const sql = `
			CREATE TABLE users (
				id uuid PRIMARY KEY,
				name varchar NOT NULL
			);
		`
		const result = convertToDBML(sql)
		expect(result).toContain('Table "users"')
		expect(result).toContain('"id" uuid [pk]')
		expect(result).toContain('"name" varchar [not null]')
	})

	it('converts schema-qualified tables', () => {
		const sql = `
			set search_path to config, extensions;
			CREATE TABLE config.features (
				id uuid PRIMARY KEY,
				title varchar
			);
		`
		const result = convertToDBML(sql)
		expect(result).toContain('Table "config"."features"')
	})
})

describe('generateDBML()', () => {
	const mockEntities = [
		{ name: 'public.users', schema: 'public', type: 'table', file: 'ddl/public/users.sql' },
		{ name: 'config.settings', schema: 'config', type: 'table', file: 'ddl/config/settings.sql' },
		{ name: 'staging.temp', schema: 'staging', type: 'table', file: 'ddl/staging/temp.sql' }
	]

	const mockDdlFromEntity = (entity) => {
		const ddls = {
			'public.users': 'CREATE TABLE public.users (id uuid PRIMARY KEY, name varchar NOT NULL);',
			'config.settings': 'CREATE TABLE config.settings (key varchar PRIMARY KEY, value text);',
			'staging.temp': 'CREATE TABLE staging.temp (data text);'
		}
		return ddls[entity.name] || ''
	}

	const mockFilterEntities = (entities, config) => {
		if (config.exclude && config.exclude.schemas) {
			return entities.filter((e) => !config.exclude.schemas.includes(e.schema))
		}
		if (config.include && config.include.schemas) {
			return entities.filter((e) => config.include.schemas.includes(e.schema))
		}
		return entities
	}

	it('generates DBML documents for named dbdocs configs', () => {
		const project = {
			name: 'TestProject',
			database: 'PostgreSQL',
			note: 'Test note',
			dbdocs: {
				base: { exclude: { schemas: ['staging'] } },
				core: { include: { schemas: ['config'] } }
			}
		}

		const results = generateDBML({
			entities: mockEntities,
			project,
			ddlFromEntity: mockDdlFromEntity,
			filterEntities: mockFilterEntities
		})

		expect(results).toHaveLength(2)
		expect(results[0].fileName).toBe('TestProject-base-design.dbml')
		expect(results[1].fileName).toBe('TestProject-core-design.dbml')

		// base excludes staging, should have users + settings
		expect(results[0].content).toContain('Project "TestProject-base"')
		expect(results[0].content).toContain('"users"')
		expect(results[0].content).toContain('"settings"')
		expect(results[0].content).not.toContain('"temp"')

		// core includes only config schema
		expect(results[1].content).toContain('Project "TestProject-core"')
		expect(results[1].content).toContain('"settings"')
	})

	it('handles top-level exclude/include in dbdocs config', () => {
		const project = {
			name: 'TestProject',
			database: 'PostgreSQL',
			note: 'Test note',
			dbdocs: {
				exclude: { schemas: ['staging'] }
			}
		}

		const results = generateDBML({
			entities: mockEntities,
			project,
			ddlFromEntity: mockDdlFromEntity,
			filterEntities: mockFilterEntities
		})

		expect(results).toHaveLength(1)
		expect(results[0].fileName).toBe('TestProject-design.dbml')
		expect(results[0].content).toContain('Project "TestProject"')
	})

	it('uses custom file name', () => {
		const project = {
			name: 'Test',
			database: 'PostgreSQL',
			note: '',
			dbdocs: {
				main: { exclude: { schemas: [] } }
			}
		}

		const results = generateDBML({
			entities: mockEntities,
			project,
			ddlFromEntity: mockDdlFromEntity,
			filterEntities: mockFilterEntities,
			file: 'schema.dbml'
		})

		expect(results[0].fileName).toBe('Test-main-schema.dbml')
	})

	it('applies schema qualification to table names', () => {
		const project = {
			name: 'Test',
			database: 'PostgreSQL',
			note: '',
			dbdocs: {
				include: { schemas: ['config'] }
			}
		}

		const results = generateDBML({
			entities: mockEntities,
			project,
			ddlFromEntity: mockDdlFromEntity,
			filterEntities: mockFilterEntities
		})

		// config.settings → Table "config"."settings" as "settings"
		expect(results[0].content).toContain('"config"."settings"')
	})

	it('returns error instead of throwing on invalid SQL', () => {
		const project = {
			name: 'Test',
			database: 'PostgreSQL',
			note: '',
			dbdocs: {
				main: { exclude: { schemas: [] } }
			}
		}

		const badDdl = () => 'THIS IS NOT VALID SQL AT ALL {'

		const results = generateDBML({
			entities: mockEntities,
			project,
			ddlFromEntity: badDdl,
			filterEntities: mockFilterEntities
		})

		expect(results).toHaveLength(1)
		expect(results[0].content).toBeNull()
		expect(results[0].error).toBeDefined()
		expect(results[0].fileName).toBe('Test-main-design.dbml')
	})
})
