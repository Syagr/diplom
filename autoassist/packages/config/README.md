# AutoAssist+ Development Configuration

This package contains shared configuration files for development tools used across the AutoAssist+ monorepo.

## Contents

- **ESLint Configuration** (`eslint.config.js`) - Code linting rules
- **Prettier Configuration** (`prettier.config.js`) - Code formatting rules  
- **TypeScript Base Config** (`tsconfig.base.json`) - Base TypeScript compiler options

## Usage

### ESLint

Create an `.eslintrc.js` file in your project root:

```javascript
module.exports = {
  extends: ['@autoassist/config/eslint.config.js'],
  // Project-specific overrides
};
```

### Prettier

Create a `prettier.config.js` file in your project root:

```javascript
module.exports = require('@autoassist/config/prettier.config.js');
```

Or reference it in your `package.json`:

```json
{
  "prettier": "@autoassist/config/prettier.config.js"
}
```

### TypeScript

Extend the base config in your `tsconfig.json`:

```json
{
  "extends": "@autoassist/config/tsconfig.base.json",
  "compilerOptions": {
    // Project-specific options
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## Package Scripts

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "lint": "eslint . --ext .ts,.tsx,.js,.jsx",
    "lint:fix": "eslint . --ext .ts,.tsx,.js,.jsx --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit"
  }
}
```

## IDE Integration

### VS Code

Create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.preferences.importModuleSpecifier": "relative"
}
```

### VS Code Extensions

Recommended extensions for development:

- ESLint (`dbaeumer.vscode-eslint`)
- Prettier (`esbenp.prettier-vscode`)
- TypeScript Importer (`pmneo.tsimporter`)

## Configuration Details

### ESLint Rules

- **TypeScript**: Comprehensive TypeScript linting with recommended rules
- **Import/Export**: Enforces consistent import ordering and prevents unused imports
- **Code Style**: Consistent formatting and naming conventions
- **React**: JSX and React Hooks linting (when applicable)
- **Node.js**: Server-side specific rules for API projects

### Prettier Formatting

- **Line Width**: 80 characters
- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings, JSX
- **Semicolons**: Always required
- **Trailing Commas**: ES5 compatible

### TypeScript Configuration

- **Target**: ES2020 for modern JavaScript features
- **Module**: ESNext with Node.js resolution
- **Strict Mode**: All strict checks enabled
- **Source Maps**: Enabled for debugging
- **Decorators**: Experimental decorators support

## Customization

Each project can override or extend these configurations as needed:

### Project-Specific ESLint Rules

```javascript
// .eslintrc.js
module.exports = {
  extends: ['@autoassist/config/eslint.config.js'],
  rules: {
    // Override specific rules
    'no-console': 'off',
    '@typescript-eslint/no-explicit-any': 'off'
  }
};
```

### Project-Specific Prettier Options

```javascript
// prettier.config.js
const baseConfig = require('@autoassist/config/prettier.config.js');

module.exports = {
  ...baseConfig,
  printWidth: 120, // Override line width
};
```

### Project-Specific TypeScript Options

```json
{
  "extends": "@autoassist/config/tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

## Maintenance

This configuration is maintained by the AutoAssist+ development team. Updates should be:

1. Tested across all projects in the monorepo
2. Documented with migration guides for breaking changes
3. Versioned according to semantic versioning

For questions or suggestions, please create an issue in the main repository.