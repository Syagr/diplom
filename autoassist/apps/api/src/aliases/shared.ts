// UA/EN: Compatibility bridge for legacy alias `@autoassist/shared`.
// Bridges API runtime to the built workspace package without Telegram.
// Keep a single re-export from the package barrel to avoid fragile deep paths.

export * from "../../../../packages/shared/dist/index.js";
