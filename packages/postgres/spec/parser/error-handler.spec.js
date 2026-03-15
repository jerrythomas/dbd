// dbd/packages/parser/spec/error-handler.spec.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import errorHandler from '../../src/parser/utils/error-handler.js'

describe('Error Handler', () => {
	beforeEach(() => {
		errorHandler.clearErrors()
	})

	afterEach(() => {
		// Reset the error handler to default state
		errorHandler.configure({
			logToConsole: false,
			collectErrors: true,
			throwOnError: false
		})
	})

	describe('Configuration', () => {
		it('should have default configuration', () => {
			// Reset to default by calling the function
			errorHandler.configure({
				logToConsole: false,
				collectErrors: true,
				throwOnError: false
			})

			// Capture an error
			errorHandler.handleParsingError('Test error', 'SELECT * FROM test')

			// Check errors were collected
			expect(errorHandler.getErrors()).toHaveLength(1)
		})

		it('should configure error collection', () => {
			errorHandler.configure({ collectErrors: false })
			errorHandler.handleParsingError('Test error', 'SELECT * FROM test')

			// Should not collect errors when disabled
			expect(errorHandler.getErrors()).toHaveLength(0)
		})
	})

	describe('Error Handling', () => {
		it('should collect errors', () => {
			errorHandler.handleParsingError('Error 1', 'SQL 1')
			errorHandler.handleParsingError('Error 2', 'SQL 2')

			const errors = errorHandler.getErrors()
			expect(errors).toHaveLength(2)
			expect(errors[0].message).toBe('Error 1')
			expect(errors[1].message).toBe('Error 2')
		})

		it('should handle Error objects', () => {
			const error = new Error('Test error')
			errorHandler.handleParsingError(error, 'SQL statement')

			const errors = errorHandler.getErrors()
			expect(errors).toHaveLength(1)
			expect(errors[0].message).toBe('Test error')
		})

		it('should clear errors', () => {
			errorHandler.handleParsingError('Error', 'SQL')
			expect(errorHandler.getErrors()).toHaveLength(1)

			errorHandler.clearErrors()
			expect(errorHandler.getErrors()).toHaveLength(0)
		})

		it('should truncate long statements in preview', () => {
			const longSQL = 'SELECT ' + 'x'.repeat(200)
			errorHandler.handleParsingError('Error', longSQL)
			const errors = errorHandler.getErrors()
			expect(errors[0].preview).toContain('...')
			expect(errors[0].preview.length).toBeLessThanOrEqual(103)
		})

		it('should handle null/empty statement', () => {
			errorHandler.handleParsingError('Error', null)
			const errors = errorHandler.getErrors()
			expect(errors[0].preview).toBe('')
		})

		it('should include context in console output', () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
			errorHandler.configure({ logToConsole: true })
			errorHandler.handleParsingError('Error', 'SQL', 'table extraction')
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('in table extraction'))
			consoleSpy.mockRestore()
		})

		it('should omit context from console when not provided', () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
			errorHandler.configure({ logToConsole: true })
			errorHandler.handleParsingError('Error', 'SQL')
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Could not parse statement:'))
			consoleSpy.mockRestore()
		})

		it('should throw errors when configured', () => {
			errorHandler.configure({ throwOnError: true })

			expect(() => {
				errorHandler.handleParsingError('Throwing error', 'SQL')
			}).toThrow('SQL Parsing Error: Throwing error')
		})
	})

	describe('Console Output', () => {
		it('should log to console when enabled', () => {
			// Mock console.warn
			const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {})

			// Enable console output
			errorHandler.configure({ logToConsole: true })
			errorHandler.handleParsingError('Console error', 'SQL statement')

			// Check console.warn was called
			expect(consoleWarnMock).toHaveBeenCalledTimes(2)
			expect(consoleWarnMock).toHaveBeenCalledWith(expect.stringContaining('Console error'))

			// Restore console.warn
			consoleWarnMock.mockRestore()
		})

		it('should not log to console when disabled', () => {
			// Mock console.warn
			const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {})

			// Disable console output
			errorHandler.configure({ logToConsole: false })
			errorHandler.handleParsingError('Silent error', 'SQL statement')

			// Check console.warn was not called
			expect(consoleWarnMock).not.toHaveBeenCalled()

			// Restore console.warn
			consoleWarnMock.mockRestore()
		})
	})

	describe('Silent/Enable helpers', () => {
		it('silentForTests disables console output', () => {
			errorHandler.enableConsoleOutput()
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
			errorHandler.silentForTests()
			errorHandler.handleParsingError('test', 'SQL')
			expect(consoleSpy).not.toHaveBeenCalled()
			consoleSpy.mockRestore()
		})

		it('enableConsoleOutput enables console output', () => {
			errorHandler.silentForTests()
			errorHandler.enableConsoleOutput()
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
			errorHandler.handleParsingError('test', 'SQL')
			expect(consoleSpy).toHaveBeenCalled()
			consoleSpy.mockRestore()
		})
	})

	describe('Utility Functions', () => {
		it('should wrap functions with error handling', () => {
			const throwingFunction = () => {
				throw new Error('Function error')
			}

			const wrappedFunction = errorHandler.withErrorHandling(throwingFunction, 'test context')
			const result = wrappedFunction('test input')

			// Function should not throw, but return null
			expect(result).toBeNull()

			// Error should be captured
			const errors = errorHandler.getErrors()
			expect(errors).toHaveLength(1)
			expect(errors[0].message).toBe('Function error')
			expect(errors[0].context).toBe('test context')
		})

		it('should return result from wrapped function on success', () => {
			const successFunction = (input) => `parsed: ${input}`

			const wrappedFunction = errorHandler.withErrorHandling(successFunction, 'test context')
			const result = wrappedFunction('SELECT 1')

			expect(result).toBe('parsed: SELECT 1')
			expect(errorHandler.getErrors()).toHaveLength(0)
		})

		it('should run with temporary config', () => {
			const result = errorHandler.withConfig(
				() => {
					// This should not add to the error collection
					errorHandler.handleParsingError('Temporary error', 'SQL')
					return 'success'
				},
				{ collectErrors: false }
			)

			expect(result).toBe('success')

			// No errors should be collected
			expect(errorHandler.getErrors()).toHaveLength(0)
		})

		it('should restore config even when function throws', () => {
			expect(() => {
				errorHandler.withConfig(
					() => {
						throw new Error('boom')
					},
					{ collectErrors: false }
				)
			}).toThrow('boom')

			// Config should be restored — errors should be collected again
			errorHandler.handleParsingError('After restore', 'SQL')
			expect(errorHandler.getErrors()).toHaveLength(1)
		})
	})
})
