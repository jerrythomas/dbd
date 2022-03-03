/**
 * Sets the references to empty array
 *
 * @param {*} data
 * @returns
 */
export function fillMissingInfoForEntities(data) {
	const types = ['role', 'table', 'view', 'function', 'procedure']

	types.map((type) => {
		const key = `${type}s`
		if (key in data) {
			data[key] = data[key].map((item) => ({ refers: [], ...item, type }))
		} else {
			data[key] = []
		}
	})
	return data
}
