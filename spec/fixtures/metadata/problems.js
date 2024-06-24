// Define individual references as variables
const alpha = {
	type: 'table',
	name: 'alpha',
	refers: []
}

const alphaMissing = {
	name: 'alpha',
	refers: []
}

const beta = {
	type: 'table',
	name: 'beta',
	refers: []
}

const betaMissing = {
	name: 'beta',
	refers: []
}

const charlie = {
	type: 'table',
	name: 'charlie',
	refers: ['alpha']
}

const delta = {
	type: 'table',
	name: 'delta',
	refers: ['alpha', 'beta']
}

const echo = {
	type: 'view',
	name: 'echo',
	refers: ['charlie']
}

const foxtrot = {
	type: 'view',
	name: 'foxtrot',
	refers: ['delta']
}

// Export the items as arrays
export const items = [alpha, alphaMissing, beta, betaMissing, charlie, delta, echo, foxtrot]

// Reorder section
export const reorder = {
	input: [foxtrot, echo, delta, alpha, beta, charlie],
	output: [
		{ ...alpha, errors: [] },
		{ ...beta, errors: [] },
		{ ...charlie, errors: [] },
		{ ...delta, errors: [] },
		{ ...echo, errors: [] },
		{ ...foxtrot, errors: [] }
	]
}

// Missing section
export const missing = {
	input: [foxtrot, echo, delta, charlie],
	output: [
		{ ...alphaMissing, errors: [] },
		{ ...betaMissing, errors: [] },
		{ ...charlie, errors: [] },
		{ ...delta, errors: [] },
		{ ...echo, errors: [] },
		{ ...foxtrot, errors: [] }
	]
}

// Simple section
export const simple = {
	input: {
		charlie: charlie,
		alpha: alpha,
		beta: beta,
		delta: delta
	},
	output: {
		groups: [
			['alpha', 'beta'],
			['charlie', 'delta']
		],
		errors: []
	}
}

// Complex section
export const complex = {
	input: {
		charlie: charlie,
		echo: echo,
		alpha: alpha,
		beta: beta,
		foxtrot: foxtrot,
		delta: delta
	},
	output: {
		groups: [
			['alpha', 'beta'],
			['charlie', 'delta'],
			['echo', 'foxtrot']
		],
		errors: []
	}
}

// Cycle section
export const cycle = {
	input: [
		{ type: 'table', name: 'alpha', refers: ['beta'] },
		{ type: 'table', name: 'beta', refers: ['charlie'] },
		{ type: 'table', name: 'charlie', refers: ['alpha'] },
		{ type: 'table', name: 'delta', refers: [] }
	],
	output: [
		['alpha', 'beta'],
		['charlie', 'delta'],
		['echo', 'foxtrot']
	]
}
