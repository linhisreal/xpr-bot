import { InteractionManager } from '../modules/InteractionManager';
import { User } from 'discord.js';

function createMockInteraction(type: 'button' | 'modal' | 'command', overrides: any = {}): any {
  const baseInteraction = {
    id: `interaction_${Date.now()}_${Math.random()}`,
    user: { id: 'user123' } as User,
    replied: false,
    deferred: false,
    guild: { id: 'guild123' },
    channel: { id: 'channel123' },
    customId: type === 'command' ? undefined : 'test_button',
    reply: jest.fn().mockResolvedValue({}),
    followUp: jest.fn().mockResolvedValue({}),
    deferReply: jest.fn().mockResolvedValue({}),
    editReply: jest.fn().mockResolvedValue({}),
    showModal: jest.fn().mockResolvedValue({}),
    isRepliable: jest.fn().mockReturnValue(true),
    isButton: jest.fn().mockReturnValue(type === 'button'),
    isModalSubmit: jest.fn().mockReturnValue(type === 'modal'),
    isChatInputCommand: jest.fn().mockReturnValue(type === 'command'),
    ...overrides
  };

  if (type === 'command') {
    baseInteraction.commandName = 'test';
    baseInteraction.options = { getString: jest.fn(), getUser: jest.fn() };
  }

  return baseInteraction;
}

describe('InteractionManager', () => {
  let interactionManager: InteractionManager;

  beforeEach(() => {
    interactionManager = new InteractionManager();
  });

  afterEach(() => {
    interactionManager.destroy();
  });

  describe('safeReply', () => {
    test('should successfully reply to unreplied interaction', async () => {
      const mockInteraction = createMockInteraction('button');
      
      const result = await interactionManager.safeReply(mockInteraction, { content: 'Test reply' });
      
      expect(result).toBe(true);
      expect(mockInteraction.reply).toHaveBeenCalledWith({ content: 'Test reply' });
    });

    test('should handle InteractionAlreadyReplied error by following up', async () => {
      const mockInteraction = createMockInteraction('button');
      const error = new Error('InteractionAlreadyReplied');
      
      mockInteraction.replied = false;
      
      mockInteraction.reply.mockImplementationOnce(async () => {
        mockInteraction.replied = true;
        throw error;
      });
      
      interactionManager.trackInteraction(mockInteraction);
      
      const result = await interactionManager.safeReply(mockInteraction, { content: 'Test reply' });
      
      expect(result).toBe(true);
      expect(mockInteraction.reply).toHaveBeenCalledWith({ content: 'Test reply' });
      expect(mockInteraction.followUp).toHaveBeenCalledWith({ content: 'Test reply' });
    });

    test('should return false on other errors', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.reply.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await interactionManager.safeReply(mockInteraction, { content: 'Test reply' });
      
      expect(result).toBe(false);
    });
  });

  describe('safeFollowUp', () => {
    test('should successfully send follow-up on replied interaction', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.replied = true;
      
      interactionManager.trackInteraction(mockInteraction);
      
      const result = await interactionManager.safeFollowUp(mockInteraction, { content: 'Follow up' });
      
      expect(result).toBe(true);
      expect(mockInteraction.followUp).toHaveBeenCalledWith({ content: 'Follow up' });
    });

    test('should successfully send follow-up on deferred interaction', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.deferred = true;
      
      interactionManager.trackInteraction(mockInteraction);
      
      const result = await interactionManager.safeFollowUp(mockInteraction, { content: 'Follow up' });
      
      expect(result).toBe(true);
      expect(mockInteraction.followUp).toHaveBeenCalledWith({ content: 'Follow up' });
    });

    test('should return false if interaction is not replied or deferred', async () => {
      const mockInteraction = createMockInteraction('button');
      
      const result = await interactionManager.safeFollowUp(mockInteraction, { content: 'Follow up' });
      
      expect(result).toBe(false);
      expect(mockInteraction.followUp).not.toHaveBeenCalled();
    });

    test('should return false on followUp error', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.replied = true;
      mockInteraction.followUp.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await interactionManager.safeFollowUp(mockInteraction, { content: 'Follow up' });
      
      expect(result).toBe(false);
    });
  });

  describe('safeRespond', () => {
    test('should reply when interaction is not replied or deferred', async () => {
      const mockInteraction = createMockInteraction('button');
      
      const result = await interactionManager.safeRespond(mockInteraction, { content: 'Test response' });
      
      expect(result).toBe(true);
      expect(mockInteraction.reply).toHaveBeenCalledWith({ content: 'Test response', ephemeral: true });
    });

    test('should edit reply when interaction is deferred', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.deferred = true;
      
      interactionManager.trackInteraction(mockInteraction);
      
      const result = await interactionManager.safeRespond(mockInteraction, { content: 'Test response' });
      
      expect(result).toBe(true);
      expect(mockInteraction.editReply).toHaveBeenCalledWith({ content: 'Test response' });
    });

    test('should follow up when interaction is already replied', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.replied = true;
      
      interactionManager.trackInteraction(mockInteraction);
      
      const result = await interactionManager.safeRespond(mockInteraction, { content: 'Test response' });
      
      expect(result).toBe(true);
      expect(mockInteraction.followUp).toHaveBeenCalledWith({ content: 'Test response' });
    });

    test('should return false on error', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.reply.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await interactionManager.safeRespond(mockInteraction, { content: 'Test response' });
      
      expect(result).toBe(false);
    });
  });

  describe('safeEditReply', () => {
    test('should successfully edit deferred reply', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.deferred = true;
      
      interactionManager.trackInteraction(mockInteraction);
      
      const result = await interactionManager.safeEditReply(mockInteraction, { content: 'Edited reply' });
      
      expect(result).toBe(true);
      expect(mockInteraction.editReply).toHaveBeenCalledWith({ content: 'Edited reply' });
    });

    test('should return false if interaction is not deferred', async () => {
      const mockInteraction = createMockInteraction('button');
      
      const result = await interactionManager.safeEditReply(mockInteraction, { content: 'Edited reply' });
      
      expect(result).toBe(false);
      expect(mockInteraction.editReply).not.toHaveBeenCalled();
    });

    test('should return false on editReply error', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.deferred = true;
      mockInteraction.editReply.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await interactionManager.safeEditReply(mockInteraction, { content: 'Edited reply' });
      
      expect(result).toBe(false);
    });
  });

  describe('safeDefer', () => {
    test('should successfully defer reply for unreplied interaction', async () => {
      const mockInteraction = createMockInteraction('button');
      
      const result = await interactionManager.safeDefer(mockInteraction, { ephemeral: true });
      
      expect(result).toBe(true);
      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    test('should return false if interaction is already replied', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.replied = true;
      
      const result = await interactionManager.safeDefer(mockInteraction);
      
      expect(result).toBe(false);
      expect(mockInteraction.deferReply).not.toHaveBeenCalled();
    });

    test('should return false if interaction is already deferred', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.deferred = true;
      
      const result = await interactionManager.safeDefer(mockInteraction);
      
      expect(result).toBe(false);
      expect(mockInteraction.deferReply).not.toHaveBeenCalled();
    });

    test('should return false on deferReply error', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.deferReply.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await interactionManager.safeDefer(mockInteraction);
      
      expect(result).toBe(false);
    });
  });

  describe('immediateDefer', () => {
    test('should successfully defer reply immediately', async () => {
      const mockInteraction = createMockInteraction('button');
      
      const result = await interactionManager.immediateDefer(mockInteraction, { ephemeral: true });
      
      expect(result).toBe(true);
      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    test('should handle network errors gracefully', async () => {
      const mockInteraction = createMockInteraction('button');
      mockInteraction.deferReply.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await interactionManager.immediateDefer(mockInteraction);
      
      expect(result).toBe(false);
    });

    test('should handle expired interaction error (10062)', async () => {
      const mockInteraction = createMockInteraction('button');
      const error = new Error('Interaction expired') as any;
      error.code = 10062;
      mockInteraction.deferReply.mockRejectedValueOnce(error);
      
      const result = await interactionManager.immediateDefer(mockInteraction);
      
      expect(result).toBe(false);
    });

    test('should handle already acknowledged error (40060)', async () => {
      const mockInteraction = createMockInteraction('button');
      const error = new Error('Interaction already acknowledged') as any;
      error.code = 40060;
      mockInteraction.deferReply.mockRejectedValueOnce(error);
      
      const result = await interactionManager.immediateDefer(mockInteraction);
      
      expect(result).toBe(false);
    });
  });
});