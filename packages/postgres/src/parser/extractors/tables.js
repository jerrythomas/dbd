/**
 * Table extractor module
 * @module extractors/table
 */

import { pipe, filter, map, curry, prop, propEq, find, assoc } from "ramda";

/**
 * Extract all table definitions from an AST
 * @param {Array} ast - Parsed SQL AST
 * @returns {Array} Extracted table definitions
 */
export const extractTables = (ast) => {
  if (!ast || !Array.isArray(ast)) return [];

  // Find search_path if it exists
  const searchPath = extractSearchPath(ast);

  // Extract tables
  const tables = pipe(
    filter((stmt) => stmt.type === "create" && stmt.keyword === "table"),
    map(tableDefFromStatement(searchPath)),
  )(ast);

  // Process comments and link them to tables
  return processTableComments(tables, extractComments(ast));
};

/**
 * Extract search_path from AST statements
 * @param {Array} ast - Parsed SQL AST
 * @returns {string|null} Default schema from search_path or null
 */
export const extractSearchPath = (ast) => {
  const searchPathStmt = find(
    (stmt) => stmt.type === "set" && stmt.variable === "search_path",
    ast,
  );

  if (
    searchPathStmt &&
    searchPathStmt.value &&
    searchPathStmt.value.length > 0
  ) {
    return searchPathStmt.value[0];
  }

  return null;
};

/**
 * Extract all search_path schemas as an array
 * @param {Array} ast - Parsed SQL AST
 * @returns {string[]} Array of schemas from search_path, or ['public'] as default
 */
export const extractSearchPaths = (ast) => {
  const searchPathStmt = find(
    (stmt) => stmt.type === "set" && stmt.variable === "search_path",
    ast,
  );

  if (
    searchPathStmt &&
    searchPathStmt.value &&
    searchPathStmt.value.length > 0
  ) {
    return searchPathStmt.value;
  }

  return ["public"];
};

/**
 * Convert a create table statement to a structured table definition
 * @param {string|null} defaultSchema - Default schema from search_path
 * @param {Object} stmt - CREATE TABLE statement
 * @returns {Object} Structured table definition
 */
export const tableDefFromStatement = curry((defaultSchema, stmt) => {
  const tableName = extractTableName(stmt);
  const schema = extractTableSchema(stmt) || defaultSchema;

  return {
    name: tableName,
    schema: schema,
    ifNotExists: !!stmt.if_not_exists,
    columns: extractColumnsFromStatement(stmt),
    constraints: extractTableConstraints(stmt),
    comments: {
      table: null,
      columns: {},
    },
  };
});

/**
 * Extract table name from a CREATE TABLE statement
 * @param {Object} stmt - CREATE TABLE statement
 * @returns {string} Table name
 */
export const extractTableName = (stmt) => {
  if (stmt.table && Array.isArray(stmt.table) && stmt.table.length > 0) {
    return stmt.table[0].table;
  }
  // Handle schema qualified table names
  if (stmt.table && typeof stmt.table === "string") {
    const parts = stmt.table.split(".");
    return parts[parts.length - 1];
  }
  // Handle other cases
  if (stmt.table && stmt.table.table) {
    return stmt.table.table;
  }
  return "";
};

/**
 * Extract table schema from a CREATE TABLE statement
 * @param {Object} stmt - CREATE TABLE statement
 * @returns {string|null} Table schema or null
 */
export const extractTableSchema = (stmt) => {
  if (stmt.table && Array.isArray(stmt.table) && stmt.table.length > 0) {
    return stmt.table[0].db || stmt.table[0].schema;
  }
  // Handle schema qualified table names
  if (stmt.table && typeof stmt.table === "string") {
    const parts = stmt.table.split(".");
    return parts.length > 1 ? parts[0] : null;
  }
  // Handle other cases
  if (stmt.table && stmt.table.schema) {
    return stmt.table.schema;
  }
  if (stmt.table && stmt.table.db) {
    return stmt.table.db;
  }
  return null;
};

/**
 * Extract columns from a CREATE TABLE statement
 * @param {Object} stmt - CREATE TABLE statement
 * @returns {Array} Array of column definitions
 */
export const extractColumnsFromStatement = (stmt) => {
  if (!stmt.create_definitions || !Array.isArray(stmt.create_definitions)) {
    return [];
  }

  return stmt.create_definitions
    .filter((colDef) => colDef.column || colDef.ColumnDef)
    .map((colDef) => {
      const columnDef = colDef.ColumnDef || colDef;

      // Extract column name
      let columnName;
      if (columnDef.column?.column?.expr?.value) {
        columnName = columnDef.column.column.expr.value;
      } else if (columnDef.column?.column) {
        columnName = columnDef.column.column;
      } else {
        columnName = columnDef.colname;
      }

      return {
        name: columnName,
        dataType: extractDataType(columnDef),
        nullable: isNullable(columnDef),
        defaultValue: extractDefaultValue(columnDef),
        constraints: extractColumnConstraints(columnDef),
      };
    });
};

/**
 * Extract data type from column definition
 * @param {Object} columnDef - Column definition
 * @returns {string} Data type string
 */
export const extractDataType = (columnDef) => {
  const def = columnDef.definition || columnDef;
  if (!def) return null;

  const typeName =
    def.dataType || def.typeName?.names?.map((n) => n.String?.str).join(".");

  if (!typeName) return null;

  // Handle length/precision specification
  let typeWithSpec = typeName.toLowerCase(); // Convert to lowercase for consistency

  if (def.length) {
    // Handle both direct length value and object with value property
    const lengthValue =
      typeof def.length === "object" ? def.length.value : def.length;
    typeWithSpec += `(${lengthValue})`;
  } else if (def.typeName?.typmods && def.typeName.typmods.length > 0) {
    // Extract length/precision from typmods if available
    const typmods = def.typeName.typmods.map(
      (tm) => tm.A_Const?.val?.Integer?.ival,
    );
    if (typmods.filter((t) => t !== undefined).length > 0) {
      typeWithSpec += `(${typmods.join(", ")})`;
    }
  }

  return typeWithSpec;
};

/**
 * Check if column is nullable
 * @param {Object} columnDef - Column definition
 * @returns {boolean} True if column is nullable
 */
export const isNullable = (columnDef) => {
  // Check various ways nullability might be specified
  if (columnDef.nullable?.not) return false;

  // Handle direct "not null" property in the nullable field
  if (columnDef.nullable?.type === "not null") return false;
  if (columnDef.nullable?.value === "not null") return false;

  // Handle primary key columns - these are implicitly NOT NULL
  if (columnDef.primary_key) return false;

  if (columnDef.constraints) {
    for (const constraint of columnDef.constraints) {
      if (
        constraint.Constraint?.contype === "CONSTR_NOTNULL" ||
        constraint.type === "not null"
      ) {
        return false;
      }
    }
  }

  // Check if this column has any constraint that implies NOT NULL
  const hasPrimaryKeyConstraint = extractColumnConstraints(columnDef).some(
    (c) => c.type === "PRIMARY KEY",
  );
  if (hasPrimaryKeyConstraint) return false;

  return true; // Default to nullable
};

/**
 * Extract default value from column definition
 * @param {Object} columnDef - Column definition
 * @returns {string|null} Default value or null
 */
export const extractDefaultValue = (columnDef) => {
  if (!columnDef) return null;

  if (columnDef.default_val) {
    const defaultExpr = columnDef.default_val;

    if (typeof defaultExpr === "string") {
      return defaultExpr;
    }

    if (defaultExpr.type === "default") {
      if (typeof defaultExpr.value === "string") {
        return defaultExpr.value;
      }

      if (defaultExpr.value && defaultExpr.value.type === "function") {
        const func = defaultExpr.value;
        const name =
          func.name.name?.[0]?.value ||
          (Array.isArray(func.name.name)
            ? func.name.name.map((n) => n.value || n).join(".")
            : func.name);

        const args = func.args?.value || [];
        const argsStr = args
          .map((arg) => {
            if (typeof arg === "string") return arg;
            if (arg.value) return arg.value;
            return "";
          })
          .join(", ");

        return `${name}(${argsStr})`;
      }
    }
  }

  return null;
};

/**
 * Extract foreign key from reference definition
 * @param {Object} ref - Reference definition
 * @returns {Object} Foreign key constraint object
 */
const extractFKFromRefDef = (ref) => ({
  type: "FOREIGN KEY",
  table: ref.table[0].table,
  schema: ref.table[0].schema,
  column:
    ref.definition?.[0]?.column?.expr?.value ||
    ref.definition?.[0]?.column ||
    "id",
});

/**
 * Extract foreign key from constraint list
 * @param {Array} constraints - Constraint list
 * @returns {Object|null} Foreign key constraint object or null
 */
const extractFKFromConstraintList = (constraints) => {
  for (const constraint of constraints) {
    if (constraint.Constraint?.contype === "CONSTR_FOREIGN") {
      return {
        type: "FOREIGN KEY",
        table: constraint.Constraint.pktable.relname,
        schema: constraint.Constraint.pktable.schemaname,
        column: constraint.Constraint.pk_attrs?.[0]?.String?.str || "id",
      };
    }
  }
  return null;
};

/**
 * Extract column constraints from column definition
 * @param {Object} columnDef - Column definition
 * @returns {Array} Array of constraints
 */
export const extractColumnConstraints = (columnDef) => {
  const constraints = [];

  if (columnDef.primary_key) {
    constraints.push({ type: "PRIMARY KEY" });
  } else if (columnDef.constraints) {
    for (const constraint of columnDef.constraints) {
      if (
        constraint.Constraint?.contype === "CONSTR_PRIMARY" ||
        constraint.type === "primary key"
      ) {
        constraints.push({ type: "PRIMARY KEY" });
        break;
      }
    }
  }

  const normalizedFKs = (columnDef.constraints || []).filter(
    (c) => c.type === "FOREIGN KEY",
  );
  if (normalizedFKs.length > 0) {
    constraints.push(...normalizedFKs);
  } else if (columnDef.reference_definition) {
    constraints.push(extractFKFromRefDef(columnDef.reference_definition));
  } else if (columnDef.constraints) {
    const fk = extractFKFromConstraintList(columnDef.constraints);
    if (fk) constraints.push(fk);
  }

  return constraints;
};

/**
 * Extract table constraints from CREATE TABLE statement
 * @param {Object} stmt - CREATE TABLE statement
 * @returns {Array} Array of table constraints
 */
export const extractTableConstraints = (stmt) => {
  // TODO: Extract table-level constraints (not column constraints)
  return [];
};

/**
 * Resolve comment value from various AST expression formats
 * @param {*} expr - Expression to resolve value from
 * @returns {string|null} Resolved comment value
 */
const resolveCommentValue = (expr) => {
  if (expr.expr?.value) return expr.expr.value;
  if (typeof expr.value === "string") return expr.value;
  if (typeof expr === "string") return expr;
  return null;
};

/**
 * Resolve comment target (table name) from various AST formats
 * @param {string|Object} name - Target name to resolve
 * @returns {Object} Object with schemaName and tableName
 */
const resolveCommentTarget = (name) => {
  if (typeof name === "string") {
    const parts = name.split(".");
    return parts.length > 1
      ? { schemaName: parts[0], tableName: parts[1] }
      : { schemaName: null, tableName: parts[0] };
  }
  return {
    schemaName: name?.schema || name?.db || null,
    tableName: name?.table,
  };
};

/**
 * Resolve column target (table and column names) from various AST formats
 * @param {string|Object} name - Target name to resolve
 * @returns {Object} Object with schemaName, tableName, and columnName
 */
const resolveColumnTarget = (name) => {
  if (typeof name === "string") {
    const parts = name.split(".");
    if (parts.length === 3)
      return {
        schemaName: parts[0],
        tableName: parts[1],
        columnName: parts[2],
      };
    if (parts.length === 2)
      return { schemaName: null, tableName: parts[0], columnName: parts[1] };
    return { schemaName: null, tableName: null, columnName: parts[0] };
  }
  const columnName = name?.column?.expr?.value ?? name?.column;
  return {
    schemaName: name?.schema || name?.db || null,
    tableName: name?.table,
    columnName,
  };
};

/**
 * Process a table comment statement
 * @param {Object} stmt - Comment statement
 * @param {Object} comments - Comments accumulator object
 */
const processTableComment = (stmt, comments) => {
  const { schemaName, tableName } = resolveCommentTarget(stmt.target.name);
  const comment = resolveCommentValue(stmt.expr);
  const tableKey = schemaName ? `${schemaName}.${tableName}` : tableName;
  if (tableName && comment) comments.tables[tableKey] = comment;
};

/**
 * Process a column comment statement
 * @param {Object} stmt - Comment statement
 * @param {Object} comments - Comments accumulator object
 */
const processColumnComment = (stmt, comments) => {
  const { schemaName, tableName, columnName } = resolveColumnTarget(
    stmt.target.name,
  );
  const comment = resolveCommentValue(stmt.expr);
  const tableKey = schemaName ? `${schemaName}.${tableName}` : tableName;
  if (tableName && columnName && comment) {
    if (!comments.columns[tableKey]) comments.columns[tableKey] = {};
    comments.columns[tableKey][columnName] = comment;
  }
};

/**
 * Extract comment statements from AST
 * @param {Array} ast - Parsed SQL AST
 * @returns {Object} Object with table and column comments
 */
export const extractComments = (ast) => {
  const comments = { tables: {}, columns: {} };
  if (!ast || !Array.isArray(ast)) return comments;

  for (const stmt of ast) {
    if (
      stmt.type !== "comment" ||
      stmt.keyword !== "on" ||
      !stmt.target ||
      !stmt.expr
    )
      continue;
    if (stmt.target.type === "table") processTableComment(stmt, comments);
    else if (stmt.target.type === "column")
      processColumnComment(stmt, comments);
  }

  return comments;
};

/**
 * Process comments and associate them with tables
 * @param {Array} tables - Extracted tables
 * @param {Object} comments - Extracted comments
 * @returns {Array} Tables with associated comments
 */
export const processTableComments = (tables, comments) => {
  return tables.map((table) => {
    // Try both with and without schema qualification
    const tableKey = table.schema
      ? `${table.schema}.${table.name}`
      : table.name;

    const tableComments = {
      table: comments.tables[tableKey] || comments.tables[table.name] || null,
      columns: {},
    };

    // Add column comments - try both with and without schema qualification
    if (comments.columns[tableKey]) {
      tableComments.columns = comments.columns[tableKey];
    } else if (comments.columns[table.name]) {
      tableComments.columns = comments.columns[table.name];
    }

    const updatedTable = assoc("comments", tableComments, table);

    // Add comments directly to columns for easier access
    if (updatedTable.columns && updatedTable.columns.length > 0) {
      updatedTable.columns = updatedTable.columns.map((column) => {
        if (tableComments.columns[column.name]) {
          return assoc("comment", tableComments.columns[column.name], column);
        }
        return column;
      });
    }

    return updatedTable;
  });
};
