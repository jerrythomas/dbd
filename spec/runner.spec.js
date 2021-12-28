import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import { run } from '../src/runner.js'
import { MockConsole } from '@vanillaes/mock-console'

const logger = new MockConsole()

const RunnerSuite = suite('Shell runner')

RunnerSuite.before(() => {})
RunnerSuite.before.each(async () => {
	logger.capture()
})

RunnerSuite.after.each(() => {
	logger.restore()
	logger.flush()
})

RunnerSuite('run in preview mode', () => {
	let command = 'echo "hello"'
	let message = 'sample message'

	run([{ command }], true)
	run([{ command, message }], true)
	assert.equal(logger.infos, [command, message, command])
})

RunnerSuite('run', () => {
	let command = 'echo "hello"'
	let results = run([{ command }])
	assert.equal(results.length, 1)
	assert.equal(results[0].output, 'hello\n')
	assert.equal(logger.infos, ['hello\n'])
})

RunnerSuite('run failure', () => {
	let command = 'exho "hello"'
	const expected =
		'Command failed: exho "hello"\\n/bin/sh: exho:.* not found\\n'
	let results = run([{ command }])
	assert.equal(results.length, 1)
	assert.ok(results[0].error.match(expected))
	assert.ok(logger.errors[0].match(expected))
})

RunnerSuite.run()
