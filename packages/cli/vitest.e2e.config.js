import { defineConfig } from 'vite'

export default defineConfig({
	test: {
		include: ['e2e/**/*.spec.js'],
		pool: 'forks',
		globals: true,
		testTimeout: 30000
	}
})
