import { execSync } from 'child_process'

/**
 * @typedef {Object} Task
 * @property {string} command the command to be executed
 * @property {string?} message optional message to be displayed
 */

/**
 * Execute a task displaying an optional message before executing it.
 *
 * @param {Task[]} objects   Array of tasks to be executed
 * @param {boolean} preview  print command instead of executing
 */
export function run(objects, preview = false) {
	let results = []
	objects.forEach(({ command, message }) => {
		if (message) console.info(message)

		try {
			if (preview) console.info(command)
			else {
				const output = execSync(command, { stdio: [2] })
				console.info(output.toString())
				results.push({ command, output: output.toString() })
			}
		} catch (err) {
			console.error(err.message)
			results.push({ command, error: err.message })
		}
	})
	return results
}
