import js from '@eslint/js'

export default [
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 2024,
			sourceType: 'module',
			globals: {
				console: 'readonly',
				process: 'readonly',
				URL: 'readonly',
				Buffer: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				setInterval: 'readonly',
				clearInterval: 'readonly'
			}
		},
		rules: {
			complexity: ['warn', 5],
			'max-depth': ['warn', 2],
			'max-params': ['warn', 4],
			eqeqeq: 'error',
			'no-eq-null': 'error',
			'no-implicit-coercion': 'warn',
			'no-unused-vars': 'warn',
			'no-unused-private-class-members': 'warn',
			'max-lines-per-function': ['warn', { max: 30, skipBlankLines: true, skipComments: true }]
		}
	},
	{
		files: ['**/*.spec.js', '**/e2e/**/*.js', '**/spec/**/*.js'],
		languageOptions: {
			globals: {
				describe: 'readonly',
				it: 'readonly',
				expect: 'readonly',
				beforeAll: 'readonly',
				afterAll: 'readonly',
				beforeEach: 'readonly',
				afterEach: 'readonly',
				vi: 'readonly'
			}
		},
		rules: {
			'max-lines-per-function': 'off',
			'no-unused-vars': 'off'
		}
	},
	{
		files: ['**/spec/fixtures/**/*.js'],
		rules: {
			'no-dupe-keys': 'off',
			'no-sparse-arrays': 'off'
		}
	},
	{
		ignores: ['dist/', 'node_modules/', '**/node_modules/']
	}
]
