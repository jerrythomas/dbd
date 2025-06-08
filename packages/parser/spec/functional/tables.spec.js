// dbd/packages/parser/spec/functional/tables.spec.js
import { describe, it, expect } from 'vitest';
import { extractTables, extractTableName, extractTableSchema, extractColumnsFromStatement, 
  extractDataType, isNullable, extractDefaultValue, extractColumnConstraints } from '../../src/extractors/tables.js';

describe('Table Extractor - Functional API', () => {
  describe('extractTables', () => {
    it('should extract basic table definitions', () => {
      const ast = [
        {
          type: 'create',
          keyword: 'table',
          table: [
            {
              db: null,
              table: 'users',
              as: null
            }
          ],
          create_definitions: [
            {
              column: {
                type: 'column_ref',
                table: null,
                column: {
                  expr: {
                    type: 'default',
                    value: 'id'
                  }
                }
              },
              definition: {
                dataType: 'INT'
              },
              resource: 'column',
              primary_key: 'primary key'
            },
            {
              column: {
                type: 'column_ref',
                table: null,
                column: {
                  expr: {
                    type: 'default',
                    value: 'name'
                  }
                }
              },
              definition: {
                dataType: 'VARCHAR',
                length: 100
              },
              resource: 'column',
              nullable: {
                type: 'not null',
                value: 'not null'
              }
            }
          ]
        }
      ];

      const tables = extractTables(ast);
      
      expect(tables).toBeInstanceOf(Array);
      expect(tables.length).toBe(1);
      
      const table = tables[0];
      expect(table.name).toBe('users');
      expect(table.columns.length).toBe(2);
      
      // Check specific columns
      const idCol = table.columns.find(c => c.name === 'id');
      expect(idCol).toBeDefined();
      expect(idCol.dataType).toContain('int');
      expect(idCol.nullable).toBe(false);
      expect(idCol.constraints.some(c => c.type === 'PRIMARY KEY')).toBe(true);
      
      const nameCol = table.columns.find(c => c.name === 'name');
      expect(nameCol).toBeDefined();
      expect(nameCol.dataType).toContain('varchar');
      expect(nameCol.nullable).toBe(false);
    });

    it('should handle tables with foreign keys', () => {
      const ast = [
        {
          type: 'create',
          keyword: 'table',
          table: [{ table: 'categories' }],
          create_definitions: [
            {
              column: { column: { expr: { value: 'id' } } },
              definition: { dataType: 'INT' },
              primary_key: 'primary key'
            }
          ]
        },
        {
          type: 'create',
          keyword: 'table',
          table: [{ table: 'products' }],
          create_definitions: [
            {
              column: { column: { expr: { value: 'id' } } },
              definition: { dataType: 'INT' },
              primary_key: 'primary key'
            },
            {
              column: { column: { expr: { value: 'category_id' } } },
              definition: { dataType: 'INT' },
              reference_definition: {
                table: [{ table: 'categories' }],
                definition: [{ column: { expr: { value: 'id' } } }]
              }
            }
          ]
        }
      ];

      const tables = extractTables(ast);
      
      expect(tables.length).toBe(2);
      
      // Find products table
      const productsTable = tables.find(t => t.name === 'products');
      expect(productsTable).toBeDefined();
      
      // Check foreign key
      const categoryIdCol = productsTable.columns.find(c => c.name === 'category_id');
      expect(categoryIdCol).toBeDefined();
      
      const fkConstraint = categoryIdCol.constraints.find(c => c.type === 'FOREIGN KEY');
      expect(fkConstraint).toBeDefined();
      expect(fkConstraint.table).toBe('categories');
      expect(fkConstraint.column).toBe('id');
    });

    it('should handle tables with comments', () => {
      const ast = [
        {
          type: 'create',
          keyword: 'table',
          table: [{ table: 'users' }],
          create_definitions: [
            {
              column: { column: { expr: { value: 'id' } } },
              definition: { dataType: 'INT' },
              primary_key: 'primary key'
            }
          ]
        },
        {
          type: 'comment',
          keyword: 'on',
          target: {
            type: 'table',
            name: { table: 'users' }
          },
          expr: {
            expr: { value: 'User accounts table' }
          }
        },
        {
          type: 'comment',
          keyword: 'on',
          target: {
            type: 'column',
            name: {
              table: 'users',
              column: { expr: { value: 'id' } }
            }
          },
          expr: {
            expr: { value: 'Primary key' }
          }
        }
      ];

      const tables = extractTables(ast);
      
      expect(tables.length).toBe(1);
      
      const table = tables[0];
      expect(table.comments).toBeDefined();
      expect(table.comments.table).toBe('User accounts table');
      expect(table.comments.columns).toBeDefined();
      expect(table.comments.columns.id).toBe('Primary key');
    });

    it('should handle search_path schema', () => {
      const ast = [
        {
          type: 'set',
          variable: 'search_path',
          value: ['my_schema']
        },
        {
          type: 'create',
          keyword: 'table',
          table: [
            {
              table: 'users',
              schema: null
            }
          ],
          create_definitions: [
            {
              column: { column: { expr: { value: 'id' } } },
              definition: { dataType: 'INT' },
              primary_key: 'primary key'
            }
          ]
        }
      ];

      const tables = extractTables(ast);
      
      expect(tables.length).toBe(1);
      expect(tables[0].schema).toBe('my_schema');
    });
  });

  describe('Column extraction utilities', () => {
    it('should extract column data types correctly', () => {
      const columnDef = {
        definition: {
          dataType: 'VARCHAR',
          length: 100
        }
      };
      
      expect(extractDataType(columnDef)).toBe('varchar(100)');
    });
    
    it('should determine nullability correctly', () => {
      const notNullColumn = {
        nullable: { type: 'not null' }
      };
      
      const nullableColumn = {};
      
      const primaryKeyColumn = {
        primary_key: 'primary key'
      };
      
      expect(isNullable(notNullColumn)).toBe(false);
      expect(isNullable(nullableColumn)).toBe(true);
      expect(isNullable(primaryKeyColumn)).toBe(false);
    });
    
    it('should extract default values correctly', () => {
      const withStringDefault = {
        default_val: {
          type: 'default',
          value: 'test'
        }
      };
      
      const withFunctionDefault = {
        default_val: {
          type: 'default',
          value: {
            type: 'function',
            name: {
              name: [{ value: 'now' }]
            },
            args: {
              value: []
            }
          }
        }
      };
      
      expect(extractDefaultValue(withStringDefault)).toBe('test');
      expect(extractDefaultValue(withFunctionDefault)).toBe('now()');
    });
    
    it('should extract column constraints correctly', () => {
      const withPrimaryKey = {
        primary_key: 'primary key'
      };
      
      const withForeignKey = {
        reference_definition: {
          table: [{ table: 'users' }],
          definition: [{ column: { expr: { value: 'id' } } }]
        }
      };
      
      const pkConstraints = extractColumnConstraints(withPrimaryKey);
      expect(pkConstraints.length).toBe(1);
      expect(pkConstraints[0].type).toBe('PRIMARY KEY');
      
      const fkConstraints = extractColumnConstraints(withForeignKey);
      expect(fkConstraints.length).toBe(1);
      expect(fkConstraints[0].type).toBe('FOREIGN KEY');
      expect(fkConstraints[0].table).toBe('users');
      expect(fkConstraints[0].column).toBe('id');
    });
  });
});