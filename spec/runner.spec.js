import { test } from 'uvu'
import * as assert from 'uvu/assert'
import { run } from '../src/runner.js'
import { MockConsole } from '@vanillaes/mock-console'

const logger = new MockConsole()

test.before(() => {})
test.before.each(async () => {
	logger.capture()
})

test.after.each(() => {
	logger.restore()
	logger.flush()
})

test('run in preview mode', () => {
	let command = 'echo "hello"'
	let message = 'sample message'

	run([{ command }], true)
	run([{ command, message }], true)

	assert.equal(logger.infos, [command, message, command])
})

test('run', () => {
	let command = 'echo "hello"'
	let results = run([{ command }])
	assert.equal(results.length, 1)
	assert.equal(results[0].output, 'hello\n')
	assert.equal(logger.infos, ['hello\n'])
})

test('run failure', () => {
	let command = 'exho "hello"'
	let results = run([{ command }])
	// logger.restore()
	// console.log(results)
	assert.equal(results.length, 1)
	assert.equal(
		results[0].error,
		'Command failed: exho "hello"\n/bin/sh: exho: command not found\n'
	)
	assert.equal(logger.errors, [
		'Command failed: exho "hello"\n/bin/sh: exho: command not found\n'
	])
})
test.run()
