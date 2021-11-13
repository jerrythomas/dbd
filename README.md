# dbd

This is a simple cli to apply ddl scripts for individual objects for developers who are more comfortable writing sql scripts.

- [x] Apply set of individual ddl scripts
- [x] Rollback (drop) objects applied
- [ ] Load seed data from csv files
- [ ] Load staging data and post process for development/testing
- [ ] Generate [dbdocs](https://dbdocs.io) dbml for all tables
- [ ] Migration (diff objects, backup and rollback)

## Usage

Install the cli globally using npm (or pnpm/yarn)

```bash
npm i --global @jerrythomas/dbd@beta
```

### Folder Structure

Individual ddl scripts are expected to be placed under folders with names of the database object types. Subfolders are used to specify the schema names. Files are expected to have the same name as the object.

Examples:

- table/core/table_a.ddl
- view/sample/view_a.ddl

> Node: The cli relies on dependencies mentioned in a yaml file (db.yaml) to execute scripts in a sequence. Refer to example folder.

### Commands

| Command      | Action                        |
| ------------ | ----------------------------- |
| dbd init     | create empty folders          |
| dbd apply    | apply the creation scripts    |
| dbd rollback | drop objects created by apply |
| dbd seed     | load seed files               |
| dbd load     | load staging files            |
