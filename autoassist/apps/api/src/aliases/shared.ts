// Compatibility re-export for legacy alias `@autoassist/shared`
// Route old imports to the `packages/shared` entrypoint.
// Point to the TypeScript source in the repository `packages/shared` so tsx/ts-node can resolve during dev.
// Compatibility re-export for legacy alias `@autoassist/shared`
// Route old imports to the `packages/shared` TypeScript entry so tsx/ts-node can resolve during dev.
// Note: .js extension used so Node ESM resolution (NodeNext) will accept the import path during runtime when tsx maps sources.
// Re-export helpers and types commonly used by the API to satisfy legacy imports like
// `import { formatCurrency, calculateDistance } from '@autoassist/shared'`.
// Re-export TypeScript sources directly. tsx/ts-node should resolve these during dev without a build.
// Re-export from the built package output so Node ESM resolves runtime exports reliably.
export * from "../../../../packages/shared/dist/utils/helpers.js";
export * from "../../../../packages/shared/dist/utils/validation.js";
export * from "../../../../packages/shared/dist/utils/constants.js";
export * from "../../../../packages/shared/dist/types/api.js";
export * from "../../../../packages/shared/dist/types/entities.js";
export * from "../../../../packages/shared/dist/types/blockchain.js";
export * from "../../../../packages/shared/dist/types/telegram.js";
// Also re-export the package entrypoint to support `import { ... } from '@autoassist/shared'`
export * from "../../../../packages/shared/dist/index.js";
