// dbd/packages/parser/src/index.js
import { SQLParser, validateDDL } from './parser-utils.js';

/**
 * Parse SQL DDL and extract metadata
 * 
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options
 * @param {string} options.dialect - SQL dialect to use (default: 'PostgreSQL')
 * @returns {Object} - Extracted schema information
 */
export function parseSchema(sql, options = {}) {
  const parser = new SQLParser(options.dialect || 'PostgreSQL');
  return parser.extractSchema(sql);
}

/**
 * Validate SQL DDL syntax
 * 
 * @param {string} sql - SQL string to validate
 * @param {Object} options - Validator options
 * @param {string} options.dialect - SQL dialect to use (default: 'PostgreSQL') 
 * @returns {Object} - Validation result with valid flag and error details if invalid
 */
export function validate(sql, options = {}) {
  return validateDDL(sql, options);
}

/**
 * Extract table definitions from SQL DDL
 * 
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options
 * @param {string} options.dialect - SQL dialect to use (default: 'PostgreSQL')
 * @returns {Array} - Array of table definitions
 */
export function extractTables(sql, options = {}) {
  const parser = new SQLParser(options.dialect || 'PostgreSQL');
  const ast = parser.parse(sql);
  return parser.extractTableDefinitions(ast);
}

/**
 * Extract view definitions from SQL DDL
 * 
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options
 * @param {string} options.dialect - SQL dialect to use (default: 'PostgreSQL')
 * @returns {Array} - Array of view definitions
 */
export function extractViews(sql, options = {}) {
  const parser = new SQLParser(options.dialect || 'PostgreSQL');
  const ast = parser.parse(sql);
  return parser.extractViewDefinitions(ast);
}

/**
 * Extract procedure definitions from SQL DDL
 * 
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options
 * @param {string} options.dialect - SQL dialect to use (default: 'PostgreSQL')
 * @returns {Array} - Array of procedure definitions
 */
export function extractProcedures(sql, options = {}) {
  const parser = new SQLParser(options.dialect || 'PostgreSQL');
  const ast = parser.parse(sql);
  return parser.extractProcedureDefinitions(ast);
}

/**
 * Extract index definitions from SQL DDL
 * 
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options
 * @param {string} options.dialect - SQL dialect to use (default: 'PostgreSQL')
 * @returns {Array} - Array of index definitions
 */
export function extractIndexes(sql, options = {}) {
  const parser = new SQLParser(options.dialect || 'PostgreSQL');
  const ast = parser.parse(sql);
  return parser.extractIndexDefinitions(ast);
}

// Export the SQLParser class for more advanced usage
export { SQLParser };