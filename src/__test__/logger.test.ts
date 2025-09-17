import * as logger from '../utils/logger';

describe('Logger Utility', () => {
  const originalMethods = {
    log: console.log,
    info: console.info, 
    warn: console.warn,
    error: console.error,
    debug: (console as any).debug
  };

  let capturedOutput: string[] = [];

  beforeEach(() => {
    logger.reset();
    
    capturedOutput = [];
    
    console.log = originalMethods.log;
    console.info = originalMethods.info;
    console.warn = originalMethods.warn;
    console.error = originalMethods.error;
    (console as any).debug = originalMethods.debug;
  });

  afterEach(() => {
    logger.reset();
    console.log = originalMethods.log;
    console.info = originalMethods.info;
    console.warn = originalMethods.warn;
    console.error = originalMethods.error;
    (console as any).debug = originalMethods.debug;
  });

  const createLogCapture = () => {
    return (...args: any[]) => {
      capturedOutput.push(args.map(arg => String(arg)).join(' '));
    };
  };

  describe('Installation and Configuration', () => {
    test('should install logger successfully', () => {
      const captureFn = createLogCapture();
      console.log = captureFn;
      
      logger.install();
      
      console.log('Test message');
      expect(capturedOutput.length).toBeGreaterThan(0);
      expect(capturedOutput[0]).toContain('Test message');
    });

    test('should set log level correctly', () => {
      console.log = originalMethods.log;
      console.error = originalMethods.error;
      
      const logSpy = jest.fn();
      const errorSpy = jest.fn();
      
      console.log = logSpy;
      console.error = errorSpy;
      
      logger.install();
      logger.setLogLevel('ERROR');
      
      console.log('This should not appear');
      console.error('This should appear');
      
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledTimes(0);
      
      logger.reset();
      console.log = originalMethods.log;
      console.error = originalMethods.error;
    });
  });

  describe('Event Tracking', () => {
    beforeEach(() => {
      const captureFn = createLogCapture();
      console.info = captureFn;
      logger.install();
    });

    test('should start event tracking', () => {
      const event = logger.startEvent('test-event', 'Test Event', { meta: 'data' });
      
      expect(event).toEqual({
        id: 'test-event',
        name: 'Test Event',
        startedAt: expect.any(String),
        steps: [],
        metadata: { meta: 'data' }
      });
      
      expect(capturedOutput.some(msg => 
        msg.includes('{"event":"start","id":"test-event","name":"Test Event"')
      )).toBe(true);
    });

    test('should track event steps', () => {
      logger.startEvent('test-event', 'Test Event');
      capturedOutput = [];
      
      logger.stepEvent('test-event', 'step-1', 'in-progress', 'Starting step');
      
      expect(capturedOutput.some(msg => 
        msg.includes('{"event":"step","id":"test-event"')
      )).toBe(true);
    });

    test('should finish events', () => {
      logger.startEvent('test-event', 'Test Event');
      logger.stepEvent('test-event', 'step-1', 'success');
      capturedOutput = [];
      
      logger.finishEvent('test-event', 'success', 'Completed successfully');
      
      expect(capturedOutput.some(msg => 
        msg.includes('{"event":"finish","id":"test-event","finalStatus":"success"')
      )).toBe(true);
    });
  });

  describe('Interactive Features', () => {
    test('should set interactive mode', () => {
      expect(() => logger.setInteractiveEnabled(true)).not.toThrow();
      expect(() => logger.setInteractiveEnabled(false)).not.toThrow();
    });

    test('should handle interactive prompts when disabled', async () => {
      logger.setInteractiveEnabled(false);
      
      const result = await logger.promptInteractive('test', 'Continue?', ['yes', 'no']);
      expect(result).toBeNull();
    });
  });

  describe('Log Formatting', () => {
    beforeEach(() => {
      const captureFn = createLogCapture();
      console.log = captureFn;
      console.info = captureFn;
      logger.setLogLevel('DEBUG');
      logger.install();
    });

    test('should format messages with timestamp and level', () => {
      console.info('Test message');
      
      expect(capturedOutput.length).toBeGreaterThan(0);
      expect(capturedOutput[0]).toMatch(/\[.*\] INFO: Test message/);
    });

    test('should handle multiple arguments', () => {
      console.log('Message', { key: 'value' }, 123);
      
      expect(capturedOutput.length).toBeGreaterThan(0);
      expect(capturedOutput[0]).toMatch(/\[.*\] INFO: Message/);
      expect(capturedOutput[0]).toContain('[object Object]');
      expect(capturedOutput[0]).toContain('123');
    });

    test('should handle empty messages', () => {
      console.log();
      
      expect(capturedOutput.length).toBeGreaterThan(0);
      expect(capturedOutput[0]).toMatch(/\[.*\] INFO:/);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    beforeEach(() => {
      const captureFn = createLogCapture();
      console.log = captureFn;
      logger.install();
    });

    test('should handle null and undefined arguments', () => {
      expect(() => {
        console.log(null, undefined, 'test');
      }).not.toThrow();
      
      expect(capturedOutput.length).toBeGreaterThan(0);
      expect(capturedOutput[0]).toContain('null');
      expect(capturedOutput[0]).toContain('undefined');
      expect(capturedOutput[0]).toContain('test');
    });

    test('should handle objects and arrays', () => {
      const obj = { key: 'value' };
      const arr = [1, 2, 3];
      
      console.log('Object:', obj, 'Array:', arr);
      
      expect(capturedOutput.length).toBeGreaterThan(0);
      expect(capturedOutput[0]).toContain('Object:');
      expect(capturedOutput[0]).toContain('Array:');
    });

    test('should handle very long strings', () => {
      const longString = 'a'.repeat(1000);
      
      expect(() => {
        console.log(longString);
      }).not.toThrow();
      
      expect(capturedOutput.length).toBeGreaterThan(0);
      expect(capturedOutput[0]).toContain('aaa');
    });

    test('should handle special characters in messages', () => {
      const specialChars = '!@#$%^&*()[]{}|;:,.<>?';
      
      console.log(specialChars);
      
      expect(capturedOutput.length).toBeGreaterThan(0);
      expect(capturedOutput[0]).toContain(specialChars);
    });
  });

  describe('Performance and Memory', () => {
    test('should handle rapid logging', () => {
      const captureFn = createLogCapture();
      console.log = captureFn;
      logger.install();
      
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        console.log(`Message ${i}`);
      }
      const end = Date.now();
      
      expect(capturedOutput.length).toBe(100);
      expect(end - start).toBeLessThan(1000);
    });
  });

  describe('Integration Tests', () => {
    test('should work with real console methods after reset', () => {
      logger.install();
      logger.reset();
      
      const logSpy = jest.spyOn(console, 'log');
      console.log('Test after reset');
      
      expect(logSpy).toHaveBeenCalledWith('Test after reset');
      logSpy.mockRestore();
    });

    test('should maintain separate event contexts', () => {
      const captureFn = createLogCapture();
      console.info = captureFn;
      logger.install();
      
      logger.startEvent('event-1', 'Event One');
      logger.startEvent('event-2', 'Event Two');
      
      logger.stepEvent('event-1', 'step-1', 'success');
      logger.stepEvent('event-2', 'step-1', 'failed');
      
      logger.finishEvent('event-1', 'success');
      logger.finishEvent('event-2', 'failed');
      
      expect(capturedOutput.length).toBe(6);
    });
  });
});