/**
 * Translator for CREATE FUNCTION / CREATE PROCEDURE statements.
 * @module translators/create-function
 */

import { resolveTypeName } from './types.js'

const PARAM_MODE_MAP = {
	105: 'in',
	111: 'out',
	98: 'inout',
	FUNC_PARAM_IN: 'in',
	FUNC_PARAM_OUT: 'out',
	FUNC_PARAM_INOUT: 'inout'
}

/**
 * Extract language and body from the DefElem options array.
 */
const extractFunctionOptions = (options) => {
	let language = 'plpgsql'
	let body = ''

	for (const opt of options) {
		const de = opt.DefElem
		if (de.defname === 'language') language = de.arg.String.sval
		if (de.defname === 'as' && de.arg?.List?.items) {
			body = de.arg.List.items
				.map((a) => a.String?.sval)
				.filter(Boolean)
				.join('')
		}
	}

	return { language, body }
}

/**
 * Build the normalized options array (language + as entries only).
 */
const buildFunctionOptions = (options, language, body) =>
	options
		.map((o) => {
			const de = o.DefElem
			if (de.defname === 'language') return { prefix: 'LANGUAGE', value: language }
			if (de.defname === 'as') return { type: 'as', expr: body }
			return null
		})
		.filter(Boolean)

const translateFunctionParameter = (param) => {
	const fp = param.FunctionParameter
	return {
		name: fp.name || '',
		dataType: resolveTypeName(fp.argType),
		mode: PARAM_MODE_MAP[fp.mode] || 'in'
	}
}

export const translateCreateFunctionStmt = (funcStmt, originalSql) => {
	const nameStr = funcStmt.funcname.map((n) => n.String?.sval).filter(Boolean)
	const schema = nameStr.length > 1 ? nameStr[0] : null
	const name = nameStr.length > 1 ? nameStr[1] : nameStr[0]
	const isProcedure = funcStmt.is_procedure || false
	const returnType = funcStmt.returnType ? resolveTypeName(funcStmt.returnType) : null

	const options = funcStmt.options || []
	const { language, body } = extractFunctionOptions(options)
	const parameters = (funcStmt.parameters || []).map(translateFunctionParameter)
	const keyword = isProcedure ? 'procedure' : 'function'
	const isOrReplace = /OR\s+REPLACE/i.test(originalSql || '')

	return {
		type: 'create',
		keyword,
		[keyword]: { [keyword]: name, name, schema },
		name: { name: [{ value: name }], schema },
		replace: isOrReplace,
		or_replace: isOrReplace,
		language,
		parameters,
		args: parameters,
		returns: returnType,
		as: body,
		body,
		options: buildFunctionOptions(options, language, body),
		_original_sql: originalSql
	}
}
