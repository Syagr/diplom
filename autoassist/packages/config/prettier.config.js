module.exports = {
  // Line width that prettier will wrap on
  printWidth: 80,
  
  // Number of spaces per indentation-level
  tabWidth: 2,
  
  // Use tabs instead of spaces
  useTabs: false,
  
  // Print semicolons at the ends of statements
  semi: true,
  
  // Use single quotes instead of double quotes
  singleQuote: true,
  
  // Change when properties in objects are quoted
  quoteProps: 'as-needed',
  
  // Use single quotes in JSX
  jsxSingleQuote: true,
  
  // Print trailing commas wherever possible when multi-line
  trailingComma: 'es5',
  
  // Print spaces between brackets in object literals
  bracketSpacing: true,
  
  // Put the `>` of a multi-line JSX element at the end of the last line
  bracketSameLine: false,
  
  // Include parentheses around a sole arrow function parameter
  arrowParens: 'always',
  
  // Range of characters to format
  rangeStart: 0,
  rangeEnd: Infinity,
  
  // Which parser to use
  parser: undefined,
  
  // Path to prettier config file
  filepath: undefined,
  
  // Whether to add a newline at the end of files
  insertPragma: false,
  
  // Whether to add a @format pragma
  requirePragma: false,
  
  // How to wrap prose
  proseWrap: 'preserve',
  
  // How to handle whitespace in HTML
  htmlWhitespaceSensitivity: 'css',
  
  // Which end of line characters to apply
  endOfLine: 'lf',
  
  // Control whether Prettier formats quoted code embedded in the file
  embeddedLanguageFormatting: 'auto',
  
  // Override settings for specific file types
  overrides: [
    {
      files: '*.json',
      options: {
        printWidth: 120,
        tabWidth: 2
      }
    },
    {
      files: '*.md',
      options: {
        printWidth: 120,
        proseWrap: 'always',
        tabWidth: 2
      }
    },
    {
      files: '*.yml',
      options: {
        tabWidth: 2,
        singleQuote: false
      }
    },
    {
      files: '*.yaml',
      options: {
        tabWidth: 2,
        singleQuote: false
      }
    },
    {
      files: '*.tsx',
      options: {
        jsxSingleQuote: true,
        bracketSameLine: false
      }
    },
    {
      files: '*.jsx',
      options: {
        jsxSingleQuote: true,
        bracketSameLine: false
      }
    }
  ]
};