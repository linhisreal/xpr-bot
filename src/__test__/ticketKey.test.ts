import { getTicketKeyFromIds, getTicketKeyFromTicket } from '../modules/ticketKey';
import { Ticket } from '../bot/ticketManager';

function createTestTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    guildId: 'guild123',
    userId: 'user123',
    channelId: 'channel123',
    ticketNumber: 1,
    createdAt: new Date(),
    isLocked: false,
    channelName: 'ticket-test',
    isThread: false,
    ...overrides
  };
}

describe('TicketKey Module', () => {
  describe('getTicketKeyFromIds', () => {
    test('should generate key from channel ID only', () => {
      const result = getTicketKeyFromIds('channel123');
      expect(result).toBe('channel123');
    });

    test('should generate key from channel and thread ID', () => {
      const result = getTicketKeyFromIds('channel123', 'thread456');
      expect(result).toBe('thread456');
    });

    test('should handle empty thread ID', () => {
      const result = getTicketKeyFromIds('channel123', '');
      expect(result).toBe('channel123');
    });

    test('should handle null thread ID', () => {
      const result = getTicketKeyFromIds('channel123');
      expect(result).toBe('channel123');
    });

    test('should handle undefined thread ID', () => {
      const result = getTicketKeyFromIds('channel123', undefined);
      expect(result).toBe('channel123');
    });
  });

  describe('getTicketKeyFromTicket', () => {
    test('should generate key from ticket with channel only', () => {
      const ticket = createTestTicket({
        channelId: 'channel123'
      });
      const result = getTicketKeyFromTicket(ticket);
      expect(result).toBe('channel123');
    });

    test('should generate key from ticket with channel and thread', () => {
      const ticket = createTestTicket({
        channelId: 'channel123',
        threadId: 'thread456'
      });
      const result = getTicketKeyFromTicket(ticket);
      expect(result).toBe('thread456');
    });

    test('should handle ticket with empty thread ID', () => {
      const ticket = createTestTicket({
        channelId: 'channel123',
        threadId: ''
      });
      const result = getTicketKeyFromTicket(ticket);
      expect(result).toBe('channel123');
    });

    test('should handle ticket with null thread ID', () => {
      const ticket = createTestTicket({
        channelId: 'channel123',
        threadId: undefined
      });
      const result = getTicketKeyFromTicket(ticket);
      expect(result).toBe('channel123');
    });

    test('should handle ticket with undefined thread ID', () => {
      const ticket = createTestTicket({
        channelId: 'channel123',
        threadId: undefined
      });
      const result = getTicketKeyFromTicket(ticket);
      expect(result).toBe('channel123');
    });

    test('should handle ticket with missing thread property', () => {
      const ticket = createTestTicket({
        channelId: 'channel123'
      });
      const result = getTicketKeyFromTicket(ticket);
      expect(result).toBe('channel123');
    });
  });

  describe('Key Consistency', () => {
    test('should generate same key from IDs and ticket object', () => {
      const channelId = 'channel123';
      const threadId = 'thread456';
      
      const keyFromIds = getTicketKeyFromIds(channelId, threadId);
      const keyFromTicket = getTicketKeyFromTicket(createTestTicket({ channelId, threadId }));
      
      expect(keyFromIds).toBe(keyFromTicket);
    });

    test('should generate same key for channel-only tickets', () => {
      const channelId = 'channel123';
      
      const keyFromIds = getTicketKeyFromIds(channelId);
      const keyFromTicket = getTicketKeyFromTicket(createTestTicket({ channelId }));
      
      expect(keyFromIds).toBe(keyFromTicket);
    });

    test('should handle special characters in IDs', () => {
      const channelId = 'channel_123-test';
      const threadId = 'thread_456-test';
      
      const result = getTicketKeyFromIds(channelId, threadId);
      expect(result).toBe('thread_456-test');
    });

    test('should handle numeric IDs', () => {
      const channelId = '1234567890';
      const threadId = '0987654321';
      
      const result = getTicketKeyFromIds(channelId, threadId);
      expect(result).toBe('0987654321');
    });
  });

  describe('Edge Cases', () => {
    test('should handle very long IDs', () => {
      const longChannelId = 'a'.repeat(100);
      const longThreadId = 'b'.repeat(100);
      
      const result = getTicketKeyFromIds(longChannelId, longThreadId);
      expect(result).toBe(longThreadId);
    });

    test('should handle empty channel ID', () => {
      const result = getTicketKeyFromIds('', 'thread123');
      expect(result).toBe('thread123');
    });

    test('should preserve whitespace in IDs', () => {
      const result = getTicketKeyFromIds('channel 123', 'thread 456');
      expect(result).toBe('thread 456');
    });

    test('should handle colon in channel ID', () => {
      const result = getTicketKeyFromIds('channel:with:colon', 'thread123');
      expect(result).toBe('thread123');
    });
  });
});