import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@api/(.*)$': '<rootDir>/src/api/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@models/(.*)$': '<rootDir>/src/models/$1',
    '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@logger/(.*)$': '<rootDir>/src/logger/$1',
    '^@monitoring/(.*)$': '<rootDir>/src/monitoring/$1',
    '^@security/(.*)$': '<rootDir>/src/security/$1',
    '^@cache/(.*)$': '<rootDir>/src/cache/$1',
    '^@db/(.*)$': '<rootDir>/src/db/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@freshness/(.*)$': '<rootDir>/src/freshness/$1',
    '^@ingestion/(.*)$': '<rootDir>/src/ingestion/$1',
    '^@jobs/(.*)$': '<rootDir>/src/jobs/$1',
    '^@queue/(.*)$': '<rootDir>/src/queue/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',            // Entry point — skip
    '!src/**/*.types.ts',        // Type definitions — skip
    '!src/db/seeds/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: [],
  testTimeout: 30000,
  verbose: true,
};

export default config;
