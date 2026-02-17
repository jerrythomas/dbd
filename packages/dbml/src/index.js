// @jerrythomas/dbd-dbml — DBML conversion and publishing
export {
	removeCommentBlocks,
	removeIndexCreationStatements,
	normalizeComment,
	cleanupDDLForDBML,
	buildTableReplacements,
	applyTableReplacements,
	buildProjectBlock,
	convertToDBML,
	generateDBML
} from './converter.js'
