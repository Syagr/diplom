/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // Look for CommonJS smoke tests that import the compiled dist app
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.cjs'],
  // Include cjs so Jest treats test files as discoverable
  moduleFileExtensions: ['js', 'json', 'cjs'],
  // Keep Jest from trying to transform ESM/TS; tests import compiled dist/app.js
  transform: {},
  // Map TS path aliases used in compiled ESM (dist) back to compiled JS under dist/src
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/dist/src/$1',
  },
};
