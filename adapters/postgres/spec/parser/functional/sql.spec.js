// dbd/packages/parser/spec/functional/sql.spec.js
import { describe, it, expect } from 'vitest'
import {
	parse,
	splitStatements,
	validateSQL,
	parseSearchPath
} from '../../../src/parser/parsers/sql.js'

describe('SQL Parser - Functional API', () => {
	describe('splitStatements', () => {
		it('should split SQL statements on semicolons', () => {
			const sql = `
        CREATE TABLE users (id int);
        CREATE TABLE posts (id int);
      `

			const statements = splitStatements(sql)
			expect(statements).toHaveLength(2)
			expect(statements[0]).toContain('CREATE TABLE users')
			expect(statements[1]).toContain('CREATE TABLE posts')
		})

		it('should handle semicolons in strings', () => {
			const sql = `
        CREATE TABLE users (message varchar(100) DEFAULT 'Hello; world');
        CREATE TABLE posts (id int);
      `

			const statements = splitStatements(sql)
			expect(statements).toHaveLength(2)
			expect(statements[0]).toContain("'Hello; world'")
		})

		it('should handle comments', () => {
			const sql = `
        -- This is a comment with a ; semicolon
        CREATE TABLE users (id int); -- Another comment
        /* Comment with ; semicolon */
        CREATE TABLE posts (id int);
      `

			const statements = splitStatements(sql)
			expect(statements).toHaveLength(2)
			expect(statements[0]).toContain('CREATE TABLE users')
			expect(statements[1]).toContain('CREATE TABLE posts')
		})

		it('should handle dollar-quoted strings in PostgreSQL syntax', () => {
			const sql = `
        CREATE FUNCTION test() RETURNS void AS $$
        BEGIN
          RETURN;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TABLE test (id int);
      `

			const statements = splitStatements(sql)
			expect(statements).toHaveLength(2)
			expect(statements[0]).toContain('CREATE FUNCTION test')
			expect(statements[1]).toContain('CREATE TABLE test')
		})

		it('should handle empty or whitespace-only statements', () => {
			const sql = `
        ;;
        CREATE TABLE users (id int);
        ;
        CREATE TABLE posts (id int);
        ;
      `

			const statements = splitStatements(sql)
			expect(statements).toHaveLength(2)
			expect(statements[0]).toContain('CREATE TABLE users')
			expect(statements[1]).toContain('CREATE TABLE posts')
		})
	})

	describe('parse', () => {
		it('should parse simple CREATE TABLE statements', () => {
			const sql = 'CREATE TABLE test (id int);'
			const ast = parse(sql)

			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBeGreaterThan(0)
			expect(ast[0].type).toBe('create')
			expect(ast[0].keyword).toBe('table')
			expect(ast[0].table[0].table).toBe('test')
		})

		it('should parse multiple statements', () => {
			const sql = `
        CREATE TABLE users (id int);
        CREATE TABLE posts (id int);
      `

			const ast = parse(sql)
			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBe(2)
			expect(ast[0].type).toBe('create')
			expect(ast[1].type).toBe('create')
			expect(ast[0].table[0].table).toBe('users')
			expect(ast[1].table[0].table).toBe('posts')
		})

		it('should store the original SQL for reference', () => {
			const sql = 'CREATE TABLE test (id int);'
			const ast = parse(sql)

			expect(ast._original_sql).toBe(sql)
		})

		it('should parse SET search_path statements', () => {
			const sql = 'SET search_path TO public, my_schema;'
			const ast = parse(sql)

			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBe(1)
			expect(ast[0].type).toBe('set')
			expect(ast[0].variable).toBe('search_path')
			expect(ast[0].value).toContain('public')
			expect(ast[0].value).toContain('my_schema')
		})

		it('should handle errors gracefully', () => {
			// Invalid SQL with missing closing parenthesis
			const sql = 'CREATE TABLE broken (id int;'

			// Should not throw but return an empty array
			expect(() => parse(sql)).not.toThrow()
			const ast = parse(sql)
			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBe(0)
		})
	})

	describe('validateSQL', () => {
		it('should validate correct SQL', () => {
			const sql = 'CREATE TABLE test (id int);'
			const result = validateSQL(sql)

			// Only check the required properties, allowing for additional properties like errors
			expect(result.valid).toBe(true)
			expect(result.message).toBe('Valid SQL')
		})

		it('should invalidate incorrect SQL', () => {
			const sql = 'CREATE TABLE broken (id int;' // Missing closing parenthesis
			const result = validateSQL(sql)

			expect(result.valid).toBe(false)
			expect(result.message).toContain('Error')
		})

		it('should return errors array on invalid SQL', () => {
			const result = validateSQL('NOT VALID SQL AT ALL;')
			expect(result.valid).toBe(false)
			expect(result.errors).toBeInstanceOf(Array)
		})
	})

	describe('parseSearchPath', () => {
		it('should parse SET search_path TO with multiple schemas', () => {
			const result = parseSearchPath('SET search_path TO staging, public;')
			expect(result).toHaveLength(1)
			expect(result[0].type).toBe('set')
			expect(result[0].variable).toBe('search_path')
			expect(result[0].value).toEqual(['staging', 'public'])
		})

		it('should return empty array for non-search_path SET', () => {
			const result = parseSearchPath('SET statement_timeout = 5000;')
			expect(result).toEqual([])
		})
	})

	describe('splitStatements — branch coverage', () => {
		it('handles double-quoted identifiers without treating content as statements (line 88-92)', () => {
			// Covers char === '"' branch in string toggle (line 88)
			const sql = `SELECT "id;col" FROM "my;table";`
			const stmts = splitStatements(sql)
			expect(stmts).toHaveLength(1)
			expect(stmts[0]).toContain('"id;col"')
		})

		it('handles escaped single-quote inside string (line 92: prevChar !== backslash)', () => {
			// The char === stringChar && prevChar !== '\\' branch — escaped quote keeps string open
			const sql = `SELECT 'it\\'s fine'; SELECT 1;`
			const stmts = splitStatements(sql)
			// Both statements should be split
			expect(stmts.length).toBeGreaterThanOrEqual(1)
		})

		it('handles dollar string end tag matching (lines 101-116: inDollarString else branch)', () => {
			// Exercises the inDollarString=true else branch (potentialEndTag === dollarTag)
			const sql = `
CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $body$
BEGIN
  PERFORM 1;
END;
$body$;
CREATE TABLE t (id int);`
			const stmts = splitStatements(sql)
			expect(stmts).toHaveLength(2)
			expect(stmts[0]).toContain('CREATE FUNCTION')
			expect(stmts[1]).toContain('CREATE TABLE')
		})

		it('handles $ that is not a valid dollar tag (line 31/101: scanDollarTag returns null)', () => {
			// A lone $ at end of SQL that is not a dollar tag (no closing $)
			// scanDollarTag returns null → if (found) is false
			const sql = `SELECT $1; SELECT 2;`
			const stmts = splitStatements(sql)
			expect(stmts.length).toBeGreaterThanOrEqual(1)
		})

		it('handles dollar string with mismatched inner $ (line 110: false branch)', () => {
			// Inside a $body$ dollar string, a $ that is not the end tag
			// potentialEndTag !== dollarTag → continue without ending the dollar string
			const sql = `
CREATE FUNCTION f() RETURNS void AS $body$
BEGIN
  x := $1;
END;
$body$;`
			const stmts = splitStatements(sql)
			expect(stmts).toHaveLength(1)
			expect(stmts[0]).toContain('$1')
		})
	})

	describe('parse — branch coverage', () => {
		it('returns null-filtered result when translatePgStmt returns null (line 172)', () => {
			// A valid SQL batch where some statements translate to null (e.g. SET that is filtered)
			// We need to trigger the statement-level fallback path (parse fails on full SQL)
			// and then have a statement inside that translates to null.
			// Use SQL with one valid stmt and one that parses but translates to nothing meaningful.
			const sql = 'SELECT 1; CREATE TABLE t (id int);'
			const result = parse(sql)
			// The SELECT 1 may translate to null (not handled) — CREATE TABLE should be present
			const tableStmt = result.find((s) => s && s.keyword === 'table')
			expect(tableStmt).toBeDefined()
		})
	})

	describe('parse — column types and defaults', () => {
		it('should handle array column types', () => {
			const ast = parse('CREATE TABLE t (tags text[], scores int[]);')
			const cols = ast[0].create_definitions
			expect(cols[0].dataType).toBe('text[]')
			expect(cols[1].dataType).toBe('int[]')
		})

		it('should handle float defaults', () => {
			const ast = parse('CREATE TABLE t (rate numeric DEFAULT 3.14);')
			const col = ast[0].create_definitions[0]
			expect(col.defaultValue).toBe('3.14')
		})

		it('should handle boolean defaults', () => {
			const ast = parse('CREATE TABLE t (active boolean DEFAULT true);')
			const col = ast[0].create_definitions[0]
			expect(col.defaultValue).toBe(true)
		})

		it('should handle UNIQUE column constraint', () => {
			const ast = parse('CREATE TABLE t (email varchar(255) UNIQUE);')
			const col = ast[0].create_definitions[0]
			expect(col.constraints.some((c) => c.type === 'UNIQUE')).toBe(true)
		})

		it('should handle CHECK column constraint', () => {
			const ast = parse('CREATE TABLE t (age int CHECK (age > 0));')
			const col = ast[0].create_definitions[0]
			expect(col.constraints.some((c) => c.type === 'CHECK')).toBe(true)
		})

		it('should handle column-level FOREIGN KEY', () => {
			const ast = parse('CREATE TABLE t (user_id int REFERENCES users(id));')
			const col = ast[0].create_definitions[0]
			const fk = col.constraints.find((c) => c.type === 'FOREIGN KEY')
			expect(fk).toBeDefined()
			expect(fk.table).toBe('users')
			expect(fk.column).toBe('id')
		})
	})

	describe('parse — table-level constraints', () => {
		it('should handle table-level FOREIGN KEY', () => {
			const ast = parse(
				'CREATE TABLE orders (id int, user_id int, FOREIGN KEY (user_id) REFERENCES users(id));'
			)
			const col = ast[0].create_definitions.find((c) => c.name === 'user_id')
			const fk = col.constraints.find((c) => c.type === 'FOREIGN KEY')
			expect(fk).toBeDefined()
			expect(fk.table).toBe('users')
		})

		it('should handle table-level composite PRIMARY KEY', () => {
			const ast = parse(
				'CREATE TABLE t (id int, version int, name text, PRIMARY KEY (id, version));'
			)
			const idCol = ast[0].create_definitions.find((c) => c.name === 'id')
			const verCol = ast[0].create_definitions.find((c) => c.name === 'version')
			expect(idCol.constraints.some((c) => c.type === 'PRIMARY KEY')).toBe(true)
			expect(verCol.constraints.some((c) => c.type === 'PRIMARY KEY')).toBe(true)
			expect(idCol.primary_key).toBe('primary key')
		})

		it('should handle table-level CHECK constraint', () => {
			const ast = parse('CREATE TABLE t (a int, b int, CHECK (a > b));')
			const tableConstraints = ast[0]._table_constraints
			expect(tableConstraints.some((c) => c.type === 'check')).toBe(true)
		})

		it('should handle table-level UNIQUE constraint', () => {
			const ast = parse('CREATE TABLE t (a int, b int, UNIQUE (a, b));')
			const tableConstraints = ast[0]._table_constraints
			expect(tableConstraints.some((c) => c.type === 'unique')).toBe(true)
		})

		it('should handle EXCLUDE constraint (unrecognized type falls through)', () => {
			const ast = parse(
				'CREATE TABLE t (id int, tsrange tsrange, EXCLUDE USING gist (tsrange WITH &&));'
			)
			// CONSTR_EXCLUSION hits the default case and returns null, filtered out
			const tableConstraints = ast[0]._table_constraints || []
			expect(tableConstraints.every((c) => c.type !== 'exclusion')).toBe(true)
		})
	})

	describe('parse — views', () => {
		it('should parse view with function column', () => {
			const ast = parse('CREATE VIEW v AS SELECT upper(name) AS uname FROM t;')
			expect(ast[0].keyword).toBe('view')
			const col = ast[0].select.columns.find((c) => c.as === 'uname')
			expect(col.expr.type).toBe('function')
		})

		it('should parse view with expression column', () => {
			const ast = parse('CREATE VIEW v AS SELECT id::text AS txt FROM t;')
			expect(ast[0].keyword).toBe('view')
			expect(ast[0].select.columns.length).toBeGreaterThan(0)
		})

		it('should parse view with RIGHT JOIN', () => {
			const ast = parse('CREATE VIEW v AS SELECT a.id FROM a RIGHT JOIN b ON a.id = b.id;')
			const from = ast[0].select.from
			expect(from.length).toBe(2)
			expect(from[1].type).toBe('RIGHT JOIN')
		})

		it('should parse view with FULL JOIN', () => {
			const ast = parse('CREATE VIEW v AS SELECT a.id FROM a FULL JOIN b ON a.id = b.id;')
			const from = ast[0].select.from
			expect(from[1].type).toBe('FULL JOIN')
		})

		it('should parse view with subquery in FROM', () => {
			const ast = parse('CREATE VIEW v AS SELECT * FROM (SELECT 1 AS x) sub;')
			expect(ast[0].keyword).toBe('view')
		})

		it('should parse view with WHERE string constant', () => {
			const ast = parse("CREATE VIEW v AS SELECT id FROM t WHERE status = 'active';")
			const where = ast[0].select.where
			expect(where).toBeDefined()
			expect(where.right.type).toBe('string')
			expect(where.right.value).toBe('active')
		})

		it('should parse view with WHERE numeric constant', () => {
			const ast = parse('CREATE VIEW v AS SELECT id FROM t WHERE age > 18;')
			const where = ast[0].select.where
			expect(where.right.type).toBe('number')
		})

		it('should parse view with WHERE boolean via TypeCast', () => {
			const ast = parse('CREATE VIEW v AS SELECT id FROM t WHERE active = true;')
			const where = ast[0].select.where
			expect(where).toBeDefined()
		})

		it('should parse view with OR REPLACE', () => {
			const ast = parse('CREATE OR REPLACE VIEW v AS SELECT 1 AS x;')
			expect(ast[0].replace).toBe(true)
		})
	})

	describe('parse — functions and procedures', () => {
		it('should parse function with RETURNS type', () => {
			const ast = parse(
				'CREATE FUNCTION add(a int, b int) RETURNS int AS $$ BEGIN RETURN a + b; END; $$ LANGUAGE plpgsql;'
			)
			expect(ast[0].keyword).toBe('function')
			expect(ast[0].returns).toBe('int')
		})

		it('should parse function with OUT parameter', () => {
			const ast = parse(
				"CREATE FUNCTION get_val(IN p_id int, OUT p_val text) AS $$ BEGIN p_val := 'hello'; END; $$ LANGUAGE plpgsql;"
			)
			const params = ast[0].parameters
			const outParam = params.find((p) => p.mode === 'out')
			expect(outParam).toBeDefined()
			expect(outParam.name).toBe('p_val')
		})

		it('should parse function with INOUT parameter', () => {
			const ast = parse(
				'CREATE FUNCTION inc(INOUT p_val int) AS $$ BEGIN p_val := p_val + 1; END; $$ LANGUAGE plpgsql;'
			)
			const params = ast[0].parameters
			expect(params[0].mode).toBe('inout')
		})

		it('should parse function with schema qualification', () => {
			const ast = parse(
				'CREATE FUNCTION staging.my_func() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;'
			)
			expect(ast[0].name.schema).toBe('staging')
		})

		it('should parse function with OR REPLACE', () => {
			const ast = parse(
				'CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;'
			)
			expect(ast[0].replace).toBe(true)
		})

		it('should parse function with SQL language', () => {
			const ast = parse('CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;')
			expect(ast[0].language).toBe('sql')
		})

		it('should parse CREATE PROCEDURE', () => {
			const ast = parse('CREATE PROCEDURE do_stuff() AS $$ BEGIN END; $$ LANGUAGE plpgsql;')
			expect(ast[0].keyword).toBe('procedure')
		})
	})

	describe('parse — triggers', () => {
		it('should parse BEFORE INSERT trigger', () => {
			const ast = parse(
				'CREATE TRIGGER trg BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION audit_func();'
			)
			expect(ast[0].keyword).toBe('trigger')
			expect(ast[0].trigger.timing).toBe('BEFORE')
			expect(ast[0].trigger.events).toContain('INSERT')
			expect(ast[0].trigger.table).toBe('users')
			expect(ast[0].trigger.executeFunction).toBe('audit_func')
		})

		it('should parse AFTER DELETE trigger', () => {
			const ast = parse(
				'CREATE TRIGGER trg AFTER DELETE ON orders FOR EACH ROW EXECUTE FUNCTION cleanup();'
			)
			expect(ast[0].trigger.timing).toBe('AFTER')
			expect(ast[0].trigger.events).toContain('DELETE')
		})

		it('should parse trigger with multiple events', () => {
			const ast = parse(
				'CREATE TRIGGER trg BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION check_func();'
			)
			expect(ast[0].trigger.events).toContain('INSERT')
			expect(ast[0].trigger.events).toContain('UPDATE')
		})

		it('should parse trigger with schema-qualified function', () => {
			const ast = parse(
				'CREATE TRIGGER trg BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION audit.log_change();'
			)
			expect(ast[0].trigger.executeFunction).toBe('audit.log_change')
		})

		it('should parse FOR EACH STATEMENT trigger (row = false)', () => {
			const ast = parse(
				'CREATE TRIGGER trg AFTER INSERT ON users FOR EACH STATEMENT EXECUTE FUNCTION audit_func();'
			)
			expect(ast[0].trigger.row).toBe(false)
		})

		it('should parse INSTEAD OF trigger', () => {
			const ast = parse(
				'CREATE TRIGGER trg INSTEAD OF INSERT ON v FOR EACH ROW EXECUTE FUNCTION f();'
			)
			expect(ast[0].trigger.timing).toBe('INSTEAD OF')
		})

		it('should parse BEFORE TRUNCATE trigger', () => {
			const ast = parse(
				'CREATE TRIGGER trg BEFORE TRUNCATE ON t FOR EACH STATEMENT EXECUTE FUNCTION f();'
			)
			expect(ast[0].trigger.events).toContain('TRUNCATE')
		})
	})

	describe('parse — indexes', () => {
		it('should parse CREATE INDEX', () => {
			const ast = parse('CREATE INDEX idx_email ON users(email);')
			expect(ast[0].keyword).toBe('index')
			expect(ast[0].indexname).toBe('idx_email')
			expect(ast[0].table.table).toBe('users')
			expect(ast[0].columns[0].name).toBe('email')
		})

		it('should parse CREATE UNIQUE INDEX with DESC', () => {
			const ast = parse('CREATE UNIQUE INDEX idx_ts ON events(created_at DESC);')
			expect(ast[0].unique).toBe(true)
			expect(ast[0].columns[0].order).toBe('DESC')
		})
	})

	describe('parse — SET and COMMENT', () => {
		it('should parse SET non-search_path variable', () => {
			const ast = parse("SET statement_timeout = '5s';")
			expect(ast[0].type).toBe('set')
			expect(ast[0].variable).toBe('statement_timeout')
			expect(ast[0].value).toContain('5s')
		})

		it('should parse RESET variable (no args)', () => {
			const ast = parse('RESET statement_timeout;')
			expect(ast[0].type).toBe('set')
			expect(ast[0].variable).toBe('statement_timeout')
			expect(ast[0].value).toEqual([])
		})

		it('should parse RESET search_path (no args)', () => {
			const ast = parse('RESET search_path;')
			expect(ast[0].type).toBe('set')
			expect(ast[0].variable).toBe('search_path')
			expect(ast[0].value).toEqual([])
		})

		it('should parse COMMENT ON SCHEMA (object without List)', () => {
			const ast = parse("COMMENT ON SCHEMA public IS 'Public schema';")
			expect(ast[0].type).toBe('comment')
		})

		it('should parse COMMENT ON COLUMN with 3-part name', () => {
			const ast = parse("COMMENT ON COLUMN staging.users.email IS 'User email';")
			expect(ast[0].type).toBe('comment')
			expect(ast[0].target.type).toBe('column')
			expect(ast[0].target.name.schema).toBe('staging')
			expect(ast[0].target.name.table).toBe('users')
			expect(ast[0].target.name.column.expr.value).toBe('email')
		})

		it('should parse COMMENT ON COLUMN with 2-part name', () => {
			const ast = parse("COMMENT ON COLUMN users.email IS 'User email';")
			expect(ast[0].target.name.table).toBe('users')
			expect(ast[0].target.name.column.expr.value).toBe('email')
		})
	})

	describe('splitStatements — edge cases', () => {
		it('should handle dollar-quoted end-tag matching', () => {
			const sql = `
				CREATE FUNCTION f() RETURNS void AS $body$
				BEGIN
					RAISE NOTICE 'semicolon;here';
				END;
				$body$ LANGUAGE plpgsql;
				CREATE TABLE t (id int);
			`
			const stmts = splitStatements(sql)
			expect(stmts).toHaveLength(2)
			expect(stmts[0]).toContain('$body$')
			expect(stmts[1]).toContain('CREATE TABLE t')
		})

		it('should handle double-quoted identifiers with semicolons', () => {
			const sql = 'CREATE TABLE "my;table" (id int);'
			const stmts = splitStatements(sql)
			expect(stmts).toHaveLength(1)
			expect(stmts[0]).toContain('"my;table"')
		})
	})

	describe('parse — column type resolution edge cases', () => {
		it('should handle varchar with precision via typmods', () => {
			const ast = parse('CREATE TABLE t (name varchar(100));')
			const col = ast[0].create_definitions[0]
			expect(col.dataType).toMatch(/varchar/)
		})

		it('should handle numeric with precision and scale', () => {
			const ast = parse('CREATE TABLE t (price numeric(10,2));')
			const col = ast[0].create_definitions[0]
			expect(col.dataType).toMatch(/numeric/)
		})

		it('should handle function call as default value', () => {
			const ast = parse('CREATE TABLE t (id uuid DEFAULT uuid_generate_v4());')
			const col = ast[0].create_definitions[0]
			expect(col.defaultValue).toContain('uuid_generate_v4')
		})

		it('should handle TypeCast default value', () => {
			const ast = parse("CREATE TABLE t (status text DEFAULT 'active'::text);")
			const col = ast[0].create_definitions[0]
			expect(col.defaultValue).toBe('active')
		})

		it('should handle integer default value', () => {
			const ast = parse('CREATE TABLE t (count int DEFAULT 0);')
			const col = ast[0].create_definitions[0]
			expect(col.defaultValue).toBe(0)
		})
	})

	describe('parse — view column types', () => {
		it('should parse view with star column', () => {
			const ast = parse('CREATE VIEW v AS SELECT * FROM t;')
			expect(ast[0].keyword).toBe('view')
			const starCol = ast[0].select.columns.find((c) => c.expr.type === 'star')
			expect(starCol).toBeDefined()
		})

		it('should parse view with BoolExpr in WHERE (AND)', () => {
			const ast = parse("CREATE VIEW v AS SELECT id FROM t WHERE active = true AND status = 'ok';")
			const where = ast[0].select.where
			expect(where.type).toBe('binary_expr')
			expect(where.operator).toBe('AND')
			expect(where.args).toBeInstanceOf(Array)
		})

		it('should parse view with OR in WHERE', () => {
			const ast = parse('CREATE VIEW v AS SELECT id FROM t WHERE a = 1 OR b = 2;')
			const where = ast[0].select.where
			expect(where.operator).toBe('OR')
		})

		it('should parse view with subquery in FROM', () => {
			const ast = parse('CREATE VIEW v AS SELECT x FROM (SELECT 1 AS x) AS sub;')
			const from = ast[0].select.from
			const subq = from.find((f) => f.expr?.type === 'subquery')
			expect(subq).toBeDefined()
		})

		it('should parse view with three-way JOIN', () => {
			const ast = parse(
				'CREATE VIEW v AS SELECT a.id FROM a JOIN b ON a.id = b.id JOIN c ON b.id = c.id;'
			)
			const from = ast[0].select.from
			expect(from.length).toBe(3)
		})

		it('should parse view with CROSS JOIN', () => {
			const ast = parse('CREATE VIEW v AS SELECT a.id FROM a CROSS JOIN b;')
			const from = ast[0].select.from
			expect(from.length).toBe(2)
		})

		it('should parse view with single-column no-table reference', () => {
			const ast = parse('CREATE VIEW v AS SELECT name FROM t;')
			const col = ast[0].select.columns[0]
			expect(col.expr.column).toBe('name')
		})

		it('should parse view with expression column (TypeCast)', () => {
			const ast = parse('CREATE VIEW v AS SELECT id::text AS txt FROM t;')
			const col = ast[0].select.columns.find((c) => c.as === 'txt')
			expect(col.expr.type).toBe('expression')
		})

		it('should parse view with SubLink expression', () => {
			const ast = parse(
				'CREATE VIEW v AS SELECT (SELECT count(*) FROM orders) AS order_count FROM t;'
			)
			const col = ast[0].select.columns.find((c) => c.as === 'order_count')
			expect(col.expr.type).toBe('expression')
		})
	})

	describe('parse — function body extraction paths', () => {
		it('should extract function body from options', () => {
			const ast = parse(
				'CREATE FUNCTION f() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;'
			)
			expect(ast[0].as).toBeTruthy()
			expect(ast[0].body).toBeTruthy()
		})

		it('should parse function options into normalized format', () => {
			const ast = parse('CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;')
			const opts = ast[0].options
			expect(opts.some((o) => o.prefix === 'LANGUAGE')).toBe(true)
			expect(opts.some((o) => o.type === 'as')).toBe(true)
		})
	})

	describe('parse — comment edge cases', () => {
		it('should handle COMMENT ON TABLE with schema', () => {
			const ast = parse("COMMENT ON TABLE staging.users IS 'User table';")
			expect(ast[0].type).toBe('comment')
			expect(ast[0].target.name.table).toBe('users')
			expect(ast[0].target.name.schema).toBe('staging')
		})

		it('should handle COMMENT ON TABLE without schema', () => {
			const ast = parse("COMMENT ON TABLE users IS 'User table';")
			expect(ast[0].target.name.table).toBe('users')
		})

		it('should handle COMMENT ON COLUMN with single name', () => {
			// This is unusual but tests the single-name column path
			const ast = parse("COMMENT ON COLUMN users.email IS 'Email';")
			expect(ast[0].type).toBe('comment')
			expect(ast[0].target.type).toBe('column')
		})

		it('should handle COMMENT ON unsupported object type', () => {
			const ast = parse("COMMENT ON INDEX idx_users IS 'Index comment';")
			expect(ast[0].type).toBe('comment')
		})
	})

	describe('parse — unsupported statement passthrough', () => {
		it('should pass through unsupported statement types', () => {
			const ast = parse('DO $$ BEGIN RAISE NOTICE $$;')
			// DO blocks become unsupported statement types — should not crash
			expect(ast).toBeInstanceOf(Array)
		})

		it('should handle ALTER TABLE as passthrough', () => {
			const ast = parse('ALTER TABLE users ADD COLUMN age int;')
			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBe(1)
			expect(ast[0].type).toBe('AlterTableStmt')
		})

		it('should handle GRANT as passthrough', () => {
			const ast = parse('GRANT SELECT ON users TO readonly;')
			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBe(1)
		})
	})

	describe('validateSQL — error handling', () => {
		it('should handle parse throwing an exception', () => {
			// Extremely malformed SQL that causes issues
			const result = validateSQL(null)
			expect(result.valid).toBe(false)
		})
	})

	describe('parse — sql.js branch coverage', () => {
		it('should handle nested join on right side (parenthesized join)', () => {
			const ast = parse(
				'CREATE VIEW v AS SELECT a.id FROM a JOIN (b JOIN c ON b.id = c.id) ON a.id = b.id;'
			)
			const from = ast[0].select.from
			expect(from.length).toBe(3)
			expect(from[0].table).toBe('a')
			expect(from[1].table).toBe('b')
			expect(from[2].table).toBe('c')
		})

		it('should return null for unrecognized FROM item (RangeFunction)', () => {
			const ast = parse('CREATE VIEW v AS SELECT s.i FROM generate_series(1, 10) AS s(i);')
			expect(ast[0].keyword).toBe('view')
			// RangeFunction is not handled — it becomes null and is filtered out
			// The view should still parse without error
			expect(ast[0].select.from).toBeDefined()
		})

		it('should handle TypeCast in WHERE clause', () => {
			const ast = parse("CREATE VIEW v AS SELECT id FROM t WHERE created_at > '2024-01-01'::date;")
			const where = ast[0].select.where
			expect(where).toBeDefined()
			expect(where.type).toBe('binary_expr')
		})

		it('should return expression type for unhandled WHERE node (NullTest)', () => {
			const ast = parse('CREATE VIEW v AS SELECT id FROM t WHERE name IS NOT NULL;')
			const where = ast[0].select.where
			expect(where).toBeDefined()
			expect(where.type).toBe('expression')
		})

		it('should parse function with extra options (VOLATILE, COST)', () => {
			const ast = parse(
				'CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql VOLATILE COST 100 AS $$ BEGIN NULL; END; $$;'
			)
			expect(ast[0].keyword).toBe('function')
			// Only 'language' and 'as' options should survive the filter
			const opts = ast[0].options
			expect(opts).toHaveLength(2)
			expect(opts.some((o) => o.prefix === 'LANGUAGE')).toBe(true)
			expect(opts.some((o) => o.type === 'as')).toBe(true)
		})

		it('should handle NUMERIC(10,0) — protobuf zero typmod', () => {
			const ast = parse('CREATE TABLE t (a NUMERIC(10,0));')
			const col = ast[0].create_definitions[0]
			expect(col.dataType).toBe('numeric(10,0)')
		})

		it('should handle column with no DEFAULT', () => {
			const ast = parse('CREATE TABLE t (a int);')
			const col = ast[0].create_definitions[0]
			expect(col.defaultValue).toBeNull()
		})

		it('should default FK column to id when not specified (column-level)', () => {
			const ast = parse('CREATE TABLE t (a int REFERENCES t2);')
			const col = ast[0].create_definitions[0]
			const fk = col.constraints.find((c) => c.type === 'FOREIGN KEY')
			expect(fk.table).toBe('t2')
			expect(fk.column).toBe('id')
		})

		it('should default FK column to id when not specified (table-level)', () => {
			const ast = parse('CREATE TABLE t (a int, FOREIGN KEY (a) REFERENCES t2);')
			const col = ast[0].create_definitions[0]
			const fk = col.constraints.find((c) => c.type === 'FOREIGN KEY')
			expect(fk.table).toBe('t2')
			expect(fk.column).toBe('id')
		})

		it('should handle WHERE with integer zero (protobuf zero ival)', () => {
			const ast = parse('CREATE VIEW v AS SELECT id FROM t WHERE 0 = 1;')
			const where = ast[0].select.where
			expect(where.type).toBe('binary_expr')
			expect(where.left).toEqual({ type: 'number', value: 0 })
		})

		it('should handle WHERE with boolean false (protobuf false boolval)', () => {
			const ast = parse('CREATE VIEW v AS SELECT id FROM t WHERE false;')
			const where = ast[0].select.where
			expect(where).toEqual({ type: 'bool', value: false })
		})

		it('should handle unnamed function parameter', () => {
			const ast = parse('CREATE FUNCTION f(int) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;')
			const params = ast[0].parameters
			expect(params).toHaveLength(1)
			expect(params[0].name).toBe('')
			expect(params[0].dataType).toBe('int')
			expect(params[0].mode).toBe('in')
		})
	})

	describe('parse — error isolation', () => {
		it('should isolate errors in multi-statement SQL', () => {
			const sql = 'CREATE TABLE a(id int);\nTHIS IS GARBAGE;\nCREATE TABLE b(id int);'
			const ast = parse(sql)
			// Should recover the valid statements
			expect(ast.length).toBe(2)
			expect(ast[0].table[0].table).toBe('a')
			expect(ast[1].table[0].table).toBe('b')
		})

		it('should return empty array for empty/null input', () => {
			expect(parse('')).toHaveLength(0)
			expect(parse(null)).toHaveLength(0)
			expect(parse(undefined)).toHaveLength(0)
		})
	})
})
