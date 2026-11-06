/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testRegex: '(test/.*\\.e2e-spec|src/.*\\.spec)\\.ts$',
  moduleNameMapper: { '^@gestion/shared$': '<rootDir>/../../packages/shared/src' },
  setupFiles: ['<rootDir>/test/env.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/reloj.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  testTimeout: 30000,
  maxWorkers: 1,
};
