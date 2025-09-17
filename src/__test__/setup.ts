/**
 * Jest test setup file
 * Configures test environment and mocks
 */

const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info
};

(global as any).originalConsole = originalConsole;

beforeEach(() => {
  if (!expect.getState().currentTestName?.includes('console')) {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

(global as any).testUtils = {
  withConsole: (fn: () => void) => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    
    try {
      fn();
    } finally {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'info').mockImplementation(() => {});
    }
  }
};