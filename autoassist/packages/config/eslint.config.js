module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true
  },
  extends: [
    'eslint:recommended',
    '@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier'
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: './tsconfig.json'
  },
  plugins: [
    '@typescript-eslint',
    'import'
  ],
  rules: {
    // TypeScript specific
    '@typescript-eslint/no-unused-vars': ['error', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_' 
    }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/prefer-optional-chain': 'error',
    '@typescript-eslint/prefer-nullish-coalescing': 'error',
    
    // Import/Export
    'import/order': ['error', {
      'groups': [
        'builtin',
        'external',
        'internal',
        'parent',
        'sibling',
        'index'
      ],
      'newlines-between': 'always',
      'alphabetize': {
        'order': 'asc',
        'caseInsensitive': true
      }
    }],
    'import/no-unresolved': 'off', // Handled by TypeScript
    'import/no-unused-modules': 'warn',
    
    // General JavaScript/TypeScript
    'no-console': 'warn',
    'no-debugger': 'error',
    'no-duplicate-imports': 'error',
    'no-unused-expressions': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    'prefer-arrow-callback': 'error',
    'prefer-template': 'error',
    
    // Code style
    'curly': ['error', 'all'],
    'eqeqeq': ['error', 'always', { null: 'ignore' }],
    'no-else-return': 'error',
    'no-return-await': 'error',
    'require-await': 'error',
    
    // Error handling
    'prefer-promise-reject-errors': 'error',
    'no-throw-literal': 'error'
  },
  settings: {
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
        project: './tsconfig.json'
      }
    }
  },
  overrides: [
    // React specific rules
    {
      files: ['*.tsx', '*.jsx'],
      extends: [
        'plugin:react/recommended',
        'plugin:react-hooks/recommended'
      ],
      plugins: ['react', 'react-hooks'],
      settings: {
        react: {
          version: 'detect'
        }
      },
      rules: {
        'react/react-in-jsx-scope': 'off', // Not needed in React 17+
        'react/prop-types': 'off', // Using TypeScript
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
        'react/jsx-boolean-value': ['error', 'never'],
        'react/jsx-curly-brace-presence': ['error', { props: 'never', children: 'never' }],
        'react/self-closing-comp': 'error'
      }
    },
    // Node.js specific rules
    {
      files: ['**/apps/api/**/*.ts'],
      extends: ['plugin:node/recommended'],
      plugins: ['node'],
      rules: {
        'node/no-missing-import': 'off', // Handled by TypeScript
        'node/no-unsupported-features/es-syntax': 'off', // Using TypeScript compilation
        'node/no-unpublished-import': 'off' // Dev dependencies are fine
      }
    },
    // Test files
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
      env: {
        jest: true
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off'
      }
    },
    // Configuration files
    {
      files: ['*.js', '*.cjs', '*.mjs'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        'no-console': 'off'
      }
    }
  ]
};