# dbd

![GitHub Workflow Status](https://img.shields.io/github/workflow/status/jerrythomas/dbd/Release)
[![Maintainability](https://api.codeclimate.com/v1/badges/55861d839f6d2c7f0c5e/maintainability)](https://codeclimate.com/github/jerrythomas/dbd/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/55861d839f6d2c7f0c5e/test_coverage)](https://codeclimate.com/github/jerrythomas/dbd/test_coverage)

This is a simple cli to apply ddl scripts for individual objects for developers who are more comfortable writing sql scripts.

- [x] Apply set of individual ddl scripts
- [x] Rollback (drop) objects applied
- [x] Load staging data with post process scripts for development/testing
- [x] Export data from tables & views
- [x] Generate [dbdocs](https://dbdocs.io) dbml for all (or subset) tables
- [ ] Generate ddl from yaml
- [ ] Migration (diff objects, backup and rollback)

## Usage

Install the cli globally using npm (or pnpm/yarn)

```bash
npm i --global @jerrythomas/dbd@beta
```

### Folder Structure

Individual ddl scripts are expected to be placed under folders with names of the database object types. Subfolders are used to specify the schema names. Files are expected to have the same name as the object.

[example](example)

> Node: The cli relies on dependencies mentioned in a yaml file (db.yaml) to execute scripts in a sequence. Refer to example folder.

### Commands

| Command     | Action                         |
| ----------- | ------------------------------ |
| dbd init    | create an example repo         |
| dbd inspect | inspect and report issues      |
| dbd combine | combine all into single script |
| dbd apply   | apply the creation scripts     |
| dbd import  | load seed/staging files        |
| dbd export  | export tables/views            |
| dbd dbml    | generate dbml files            |
