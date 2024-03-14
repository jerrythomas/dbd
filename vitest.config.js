import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [],
	test: {
		include: ['spec/**/*.spec.js'],
		pool: 'forks',
		globals: true,
		coverage: {
			reporter: ['text', 'html', 'lcov'],
			all: false,
			include: ['src']
		}
	}
})
