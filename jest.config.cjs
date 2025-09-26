module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__test__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  testPathIgnorePatterns: [
    '<rootDir>/src/__test__/setup.ts',
    '<rootDir>/src/__test__/testUtils.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/index.ts',
    '!src/__test__/setup.ts',
    '!src/__test__/testUtils.ts'
  ],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'CommonJS',
        target: 'ES2020'
      }
    }]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true
    }
  },
  // Suppress console output during tests for cleaner test runs
  silent: false,
  verbose: false,
  setupFilesAfterEnv: ['<rootDir>/src/__test__/setup.ts'],
  // Force exit to prevent hanging
  forceExit: true,
  // Detect open handles
  detectOpenHandles: true
};
