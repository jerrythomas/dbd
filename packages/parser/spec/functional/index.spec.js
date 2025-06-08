// dbd/packages/parser/spec/functional/index.spec.js
import { describe, it, expect } from 'vitest';
import { 
  extractSchema, 
  extractTableDefinitions, 
  extractViewDefinitions,
  extractProcedureDefinitions,
  extractIndexDefinitions,
  validateDDL
} from '../../src/index-functional.js';

describe('SQL Parser - Functional API - Complete Workflow', () => {
  const complexSQL = `
    -- Set the search path
    SET search_path TO app, public;
    
    -- Create tables
    CREATE TABLE categories (
      id serial PRIMARY KEY,
      name varchar(100) NOT NULL,
      parent_id int REFERENCES categories(id),
      created_at timestamp DEFAULT now()
    );
    
    CREATE TABLE products (
      id uuid PRIMARY KEY,
      name varchar(200) NOT NULL,
      description text,
      price numeric(10,2) NOT NULL,
      category_id int NOT NULL REFERENCES categories(id),
      is_active boolean DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp
    );
    
    -- Add comments
    COMMENT ON TABLE products IS 'Product catalog';
    COMMENT ON COLUMN products.id IS 'Unique product identifier';
    
    -- Create indexes
    CREATE UNIQUE INDEX idx_categories_name ON categories(name);
    CREATE INDEX idx_products_category ON products(category_id);
    
    -- Create view
    CREATE OR REPLACE VIEW active_products AS
    SELECT p.*, c.name as category_name
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE p.is_active = true;
    
    -- Create procedure
    CREATE OR REPLACE PROCEDURE update_product_timestamp(product_id uuid)
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE products 
      SET updated_at = now() 
      WHERE id = product_id;
    END;
    $$;
  `;
  
  describe('extractSchema', () => {
    it('should extract a complete schema with all object types', () => {
      const schema = extractSchema(complexSQL);
      
      // Verify schema contains all object types
      expect(schema).toBeDefined();
      expect(schema.tables).toBeInstanceOf(Array);
      expect(schema.views).toBeInstanceOf(Array);
      expect(schema.procedures).toBeInstanceOf(Array);
      expect(schema.indexes).toBeInstanceOf(Array);
      
      // Verify counts
      expect(schema.tables.length).toBe(2);
      expect(schema.views.length).toBe(1);
      expect(schema.procedures.length).toBe(1);
      expect(schema.indexes.length).toBe(2);
      
      // Verify object names
      expect(schema.tables.map(t => t.name)).toContain('categories');
      expect(schema.tables.map(t => t.name)).toContain('products');
      expect(schema.views[0].name).toBe('active_products');
      expect(schema.procedures[0].name).toBe('update_product_timestamp');
      expect(schema.indexes.map(i => i.name)).toContain('idx_categories_name');
    });
  });
  
  describe('Individual extractors', () => {
    it('should extract tables with extractTableDefinitions', () => {
      const tables = extractTableDefinitions(complexSQL);
      
      expect(tables.length).toBe(2);
      
      // Check categories table
      const categories = tables.find(t => t.name === 'categories');
      expect(categories).toBeDefined();
      expect(categories.columns.length).toBe(4);
      expect(categories.columns[0].name).toBe('id');
      expect(categories.columns[0].dataType).toContain('serial');
      
      // Check products table
      const products = tables.find(t => t.name === 'products');
      expect(products).toBeDefined();
      expect(products.columns.length).toBe(8);
      expect(products.comments.table).toBe('Product catalog');
      
      // Check for foreign key relationship
      const categoryIdCol = products.columns.find(c => c.name === 'category_id');
      expect(categoryIdCol).toBeDefined();
      const fk = categoryIdCol.constraints.find(c => c.type === 'FOREIGN KEY');
      expect(fk).toBeDefined();
      expect(fk.table).toBe('categories');
    });
    
    it('should extract views with extractViewDefinitions', () => {
      const views = extractViewDefinitions(complexSQL);
      
      expect(views.length).toBe(1);
      expect(views[0].name).toBe('active_products');
      expect(views[0].replace).toBe(true);
      
      // Check view dependencies
      const dependencies = views[0].dependencies;
      expect(dependencies).toBeInstanceOf(Array);
      expect(dependencies.some(d => d.table === 'products')).toBe(true);
      expect(dependencies.some(d => d.table === 'categories')).toBe(true);
    });
    
    it('should extract procedures with extractProcedureDefinitions', () => {
      const procedures = extractProcedureDefinitions(complexSQL);
      
      expect(procedures.length).toBe(1);
      expect(procedures[0].name).toBe('update_product_timestamp');
      expect(procedures[0].language).toBe('plpgsql');
      
      // Check procedure parameters
      expect(procedures[0].parameters.length).toBe(1);
      expect(procedures[0].parameters[0].name).toBe('product_id');
      expect(procedures[0].parameters[0].dataType).toContain('uuid');
      
      // Check table references in procedure
      expect(procedures[0].tableReferences).toContain('products');
    });
    
    it('should extract indexes with extractIndexDefinitions', () => {
      const indexes = extractIndexDefinitions(complexSQL);
      
      expect(indexes.length).toBe(2);
      
      // Check unique index
      const uniqueIndex = indexes.find(i => i.name === 'idx_categories_name');
      expect(uniqueIndex).toBeDefined();
      expect(uniqueIndex.unique).toBe(true);
      expect(uniqueIndex.table).toBe('categories');
      expect(uniqueIndex.columns[0].name).toBe('name');
      
      // Check regular index
      const regularIndex = indexes.find(i => i.name === 'idx_products_category');
      expect(regularIndex).toBeDefined();
      expect(regularIndex.unique).toBe(false);
      expect(regularIndex.table).toBe('products');
      expect(regularIndex.columns[0].name).toBe('category_id');
    });
  });
  
  describe('Validation', () => {
    it('should validate valid SQL', () => {
      const result = validateDDL(complexSQL);
      expect(result.valid).toBe(true);
    });
    
    it('should invalidate incorrect SQL', () => {
      const invalidSQL = 'CREATE TABLE missing_paren (id int';
      const result = validateDDL(invalidSQL);
      
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Error');
    });
  });
});