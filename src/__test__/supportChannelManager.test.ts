 import { SupportChannelManager } from '../modules/SupportChannelManager';

const CHANNEL_ID = 'channel123';
const TEST_CHANNEL_ID = 'testchannel123';
const STRICT_CHANNEL_ID = 'strictchannel123';

const TEST_CHANNEL_IDS = [CHANNEL_ID, TEST_CHANNEL_ID, STRICT_CHANNEL_ID, 'sendconfig123'];

function createMockChannel(overrides?: Partial<any>) {
  return {
    id: CHANNEL_ID,
    send: jest.fn().mockResolvedValue(true),
    ...overrides,
  } as any;
}

function createMockMessage(contentOrOverrides: string | any, channelId: string = 'test-channel'): any {
  if (typeof contentOrOverrides === 'string') {
    return {
      id: 'test-message-id',
      content: contentOrOverrides,
      author: { 
        bot: false,
        createDM: jest.fn().mockResolvedValue({
          send: jest.fn().mockResolvedValue({
            delete: jest.fn().mockResolvedValue(undefined)
          })
        })
      },
      channel: { id: channelId },
      attachments: new Map(),
      delete: jest.fn().mockResolvedValue(undefined)
    };
  } else {
    return {
      id: 'test-message-id',
      content: '',
      author: { 
        bot: false,
        createDM: jest.fn().mockResolvedValue({
          send: jest.fn().mockResolvedValue({
            delete: jest.fn().mockResolvedValue(undefined)
          })
        })
      },
      channel: { id: 'test-channel' },
      attachments: new Map(),
      delete: jest.fn().mockResolvedValue(undefined),
      ...contentOrOverrides
    };
  }
}

/**
 * Cleanup function to remove test channels from the configuration
 */
function cleanupTestChannels(supportChannelManager: SupportChannelManager) {
  try {
    supportChannelManager.removeTestChannels(TEST_CHANNEL_IDS);
  } catch (error) {
    console.warn('Failed to cleanup test channels:', error);
  }
}

describe('SupportChannelManager Basic Functionality', () => {
  let supportChannelManager: SupportChannelManager;

  beforeAll(() => {
    const tempInstance = new SupportChannelManager();
    tempInstance.backupConfigurationFile();
  });

  afterAll(() => {
    const tempInstance = new SupportChannelManager();
    tempInstance.restoreConfigurationFile();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    supportChannelManager = new SupportChannelManager();
    supportChannelManager.clearAllConfigurations();
  });

  afterEach(() => {
    cleanupTestChannels(supportChannelManager);
  });

  describe('Configuration Management', () => {
    test('should track support channel configurations', async () => {
      const mockChannel = createMockChannel({ id: CHANNEL_ID });

      const result = await supportChannelManager.configureSupportChannel(mockChannel, {
        autoTicketCreation: true,
        deleteUserMessages: true,
        strictFiltering: false,
        ticketCategory: 'Support Tickets'
      });

      expect(result).toBe(true);
      
      
      const config = supportChannelManager.getSupportChannelConfig(CHANNEL_ID);
      expect(config).toBeDefined();
      expect(config?.autoTicketCreation).toBe(true);
      expect(config?.deleteUserMessages).toBe(true);
      expect(config?.strictFiltering).toBe(false);
      expect(config?.ticketCategory).toBe('Support Tickets');
    });

    test('should check if channel is configured', async () => {
      const mockChannel = createMockChannel({ id: CHANNEL_ID });

      expect(supportChannelManager.isSupportChannel(CHANNEL_ID)).toBe(false);

      await supportChannelManager.configureSupportChannel(mockChannel, {
        autoTicketCreation: true
      });
      expect(supportChannelManager.isSupportChannel(CHANNEL_ID)).toBe(true);
    });

    test('should update existing configurations', async () => {
      const mockChannel = createMockChannel({ id: CHANNEL_ID });

      await supportChannelManager.configureSupportChannel(mockChannel, {
        autoTicketCreation: true,
        strictFiltering: false
      });

      
      const updated = supportChannelManager.updateSupportChannelConfig('channel123', {
        strictFiltering: true,
        ticketCategory: 'Updated Category'
      });

      expect(updated).toBe(true);
      
      const config = supportChannelManager.getSupportChannelConfig(CHANNEL_ID);
      expect(config?.strictFiltering).toBe(true);
      expect(config?.ticketCategory).toBe('Updated Category');
      expect(config?.autoTicketCreation).toBe(true); 
    });

    test('should remove support channel configurations', async () => {
      const mockChannel = createMockChannel({ id: CHANNEL_ID });

      await supportChannelManager.configureSupportChannel(mockChannel, {
        autoTicketCreation: true
      });
      expect(supportChannelManager.isSupportChannel(CHANNEL_ID)).toBe(true);

      const removed = supportChannelManager.removeSupportChannel(CHANNEL_ID);
      expect(removed).toBe(true);
      expect(supportChannelManager.isSupportChannel(CHANNEL_ID)).toBe(false);
    });

    test('should send configuration message when requested', async () => {
      const mockChannel = createMockChannel({ id: 'sendconfig123' });

      const result = await supportChannelManager.configureSupportChannel(mockChannel, {
        autoTicketCreation: true
      }, true);

      expect(result).toBe(true);
      expect(mockChannel.send).toHaveBeenCalled();

      const manual = await supportChannelManager.sendManualConfigurationMessage(mockChannel);
      expect(manual).toBe(true);
      expect(mockChannel.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('Message Processing Logic', () => {
    let configuredChannel: any;
    beforeEach(async () => {
      configuredChannel = createMockChannel({ id: TEST_CHANNEL_ID });

      await supportChannelManager.configureSupportChannel(configuredChannel, {
        autoTicketCreation: true,
        deleteUserMessages: true,
        strictFiltering: false
      });
    });

    test.each([
      ['bot message is ignored', { author: { bot: true }, channel: { id: TEST_CHANNEL_ID } }, false, false],
      ['system message is ignored', { system: true, channel: { id: TEST_CHANNEL_ID } }, false, false],
      ['unconfigured channel is ignored', { channel: { id: 'unconfigured123' } }, false, false],
      ['short message in permissive mode creates ticket', { content: 'hi', channel: { id: TEST_CHANNEL_ID } }, true, true],
      ['spam phrase is rejected', { content: 'test', channel: { id: TEST_CHANNEL_ID } }, false, true],
      ['empty message without attachments is rejected', { content: '', channel: { id: TEST_CHANNEL_ID }, attachments: { size: 0 } }, false, true]
    ])('%s', async (_desc, overrides, expectedShouldCreate, expectedDeleted) => {
      const mockMessage = createMockMessage(overrides as any);

      const result = await supportChannelManager.processMessage(mockMessage as any);
      expect(result.success).toBe(true);
      expect(result.shouldCreateTicket).toBe(expectedShouldCreate);

      if (expectedDeleted) {
        expect(mockMessage.delete).toHaveBeenCalled();
      } else {
        expect(mockMessage.delete).not.toHaveBeenCalled();
      }

      // Note: configuredChannel.send is not expected to be called by processMessage
    });
  });

  describe('Strict vs Permissive Filtering', () => {
    test('should handle strictFiltering configuration correctly', async () => {
      const mockChannel = createMockChannel({ id: STRICT_CHANNEL_ID });

      await supportChannelManager.configureSupportChannel(mockChannel, {
        autoTicketCreation: true
      });

      let config = supportChannelManager.getSupportChannelConfig(STRICT_CHANNEL_ID);
      expect(config?.strictFiltering).toBe(false);

      supportChannelManager.updateSupportChannelConfig(STRICT_CHANNEL_ID, {
        strictFiltering: true
      });

      config = supportChannelManager.getSupportChannelConfig(STRICT_CHANNEL_ID);
      expect(config?.strictFiltering).toBe(true);
    });

    test('should reject short messages in strict mode', async () => {
      const mockChannel = createMockChannel({ id: STRICT_CHANNEL_ID });

      await supportChannelManager.configureSupportChannel(mockChannel, {
        autoTicketCreation: true,
        strictFiltering: true
      });

      const mockMessage = createMockMessage('hi', STRICT_CHANNEL_ID);

      const result = await supportChannelManager.processMessage(mockMessage as any);
      expect(result.success).toBe(true);
      expect(result.shouldCreateTicket).toBe(false);
    });

    test('should accept longer messages in strict mode', async () => {
      const mockChannel = createMockChannel({ id: STRICT_CHANNEL_ID });

      await supportChannelManager.configureSupportChannel(mockChannel, {
        autoTicketCreation: true,
        strictFiltering: true
      });

      const mockMessage = createMockMessage('I need help with my account settings please', STRICT_CHANNEL_ID);

      const result = await supportChannelManager.processMessage(mockMessage as any);
      expect(result.success).toBe(true);
      expect(result.shouldCreateTicket).toBe(true);
    });
  });
});