#!/usr/bin/env node
import sade from 'sade'
import fs from 'fs'
import { dbtypes } from './scripts.js'
import { inspect, apply, rollback, migrate, combine, load } from './action.js'

const prog = sade('dbd')

prog
	.version('1.0.0')
	.option('-c, --config', 'Provide path to custom config', 'db.yaml')
	.option('-d, --database', 'Database URL', process.env.DATABASE_URL)
	.option('-e, --environment', 'Environment to load data', 'development')

prog
	.command('init')
	.describe('Initialize an empty project')
	.example('dbd init')
	.action((opts) => {
		Object.keys(dbtypes).map((dbtype) => {
			if (!fs.existsSync(dbtype)) fs.mkdirSync(dbtype)
		})
	})

prog
	.command('inspect')
	.describe('Inspect the current folder.')
	.example('dbd inspect')
	.action((opts) => {
		inspect(opts)
	})

prog
	.command('apply')
	.describe('Apply the database scripts to database.')
	.example('dbd apply')
	.example('dbd apply -c database.yaml')
	.example('dbd apply -d postgres://localhost:5432')
	.action((opts) => {
		apply(opts)
	})

prog
	.command('rollback')
	.describe('Rollback last applied scripts.')
	.example('dbd rollback')
	.action((opts) => {
		rollback(opts)
	})

prog
	.command('migrate')
	.describe('Generate migration and rollback scripts and apply migration.')
	.example('dbd migrate')
	.action((opts) => {
		migrate(opts)
	})

prog
	.command('dbml')
	.option('-f, --file', 'Destination dbml file', 'design.dbml')
	.describe('Combine table ddl scripts and generate dbml.')
	.example('dbd dbml')
	.example('dbd dbml -f design.dbml')
	.action((opts) => {
		combine(opts)
	})

prog
	.command('load')
	.option('-s', '--seed-only', 'load seeded data only')
	.option('-r', '--raw-only', 'load raw staging data')
	.describe('Load csv files into database')
	.example('dbd')
	.action((opts) => {
		load(opts)
	})

prog
	.command('combine')
	.option('-f, --file', 'Destination dbml file', 'design.ddl')
	.describe('Combine all ddl scripts and generate dbml.')
	.example('dbd')
	.action((opts) => {
		console.log('combine filename', opts.file)
	})

prog.parse(process.argv)
