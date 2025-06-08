/**
 * Procedures extractor module
 * @module extractors/procedures
 */

import { pipe, filter, map, curry, prop, propEq, find, assoc } from 'ramda';
import { extractSearchPath } from './tables.js';

/**
 * Extract all procedure definitions from an AST
 * @param {Array} ast - Parsed SQL AST
 * @returns {Array} Extracted procedure definitions
 */
export const extractProcedures = (ast) => {
  if (!ast || !Array.isArray(ast)) return [];
  
  // Find search_path if it exists
  const searchPath = extractSearchPath(ast);
  
  // Extract procedures from AST
  const procedures = pipe(
    filter(stmt => stmt.type === 'create' && stmt.keyword === 'procedure'),
    map(procDefFromStatement(searchPath))
  )(ast);
  
  // Check if we have any procedure with original statement
  const proceduresFromOriginal = pipe(
    filter(stmt => stmt.type === 'create' && stmt.keyword === 'procedure' && stmt.original),
    map(stmt => extractProcedureFromOriginal(stmt.original, searchPath))
  )(ast);

  if (proceduresFromOriginal.length > 0) {
    return proceduresFromOriginal;
  }
  
  // Extract procedures from SQL text if AST parsing failed
  if (procedures.length === 0 && ast._original_sql) {
    return extractProceduresFromSql(ast._original_sql, searchPath);
  }
  
  return procedures;
};

/**
 * Convert a create procedure statement to a structured procedure definition
 * @param {string|null} defaultSchema - Default schema from search_path
 * @param {Object} stmt - CREATE PROCEDURE statement
 * @returns {Object} Structured procedure definition
 */
export const procDefFromStatement = curry((defaultSchema, stmt) => {
  const procedureName = extractProcedureName(stmt);
  const schema = extractProcedureSchema(stmt) || defaultSchema;
  const isReplace = extractIsReplace(stmt);
  
  return {
    name: procedureName,
    schema: schema,
    replace: isReplace,
    language: extractProcedureLanguage(stmt),
    parameters: extractProcedureParameters(stmt),
    returnType: extractProcedureReturnType(stmt),
    body: extractProcedureBody(stmt),
    tableReferences: extractTableReferencesFromBody(extractProcedureBody(stmt))
  };
});

/**
 * Extract procedure name from a CREATE PROCEDURE statement
 * @param {Object} stmt - CREATE PROCEDURE statement
 * @returns {string} Procedure name
 */
export const extractProcedureName = (stmt) => {
  if (typeof stmt.procedure === 'object' && stmt.procedure !== null) {
    return stmt.procedure.procedure || stmt.procedure.name;
  }
  return stmt.procedure || '';
};

/**
 * Extract procedure schema from a CREATE PROCEDURE statement
 * @param {Object} stmt - CREATE PROCEDURE statement
 * @returns {string|null} Procedure schema or null
 */
export const extractProcedureSchema = (stmt) => {
  if (typeof stmt.procedure === 'object' && stmt.procedure !== null) {
    return stmt.procedure.schema;
  }
  return stmt.schema || null;
};

/**
 * Extract if the procedure is a CREATE OR REPLACE PROCEDURE
 * @param {Object} stmt - CREATE PROCEDURE statement
 * @returns {boolean} True if it's a REPLACE procedure
 */
export const extractIsReplace = (stmt) => {
  if (stmt.replace === 'or replace') {
    return true;
  } else if (typeof stmt.replace === 'boolean') {
    return stmt.replace;
  } else if (stmt.or_replace) {
    return true;
  }
  return false;
};

/**
 * Extract procedure language from a CREATE PROCEDURE statement
 * @param {Object} stmt - CREATE PROCEDURE statement
 * @returns {string} Procedure language
 */
export const extractProcedureLanguage = (stmt) => {
  return stmt.language || 'plpgsql';
};

/**
 * Extract procedure parameters from a CREATE PROCEDURE statement
 * @param {Object} stmt - CREATE PROCEDURE statement
 * @returns {Array} Extracted procedure parameters
 */
export const extractProcedureParameters = (stmt) => {
  if (!stmt.parameters || !Array.isArray(stmt.parameters)) {
    return [];
  }
  
  return stmt.parameters.map(param => ({
    name: param.name,
    dataType: extractParameterDataType(param),
    mode: extractParameterMode(param)
  }));
};

/**
 * Extract parameter data type
 * @param {Object} param - Parameter definition
 * @returns {string} Data type
 */
export const extractParameterDataType = (param) => {
  if (param.dataType) {
    if (typeof param.dataType === 'string') {
      return param.dataType.toLowerCase();
    } else if (param.dataType.dataType) {
      return param.dataType.dataType.toLowerCase();
    }
  }
  return 'unknown';
};

/**
 * Extract parameter mode (IN, OUT, INOUT)
 * @param {Object} param - Parameter definition
 * @returns {string} Parameter mode
 */
export const extractParameterMode = (param) => {
  if (param.mode) {
    return param.mode.toLowerCase();
  }
  return 'in'; // Default is IN
};

/**
 * Extract procedure return type from a CREATE PROCEDURE statement
 * @param {Object} stmt - CREATE PROCEDURE statement
 * @returns {string|null} Return type or null
 */
export const extractProcedureReturnType = (stmt) => {
  return stmt.returns || null;
};

/**
 * Extract procedure body from a CREATE PROCEDURE statement
 * @param {Object} stmt - CREATE PROCEDURE statement
 * @returns {string} Procedure body
 */
export const extractProcedureBody = (stmt) => {
  return stmt.as || '';
};

/**
 * Extract tables referenced in procedure body
 * @param {string} body - Procedure body
 * @returns {Array} Array of table names
 */
export const extractTableReferencesFromBody = (body) => {
  if (!body || typeof body !== 'string') return [];
  
  const tables = new Set();
  
  // Common SQL keywords that might precede table names
  const sqlKeywords = [
    'FROM', 'JOIN', 'INTO', 'UPDATE', 'INSERT INTO', 
    'DELETE FROM', 'ALTER TABLE', 'CREATE TABLE'
  ];
  
  // Create a regex pattern that matches all keywords
  const pattern = new RegExp(
    `(${sqlKeywords.join('|')})\\s+([\\w"\\.]+)`, 
    'gi'
  );
  
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const potentialTable = match[2]
      .replace(/"/g, '') // Remove quotes
      .split('.').pop(); // Remove schema if present
    
    if (potentialTable && 
        !/^(SELECT|WHERE|GROUP|ORDER|HAVING|UNION|AND|OR|AS)$/i.test(potentialTable)) {
      tables.add(potentialTable);
    }
  }
  
  return Array.from(tables);
};

/**
 * Extract procedure from original statement string
 * @param {string} originalStmt - Original procedure statement
 * @param {string|null} defaultSchema - Default schema
 * @returns {Object} Procedure definition
 */
export const extractProcedureFromOriginal = (originalStmt, defaultSchema) => {
  const procedures = extractProceduresFromSql(originalStmt, defaultSchema);
  return procedures.length > 0 ? procedures[0] : null;
};

/**
 * Extract procedures from SQL string when AST parsing fails
 * @param {string} sql - Original SQL string
 * @param {string|null} defaultSchema - Default schema
 * @returns {Array} Array of procedure definitions
 */
export const extractProceduresFromSql = (sql, defaultSchema) => {
  const procedures = [];
  
  // Extract procedures with regex
  const procRegex = /CREATE\s+(OR\s+REPLACE\s+)?PROCEDURE\s+(?:(\w+)\.)?(\w+)\s*\(([^)]*)\)(?:\s+RETURNS\s+([^\s]+))?(?:\s+LANGUAGE\s+(\w+))?\s+AS\s+(?:\$\w*\$([\s\S]*?)\$\w*\$|'([\s\S]*?)')/gi;
  
  let match;
  while ((match = procRegex.exec(sql)) !== null) {
    const isReplace = !!match[1];
    const schema = match[2] || defaultSchema;
    const procName = match[3];
    const params = match[4];
    const returnType = match[5] || null;
    const language = match[6]?.toLowerCase() || 'plpgsql';
    const body = match[7] || match[8] || '';
    
    // Parse parameters
    const parameters = params.split(',').filter(Boolean).map(paramStr => {
      const paramParts = paramStr.trim().split(/\s+/);
      let mode = 'in';
      let name = '';
      let dataType = 'unknown';
      
      if (/^IN(OUT)?$/i.test(paramParts[0]) || /^OUT$/i.test(paramParts[0])) {
        mode = paramParts[0].toLowerCase();
        name = paramParts[1];
        dataType = paramParts.slice(2).join(' ').toLowerCase();
      } else {
        name = paramParts[0];
        dataType = paramParts.slice(1).join(' ').toLowerCase();
      }
      
      return { name, dataType, mode };
    });
    
    procedures.push({
      name: procName,
      schema,
      replace: isReplace,
      language,
      parameters,
      returnType,
      body,
      tableReferences: extractTableReferencesFromBody(body)
    });
  }
  
  return procedures;
};