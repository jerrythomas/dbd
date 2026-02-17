import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [],
	test: {
		include: ['e2e/**/*.spec.js'],
		pool: 'forks',
		globals: true,
		testTimeout: 30000
	}
})
