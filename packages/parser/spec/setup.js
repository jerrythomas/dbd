// dbd/packages/parser/spec/setup.js
import errorHandler from '../src/utils/error-handler.js'
import { initParser } from '../src/parsers/sql.js'

// Load the pgsql-parser WASM module before any tests run
await initParser()

// Silence warnings during tests to keep the output clean
errorHandler.configure({
	logToConsole: false,
	collectErrors: true
})

// Clean errors before each test
beforeEach(() => {
	errorHandler.clearErrors()
})

// This ensures the error handler is reset even if tests fail
globalThis.cleanup = () => {
	errorHandler.configure({
		logToConsole: true,
		collectErrors: true
	})
}
