// @jerrythomas/dbd-db — Database operations abstraction layer

export { BaseDatabaseAdapter } from './base-adapter.js'
export { createAdapter, getAdapterInfo, registerAdapter, SUPPORTED_DATABASES } from './factory.js'

export {
	// Constants
	typesWithSchema,
	typesWithoutSchema,
	allowedTypes,
	defaultExportOptions,
	defaultImportOptions,
	// Entity factories
	entityFromFile,
	entityFromSchemaName,
	entityFromRoleName,
	entityFromExtensionConfig,
	entityFromExportConfig,
	entityFromImportConfig,
	// DDL generation
	ddlFromEntity,
	generateRoleScript,
	combineEntityScripts,
	// Import/export scripts
	importScriptForEntity,
	exportScriptForEntity,
	// DBML filtering
	filterEntitiesForDBML,
	// Validation
	validateEntity,
	getValidEntities,
	getInvalidEntities,
	// Organization
	organizeEntities
} from './entity-processor.js'

export {
	buildDependencyGraph,
	findCycles,
	validateDependencies,
	sortByDependencies,
	groupByDependencyLevel
} from './dependency-resolver.js'
