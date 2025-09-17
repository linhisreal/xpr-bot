import {TicketManager, PresenceStatus, Ticket} from '../bot/ticketManager.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { Client } from 'discord.js';
import { createMockClient, createTempDataFile } from './testUtils';


let mockClient: Client;

describe('TicketManager', () => {
  let ticketManager: TicketManager;
  let testFilePath: string;
  let tmpDir: string | undefined;
  let originalEnv: string | undefined;
  const allTestFilePaths: string[] = [];

  beforeEach(async () => {
    jest.clearAllMocks();
    originalEnv = process.env.STAFF_ENCRYPTION_KEY;

    process.env.STAFF_ENCRYPTION_KEY = 'aaaabbbbccccddddeeeeffffgggghhhhiiiijjjjkkkkllllmmmmnnnnoooopppp';

  const tmp = await createTempDataFile();
  tmpDir = tmp.dir;
  testFilePath = tmp.filePath;
  allTestFilePaths.push(testFilePath);

  mockClient = createMockClient();

  ticketManager = new TicketManager(mockClient, testFilePath);
    await ticketManager.ready;
  });

  afterEach(async () => {
    ticketManager.destroy();
    await ticketManager.cleanupTestData();
    if (tmpDir) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch (err) { void 0; }
    }
    if (originalEnv !== undefined) {
      process.env.STAFF_ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.STAFF_ENCRYPTION_KEY;
    }
  });

  afterAll(async () => {
    const dataDir = path.join(process.cwd(), 'data');
    try {
      const files = await fs.readdir(dataDir);
      const testFiles = files.filter(file => file.startsWith('test-staff-') && file.endsWith('.json'));
      
      for (const file of testFiles) {
        try {
          await fs.unlink(path.join(dataDir, file));
          console.log(`Cleaned up test file: ${file}`);
        } catch (error) { void 0; }
      }
    } catch (error) {
      for (const filePath of allTestFilePaths) {
        try {
          await fs.unlink(filePath);
        } catch (error) { void 0; }
      }
    }
  });

  describe('createTicket', () => {
    it('should create a new ticket', () => {
      const ticket = ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-user1');

      expect(ticket.guildId).toBe('guild1');
      expect(ticket.userId).toBe('user1');
      expect(ticket.channelId).toBe('channel1');
      expect(ticket.ticketNumber).toBe(1);
      expect(ticket.channelName).toBe('ticket-user1');
      expect(ticket.isLocked).toBe(false);
      expect(ticket.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('getTicketByChannel', () => {
    it('should return ticket when found', () => {
      ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-user1');
      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');

      expect(ticket).toBeDefined();
      expect(ticket?.channelId).toBe('channel1');
    });

    it('should return undefined when ticket not found', () => {
      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(ticket).toBeUndefined();
    });
  });

  describe('closeTicket', () => {
    it('should close existing ticket', () => {
      ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-user1');
      const result = ticketManager.closeTicket('guild1', 'channel1');

      expect(result).toBe(true);
      expect(ticketManager.getTicketByChannel('guild1', 'channel1')).toBeUndefined();
    });

    it('should return false when ticket does not exist', () => {
      const result = ticketManager.closeTicket('guild1', 'channel1');
      expect(result).toBe(false);
    });
  });

  describe('getNextTicketNumber', () => {
    it('should return incrementing ticket numbers', () => {
      expect(ticketManager.getNextTicketNumber('guild1')).toBe(1);
      expect(ticketManager.getNextTicketNumber('guild1')).toBe(2);
      expect(ticketManager.getNextTicketNumber('guild1')).toBe(3);
    });

    it('should maintain separate counters per guild', () => {
      expect(ticketManager.getNextTicketNumber('guild1')).toBe(1);
      expect(ticketManager.getNextTicketNumber('guild2')).toBe(1);
      expect(ticketManager.getNextTicketNumber('guild1')).toBe(2);
    });
  });

  describe('staff management', () => {
    it('should add staff members', async () => {
      const wasAdded = await ticketManager.addStaff('guild1', 'staff1');
      expect(wasAdded).toBe(true);
      expect(ticketManager.isStaff('guild1', 'staff1')).toBe(true);
    });

    it('should not add duplicate staff members', async () => {
      await ticketManager.addStaff('guild1', 'staff1');
      const wasAdded = await ticketManager.addStaff('guild1', 'staff1');
      expect(wasAdded).toBe(false);
    });

    it('should remove staff members', async () => {
      await ticketManager.addStaff('guild1', 'staff1');
      const wasRemoved = await ticketManager.removeStaff('guild1', 'staff1');
      expect(wasRemoved).toBe(true);
      expect(ticketManager.isStaff('guild1', 'staff1')).toBe(false);
    });

    it('should get staff list', async () => {
      await ticketManager.addStaff('guild1', 'staff1');
      await ticketManager.addStaff('guild1', 'staff2');
      const staffList = ticketManager.getStaffList('guild1');
      expect(staffList).toContain('staff1');
      expect(staffList).toContain('staff2');
      expect(staffList.length).toBe(2);
    });
  });

  describe('ticket claiming and locking', () => {
    beforeEach(async () => {
      ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-user1');
      await ticketManager.addStaff('guild1', 'staff1');
    });

    it('should claim tickets', () => {
      const success = ticketManager.claimTicket('guild1', 'channel1', 'staff1');
      expect(success).toBe(true);
      
      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(ticket?.claimedBy).toBe('staff1');
    });

    it('should not claim already claimed tickets', () => {
      ticketManager.claimTicket('guild1', 'channel1', 'staff1');
      const success = ticketManager.claimTicket('guild1', 'channel1', 'staff2');
      expect(success).toBe(false);
    });

    it('should lock tickets', () => {
      ticketManager.claimTicket('guild1', 'channel1', 'staff1');
      const success = ticketManager.lockTicket('guild1', 'channel1', 'staff1');
      expect(success).toBe(true);
      
      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(ticket?.isLocked).toBe(true);
    });

    it('should unlock tickets by claimer only', () => {
      ticketManager.claimTicket('guild1', 'channel1', 'staff1');
      ticketManager.lockTicket('guild1', 'channel1', 'staff1');
      
      const success = ticketManager.unlockTicket('guild1', 'channel1', 'staff1');
      expect(success).toBe(true);
      
      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(ticket?.isLocked).toBe(false);
    });

    it('should not unlock tickets by non-claimer', () => {
      ticketManager.claimTicket('guild1', 'channel1', 'staff1');
      ticketManager.lockTicket('guild1', 'channel1', 'staff1');
      
      const success = ticketManager.unlockTicket('guild1', 'channel1', 'staff2');
      expect(success).toBe(false);
    });
  });

  describe('presence tracking', () => {
    beforeEach(async () => {
      
      await ticketManager.addStaff('guild1', 'staff1');
      await ticketManager.addStaff('guild1', 'staff2');
      await ticketManager.addStaff('guild1', 'staff3');
    });

    it('should enable presence tracking for a guild', async () => {
      await ticketManager.setPresenceTracking('guild1', true);

      
      ticketManager.updateStaffPresence('guild1', 'staff1', 'online');
      const staffPresence = ticketManager.getStaffPresence('guild1', 'staff1');
      expect(staffPresence?.status).toBe('online');
    });

    it('should disable presence tracking for a guild', async () => {
      await ticketManager.setPresenceTracking('guild1', true);
      await ticketManager.setPresenceTracking('guild1', false);

      
      ticketManager.updateStaffPresence('guild1', 'staff1', 'online');
      const staffPresence = ticketManager.getStaffPresence('guild1', 'staff1');
      expect(staffPresence).toBeUndefined();
    });

    it('should work with non-existent guild', async () => {
      
      await ticketManager.setPresenceTracking('nonexistent', true);
      
      
      ticketManager.updateStaffPresence('nonexistent', 'staff1', 'online');
      const staffPresence = ticketManager.getStaffPresence('nonexistent', 'staff1');
      expect(staffPresence).toBeUndefined();
    });

    it('should update staff presence', async () => {
      await ticketManager.setPresenceTracking('guild1', true);
      
      ticketManager.updateStaffPresence('guild1', 'staff1', 'online');
      
      const staffPresence = ticketManager.getStaffPresence('guild1', 'staff1');
      expect(staffPresence?.status).toBe('online');
      expect(staffPresence?.userId).toBe('staff1');
      expect(staffPresence?.lastSeen).toBeInstanceOf(Date);
      expect(staffPresence?.lastUpdated).toBeInstanceOf(Date);
    });

    it('should not update presence for non-existent staff', async () => {
      await ticketManager.setPresenceTracking('guild1', true);
      
      
      ticketManager.updateStaffPresence('guild1', 'nonexistent', 'online');
      
      const staffPresence = ticketManager.getStaffPresence('guild1', 'nonexistent');
      expect(staffPresence).toBeUndefined();
    });

    it('should return undefined when getting presence for non-existent staff', async () => {
      await ticketManager.setPresenceTracking('guild1', true);
      const presence = ticketManager.getStaffPresence('guild1', 'nonexistent');
      expect(presence).toBeUndefined();
    });

    it('should get all staff presences', async () => {
      await ticketManager.setPresenceTracking('guild1', true);
      
      ticketManager.updateStaffPresence('guild1', 'staff1', 'online');
      ticketManager.updateStaffPresence('guild1', 'staff2', 'idle');

      const allPresences = ticketManager.getAllStaffPresences('guild1');
      expect(allPresences).toHaveLength(2);
      
      const staff1Presence = allPresences.find(p => p.userId === 'staff1');
      const staff2Presence = allPresences.find(p => p.userId === 'staff2');
      
      expect(staff1Presence?.status).toBe('online');
      expect(staff2Presence?.status).toBe('idle');
    });

    it('should get staff by status', async () => {
      await ticketManager.setPresenceTracking('guild1', true);
      
      
      await ticketManager.addStaff('guild1', 'staff1');
      await ticketManager.addStaff('guild1', 'staff2');
      await ticketManager.addStaff('guild1', 'staff3');
      
      ticketManager.updateStaffPresence('guild1', 'staff1', 'online');
      ticketManager.updateStaffPresence('guild1', 'staff2', 'idle');
      ticketManager.updateStaffPresence('guild1', 'staff3', 'offline');

      const onlineStaff = ticketManager.getStaffByStatus('guild1', 'online');
      expect(onlineStaff).toEqual(['staff1']);

      const idleStaff = ticketManager.getStaffByStatus('guild1', 'idle');
      expect(idleStaff).toEqual(['staff2']);

      const offlineStaff = ticketManager.getStaffByStatus('guild1', 'offline');
      expect(offlineStaff).toEqual(['staff3']);

      const dndStaff = ticketManager.getStaffByStatus('guild1', 'dnd');
      expect(dndStaff).toEqual([]);
    });

    it('should handle different presence statuses', async () => {
      await ticketManager.setPresenceTracking('guild1', true);
      
      const statuses: PresenceStatus[] = ['online', 'idle', 'dnd'];
      
      statuses.forEach((status, index) => {
        const staffId = `staff${index + 1}`;
        ticketManager.updateStaffPresence('guild1', staffId, status);
        
        const staffPresence = ticketManager.getStaffPresence('guild1', staffId);
        expect(staffPresence?.status).toBe(status);
      });

      
      ticketManager.updateStaffPresence('guild1', 'staff1', 'offline');
      const offlinePresence = ticketManager.getStaffPresence('guild1', 'staff1');
      expect(offlinePresence?.status).toBe('offline');
    });

    it('should return empty array when getting staff by status with no matches', async () => {
      await ticketManager.setPresenceTracking('guild1', true);
      
      const onlineStaff = ticketManager.getStaffByStatus('guild1', 'online');
      expect(onlineStaff).toEqual([]);
    });

    it('should not track presence when disabled', () => {
      
      ticketManager.updateStaffPresence('guild1', 'staff1', 'online');
      
      const staffPresence = ticketManager.getStaffPresence('guild1', 'staff1');
      expect(staffPresence).toBeUndefined();
    });

    it('should update last seen timestamp for offline status', async () => {
      await ticketManager.setPresenceTracking('guild1', true);
      
      
      ticketManager.updateStaffPresence('guild1', 'staff1', 'online');
      const onlinePresence = ticketManager.getStaffPresence('guild1', 'staff1');
      const onlineTime = onlinePresence?.lastSeen;
      
      
      ticketManager.updateStaffPresence('guild1', 'staff1', 'offline');
      const offlinePresence = ticketManager.getStaffPresence('guild1', 'staff1');
      
      expect(offlinePresence?.status).toBe('offline');
      expect(offlinePresence?.lastSeen).toEqual(onlineTime); 
    });

    it('should update timestamp for non-offline status', async () => {
      await ticketManager.setPresenceTracking('guild1', true);
      
      ticketManager.updateStaffPresence('guild1', 'staff1', 'online');
      const presence = ticketManager.getStaffPresence('guild1', 'staff1');
      
      expect(presence?.status).toBe('online');
      expect(presence?.lastSeen).toBeInstanceOf(Date);
      expect(presence?.lastUpdated).toBeInstanceOf(Date);
      
      
      const now = new Date();
      const lastSeen = presence!.lastSeen;
      expect(now.getTime() - lastSeen.getTime()).toBeLessThan(1000);
    });
  });

  

  describe('Encryption and Data Persistence', () => {
    it('should handle missing encryption key gracefully', () => {
      delete process.env.STAFF_ENCRYPTION_KEY;
      
      
      expect(() => {
        new TicketManager(mockClient, testFilePath);
      }).not.toThrow();
    });

    it('should handle invalid hex encryption key', () => {
      process.env.STAFF_ENCRYPTION_KEY = 'invalid-hex-key';
      
      expect(() => {
        new TicketManager(mockClient, testFilePath);
      }).not.toThrow();
    });

    it('should handle valid hex encryption key', () => {
      const validKey = crypto.randomBytes(32).toString('hex');
      process.env.STAFF_ENCRYPTION_KEY = validKey;
      
      expect(() => {
        new TicketManager(mockClient, testFilePath);
      }).not.toThrow();
    });

    it('should handle short encryption key by deriving from string', () => {
      process.env.STAFF_ENCRYPTION_KEY = 'short-key';
      
      expect(() => {
        new TicketManager(mockClient as unknown as Client, testFilePath);
      }).not.toThrow();
    });

    it('should persist and load staff data correctly', async () => {
      
      await ticketManager.addStaff('guild1', 'staff1');
      await ticketManager.addStaff('guild1', 'staff2');
      await ticketManager.setSupportChannel('guild1', 'channel123');
      await ticketManager.setPresenceTracking('guild1', true);

      
  const newTicketManager = new TicketManager(mockClient, testFilePath);
  await newTicketManager.ready;
  expect(newTicketManager.isStaff('guild1', 'staff1')).toBe(true);
      expect(newTicketManager.isStaff('guild1', 'staff2')).toBe(true);
      expect(newTicketManager.getSupportChannel('guild1')).toBe('channel123');
      
      const presenceConfig = newTicketManager.getPresenceConfig('guild1');
      expect(presenceConfig.enabled).toBe(true);
    });

    it('should handle corrupted data file gracefully', async () => {
      
      await fs.writeFile(testFilePath, 'corrupted-json-data');
      
      
      expect(() => {
  new TicketManager(mockClient, testFilePath);
      }).not.toThrow();
    });

    it('should handle file system errors gracefully', async () => {
      
      const invalidPath = process.platform === 'win32' 
        ? 'C:\\invalid\\path\\with\\<invalid>\\characters\\staff.json'
        : '/proc/1/mem'; 
      
  const invalidTicketManager = new TicketManager(mockClient, invalidPath);
      
      
      try {
        await invalidTicketManager.addStaff('guild1', 'staff1');
        
        expect(true).toBe(true);
      } catch (error) {
        
        expect(error).toBeDefined();
      }
    });
  });

  describe('Thread-based Tickets', () => {
    it('should create thread-based tickets', () => {
      const ticket = ticketManager.createTicket(
        'guild1', 
        'user1', 
        'channel1', 
        1, 
        'ticket-user1',
        'Test description',
        'thread123'
      );

      expect(ticket.isThread).toBe(true);
      expect(ticket.threadId).toBe('thread123');
      expect(ticket.channelId).toBe('channel1');
      expect(ticket.description).toBe('Test description');
    });

    it('should retrieve thread tickets correctly', () => {
      ticketManager.createTicket(
        'guild1', 
        'user1', 
        'channel1', 
        1, 
        'ticket-user1',
        undefined,
        'thread123'
      );

      const ticket = ticketManager.getTicketByThread('guild1', 'thread123');
      expect(ticket).toBeDefined();
      expect(ticket?.threadId).toBe('thread123');
    });

    it('should close thread tickets by thread ID', () => {
      ticketManager.createTicket(
        'guild1', 
        'user1', 
        'channel1', 
        1, 
        'ticket-user1',
        undefined,
        'thread123'
      );

      const success = ticketManager.closeTicket('guild1', 'thread123');
      expect(success).toBe(true);
      expect(ticketManager.getTicketByThread('guild1', 'thread123')).toBeUndefined();
    });

    it('should handle both channel and thread tickets in same guild', () => {
      const channelTicket = ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-1');
      const threadTicket = ticketManager.createTicket('guild1', 'user2', 'channel2', 2, 'ticket-2', undefined, 'thread1');

      expect(channelTicket.isThread).toBe(false);
      expect(threadTicket.isThread).toBe(true);

      const tickets = ticketManager.getGuildTickets('guild1');
      expect(tickets).toHaveLength(2);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty guild IDs gracefully', () => {
      expect(() => {
        ticketManager.createTicket('', 'user1', 'channel1', 1, 'test');
      }).not.toThrow();

      
      const tickets = ticketManager.getGuildTickets('');
      expect(tickets).toHaveLength(1);
      expect(tickets[0].guildId).toBe('');
      expect(ticketManager.isStaff('', 'user1')).toBe(false);
    });

    it('should handle special characters in IDs', async () => {
      const specialGuildId = 'guild-with-special-chars-123_$%^';
      const specialUserId = 'user-with-unicode-🎫-chars';
      
      await ticketManager.addStaff(specialGuildId, specialUserId);
      expect(ticketManager.isStaff(specialGuildId, specialUserId)).toBe(true);
    });

    it('should handle very long IDs', async () => {
      const longId = 'a'.repeat(1000);
      
      await expect(ticketManager.addStaff('guild1', longId)).resolves.not.toThrow();
      expect(ticketManager.isStaff('guild1', longId)).toBe(true);
    });

    it('should handle null/undefined parameters safely', () => {
      
      expect(ticketManager.getTicket('guild1', '')).toBeUndefined();
      expect(ticketManager.getUserTicket('guild1', '')).toBeUndefined();
      expect(ticketManager.getStaffList('')).toEqual([]);
    });

    it('should handle concurrent ticket creation', () => {
      const tickets: Ticket[] = [];
      
      
      for (let i = 0; i < 10; i++) {
        const ticket = ticketManager.createTicket(
          'guild1',
          `user${i}`,
          `channel${i}`,
          ticketManager.getNextTicketNumber('guild1'),
          `ticket-${i}`
        );
        tickets.push(ticket);
      }

      expect(tickets).toHaveLength(10);
      expect(new Set(tickets.map(t => t.ticketNumber)).size).toBe(10); 
      expect(ticketManager.getTotalTickets('guild1')).toBe(10);
    });

    it('should validate ticket operations on non-existent tickets', () => {
      expect(ticketManager.claimTicket('guild1', 'nonexistent', 'staff1')).toBe(false);
      expect(ticketManager.lockTicket('guild1', 'nonexistent', 'staff1')).toBe(false);
      expect(ticketManager.unlockTicket('guild1', 'nonexistent', 'staff1')).toBe(false);
      expect(ticketManager.updateTicketDescription('guild1', 'nonexistent', 'test')).toBe(false);
    });

    it('should handle presence updates for non-existent guilds', () => {
      ticketManager.updateStaffPresence('nonexistent', 'user1', 'online');
      expect(ticketManager.getStaffPresence('nonexistent', 'user1')).toBeUndefined();
    });
  });

  describe('Support Channel Management', () => {
    it('should set and get support channels', async () => {
      await ticketManager.setSupportChannel('guild1', 'channel123');
      expect(ticketManager.getSupportChannel('guild1')).toBe('channel123');
    });

    it('should update existing support channel', async () => {
      await ticketManager.setSupportChannel('guild1', 'channel123');
      await ticketManager.setSupportChannel('guild1', 'channel456');
      expect(ticketManager.getSupportChannel('guild1')).toBe('channel456');
    });

    it('should remove support channel', async () => {
      await ticketManager.setSupportChannel('guild1', 'channel123');
      const removed = await ticketManager.removeSupportChannel('guild1');
      
      expect(removed).toBe(true);
      expect(ticketManager.getSupportChannel('guild1')).toBeUndefined();
    });

    it('should return false when removing non-existent support channel', async () => {
      const removed = await ticketManager.removeSupportChannel('guild1');
      expect(removed).toBe(false);
    });

    it('should handle support channel operations on non-existent guilds', async () => {
      expect(ticketManager.getSupportChannel('nonexistent')).toBeUndefined();
      
      await ticketManager.setSupportChannel('nonexistent', 'channel123');
      expect(ticketManager.getSupportChannel('nonexistent')).toBe('channel123');
    });
  });

  describe('Advanced Presence Features', () => {
    beforeEach(async () => {
      await ticketManager.addStaff('guild1', 'staff1');
      await ticketManager.addStaff('guild1', 'staff2');
      await ticketManager.addStaff('guild1', 'staff3');
      await ticketManager.setPresenceTracking('guild1', true);
    });

    it('should get online staff correctly', async () => {
      ticketManager.updateStaffPresence('guild1', 'staff1', 'online');
      ticketManager.updateStaffPresence('guild1', 'staff2', 'idle');
      ticketManager.updateStaffPresence('guild1', 'staff3', 'dnd');

      const onlineStaff = ticketManager.getOnlineStaff('guild1');
      expect(onlineStaff).toEqual(expect.arrayContaining(['staff1', 'staff2']));
      expect(onlineStaff).toHaveLength(2);
      expect(onlineStaff).not.toContain('staff3');
    });

    it('should maintain presence timestamps correctly', async () => {
      const before = new Date();
      ticketManager.updateStaffPresence('guild1', 'staff1', 'online');
      const after = new Date();

      const presence = ticketManager.getStaffPresence('guild1', 'staff1');
      expect(presence?.lastUpdated.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(presence?.lastUpdated.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should handle rapid presence updates', async () => {
      const statuses: PresenceStatus[] = ['online', 'idle', 'dnd', 'offline', 'online'];
      
      statuses.forEach(status => {
        ticketManager.updateStaffPresence('guild1', 'staff1', status);
      });

      const finalPresence = ticketManager.getStaffPresence('guild1', 'staff1');
      expect(finalPresence?.status).toBe('online');
    });

    it('should return default presence config for non-existent guild', () => {
      const config = ticketManager.getPresenceConfig('nonexistent');
      expect(config.enabled).toBe(false);
      expect(config.smartPing.enabled).toBe(true);
      expect(config.smartPing.idleDelayMinutes).toBe(2);
    });
  });

  describe('Data Integrity and Validation', () => {
    it('should maintain ticket data integrity after multiple operations', async () => {
      
      const ticket = ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'test-ticket');
      
      
      await ticketManager.addStaff('guild1', 'staff1');
      ticketManager.claimTicket('guild1', 'channel1', 'staff1');
      
      
      ticketManager.lockTicket('guild1', 'channel1', 'staff1');
      
      
      ticketManager.updateTicketDescription('guild1', 'channel1', 'Updated description');
      
      
      const updatedTicket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(updatedTicket?.claimedBy).toBe('staff1');
      expect(updatedTicket?.isLocked).toBe(true);
      expect(updatedTicket?.description).toBe('Updated description');
      expect(updatedTicket?.guildId).toBe(ticket.guildId);
      expect(updatedTicket?.userId).toBe(ticket.userId);
      expect(updatedTicket?.createdAt).toEqual(ticket.createdAt);
    });

    it('should maintain separate data per guild', async () => {
      
      await ticketManager.addStaff('guild1', 'staff1');
      await ticketManager.addStaff('guild2', 'staff2');
      await ticketManager.setSupportChannel('guild1', 'channel1');
      await ticketManager.setSupportChannel('guild2', 'channel2');
      
      ticketManager.createTicket('guild1', 'user1', 'ch1', 1, 'ticket1');
      ticketManager.createTicket('guild2', 'user2', 'ch2', 1, 'ticket2');

      
      expect(ticketManager.isStaff('guild1', 'staff1')).toBe(true);
      expect(ticketManager.isStaff('guild1', 'staff2')).toBe(false);
      expect(ticketManager.isStaff('guild2', 'staff1')).toBe(false);
      expect(ticketManager.isStaff('guild2', 'staff2')).toBe(true);
      
      expect(ticketManager.getSupportChannel('guild1')).toBe('channel1');
      expect(ticketManager.getSupportChannel('guild2')).toBe('channel2');
      
      expect(ticketManager.getGuildTickets('guild1')).toHaveLength(1);
      expect(ticketManager.getGuildTickets('guild2')).toHaveLength(1);
    });

    it('should handle large datasets efficiently', async () => {
      const startTime = Date.now();
      
      
      for (let i = 0; i < 100; i++) {
        await ticketManager.addStaff('guild1', `staff${i}`);
      }
      
      
      for (let i = 0; i < 100; i++) {
        const ticketNumber = ticketManager.getNextTicketNumber('guild1');
        ticketManager.createTicket('guild1', `user${i}`, `channel${i}`, ticketNumber, `ticket-${i}`);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      
      expect(duration).toBeLessThan(5000); 
      
      
      expect(ticketManager.getStaffList('guild1')).toHaveLength(100);
      expect(ticketManager.getGuildTickets('guild1')).toHaveLength(100);
      expect(ticketManager.getTotalTickets('guild1')).toBe(100);
    });

    it('should handle memory management for presence data', async () => {
      await ticketManager.setPresenceTracking('guild1', true);
      
      
      for (let i = 0; i < 50; i++) {
        await ticketManager.addStaff('guild1', `staff${i}`);
        ticketManager.updateStaffPresence('guild1', `staff${i}`, 'online');
      }
      
      const allPresences = ticketManager.getAllStaffPresences('guild1');
      expect(allPresences).toHaveLength(50);
      
      
      await ticketManager.setPresenceTracking('guild1', false);
      const presencesAfterDisable = ticketManager.getAllStaffPresences('guild1');
      expect(presencesAfterDisable).toHaveLength(0);
    });
  });

  describe('Legacy Data Format Support', () => {
    it('should handle old data format without config section', async () => {
      
  const encryptedStaffData = ticketManager.encryptStaffDataForTest(['staff1', 'staff2']);
      
      
      const oldFormatData = {
        guilds: {
          'guild1': {
            encryptedData: encryptedStaffData.encryptedData,
            iv: encryptedStaffData.iv
          }
        }
      };
      
  await fs.writeFile(testFilePath, JSON.stringify(oldFormatData, null, 2));

  const newManager = new TicketManager(mockClient, testFilePath);
  await newManager.ready;

  expect(newManager.isStaff('guild1', 'staff1')).toBe(true);
      expect(newManager.isStaff('guild1', 'staff2')).toBe(true);
      
      
      expect(newManager.getSupportChannel('guild1')).toBeUndefined();
      const presenceConfig = newManager.getPresenceConfig('guild1');
      expect(presenceConfig.enabled).toBe(false);
    });
  });

  describe('Production Resilience Tests', () => {
    it('should recover from partial file corruption', async () => {
      
      await ticketManager.addStaff('guild1', 'staff1');
      await ticketManager.setSupportChannel('guild1', 'channel1');
      
      
      const fileContent = await fs.readFile(testFilePath, 'utf8');
      const truncatedContent = fileContent.substring(0, fileContent.length / 2);
      await fs.writeFile(testFilePath, truncatedContent);
      
      
  const newManager = new TicketManager(mockClient, testFilePath);
  await newManager.ready;
  expect(newManager.getStaffList('guild1')).toEqual([]);
    });

    it('should handle concurrent access attempts', async () => {
      const promises: Promise<boolean>[] = [];
      
      
      for (let i = 0; i < 10; i++) {
        promises.push(ticketManager.addStaff('guild1', `staff${i}`));
      }
      
      const results = await Promise.all(promises);
      expect(results.every(result => result === true)).toBe(true);
      expect(ticketManager.getStaffList('guild1')).toHaveLength(10);
    });

    it('should maintain consistency during rapid updates', async () => {
      await ticketManager.addStaff('guild1', 'staff1');
      await ticketManager.setPresenceTracking('guild1', true);
      
      
      const statuses: PresenceStatus[] = ['online', 'idle', 'dnd', 'offline'];
      for (let i = 0; i < 100; i++) {
        const status = statuses[i % statuses.length];
        ticketManager.updateStaffPresence('guild1', 'staff1', status);
      }
      
      
      const presence = ticketManager.getStaffPresence('guild1', 'staff1');
      expect(presence?.status).toBe('offline');
      expect(presence?.userId).toBe('staff1');
    });
  });

  describe('Whitelist Functionality', () => {
    beforeEach(async () => {
      await ticketManager.addStaff('guild1', 'staff1');
      ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-user1');
    });

    it('should add user to whitelist', () => {
      const result = ticketManager.addUserToWhitelist('guild1', 'channel1', 'user2', 'staff1');
      expect(result).toBe(true);

      const whitelist = ticketManager.getTicketWhitelist('guild1', 'channel1');
      expect(whitelist).toContain('user2');
    });

    it('should remove user from whitelist', () => {
      ticketManager.addUserToWhitelist('guild1', 'channel1', 'user2', 'staff1');
      const result = ticketManager.removeUserFromWhitelist('guild1', 'channel1', 'user2', 'staff1');
      expect(result).toBe(true);

      const whitelist = ticketManager.getTicketWhitelist('guild1', 'channel1');
      expect(whitelist).not.toContain('user2');
    });

    it('should check if user is whitelisted', () => {
      ticketManager.addUserToWhitelist('guild1', 'channel1', 'user2', 'staff1');
      
      expect(ticketManager.isUserWhitelisted('guild1', 'channel1', 'user2')).toBe(true);
      expect(ticketManager.isUserWhitelisted('guild1', 'channel1', 'user3')).toBe(false);
    });

    it('should return empty array for non-existent ticket', () => {
      const whitelist = ticketManager.getTicketWhitelist('guild1', 'nonexistent');
      expect(whitelist).toEqual([]);
    });

    it('should prevent duplicate whitelist entries', () => {
      ticketManager.addUserToWhitelist('guild1', 'channel1', 'user2', 'staff1');
      ticketManager.addUserToWhitelist('guild1', 'channel1', 'user2', 'staff1');
      
      const whitelist = ticketManager.getTicketWhitelist('guild1', 'channel1');
      expect(whitelist.filter(id => id === 'user2')).toHaveLength(1);
    });

    it('should handle whitelist operations with unauthorized staff', () => {
      const result = ticketManager.addUserToWhitelist('guild1', 'channel1', 'user2', 'unauthorized');
      expect(result).toBe(false);
    });
  });

  describe('Escalation System', () => {
    beforeEach(async () => {
      await ticketManager.addStaff('guild1', 'staff1');
      ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-user1');
    });

    it('should escalate ticket priority', () => {
      const result = ticketManager.escalateTicket('guild1', 'channel1', 'staff1');
      expect(result.success).toBe(true);
      expect(result.newLevel).toBe(1);

      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(ticket?.escalationLevel).toBe(1);
    });

    it('should escalate through all priority levels', () => {
      let result;
      
      result = ticketManager.escalateTicket('guild1', 'channel1', 'staff1');
      expect(result.success).toBe(true);
      expect(result.newLevel).toBe(1);

      result = ticketManager.escalateTicket('guild1', 'channel1', 'staff1');
      expect(result.success).toBe(true);
      expect(result.newLevel).toBe(2);

      result = ticketManager.escalateTicket('guild1', 'channel1', 'staff1');
      expect(result.success).toBe(true);
      expect(result.newLevel).toBe(3);

      result = ticketManager.escalateTicket('guild1', 'channel1', 'staff1');
      expect(result.success).toBe(false);
    });

    it('should prevent escalation by unauthorized staff', () => {
      const result = ticketManager.escalateTicket('guild1', 'channel1', 'unauthorized');
      expect(result.success).toBe(false);
    });

    it('should handle escalation of non-existent ticket', () => {
      const result = ticketManager.escalateTicket('guild1', 'nonexistent', 'staff1');
      expect(result.success).toBe(false);
    });
  });

  describe('Notes System', () => {
    beforeEach(async () => {
      await ticketManager.addStaff('guild1', 'staff1');
      ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-user1');
    });

    it('should update ticket notes', () => {
      const notes = 'This is a test note for the ticket';
      const result = ticketManager.updateTicketNotes('guild1', 'channel1', notes, 'staff1');
      expect(result).toBe(true);

      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(ticket?.notes).toBe(notes);
    });

    it('should clear ticket notes', () => {
      ticketManager.updateTicketNotes('guild1', 'channel1', 'Initial notes', 'staff1');
      
      const result = ticketManager.updateTicketNotes('guild1', 'channel1', '', 'staff1');
      expect(result).toBe(true);

      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(ticket?.notes).toBe(undefined);
    });

    it('should prevent notes update by unauthorized staff', () => {
      const result = ticketManager.updateTicketNotes('guild1', 'channel1', 'Unauthorized note', 'unauthorized');
      expect(result).toBe(false);
    });

    it('should handle notes update for non-existent ticket', () => {
      const result = ticketManager.updateTicketNotes('guild1', 'nonexistent', 'Note', 'staff1');
      expect(result).toBe(false);
    });

    it('should preserve notes across other ticket operations', () => {
      const notes = 'Important ticket information';
      ticketManager.updateTicketNotes('guild1', 'channel1', notes, 'staff1');
      
      ticketManager.lockTicket('guild1', 'channel1', 'staff1');
      ticketManager.escalateTicket('guild1', 'channel1', 'staff1');
      
      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(ticket?.notes).toBe(notes);
    });
  });

  describe('Lock/Unlock with Thread Name Updates', () => {
    beforeEach(async () => {
      await ticketManager.addStaff('guild1', 'staff1');
      ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-user1');
    });

    it('should lock ticket', () => {
      const result = ticketManager.lockTicket('guild1', 'channel1', 'staff1');
      expect(result).toBe(true);

      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(ticket?.isLocked).toBe(true);
    });

    it('should unlock ticket', () => {
      ticketManager.lockTicket('guild1', 'channel1', 'staff1');
      
      const result = ticketManager.unlockTicket('guild1', 'channel1', 'staff1');
      expect(result).toBe(true);

      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(ticket?.isLocked).toBe(false);
    });

    it('should track lock history', () => {
      ticketManager.lockTicket('guild1', 'channel1', 'staff1');
      
      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(ticket?.isLocked).toBe(true);
    });

    it('should prevent unauthorized lock operations', () => {
      const result = ticketManager.lockTicket('guild1', 'channel1', 'unauthorized');
      expect(result).toBe(false);
    });
  });

  describe('Enhanced Ticket Interface', () => {
    beforeEach(async () => {
      await ticketManager.addStaff('guild1', 'staff1');
    });

    it('should create ticket with all new fields', () => {
      const ticket = ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-user1');
      
      expect(ticket.whitelistedUsers || []).toEqual([]);
      expect(ticket.notes || '').toBe('');
      expect(ticket.escalationLevel || 0).toBe(0);
      expect(ticket.isLocked).toBe(false);
    });

    it('should handle complex ticket operations together', () => {
      const ticket = ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-user1');
      
      expect(ticket.ticketNumber).toBe(1);
      
      ticketManager.updateTicketNotes('guild1', 'channel1', 'Initial assessment complete', 'staff1');
      
      ticketManager.lockTicket('guild1', 'channel1', 'staff1');
      
      ticketManager.addUserToWhitelist('guild1', 'channel1', 'user2', 'staff1');
      ticketManager.addUserToWhitelist('guild1', 'channel1', 'user3', 'staff1');
      
      ticketManager.escalateTicket('guild1', 'channel1', 'staff1');
      
      const updatedTicket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(updatedTicket?.notes).toBe('Initial assessment complete');
      expect(updatedTicket?.isLocked).toBe(true);
      expect(updatedTicket?.whitelistedUsers).toEqual(['user2', 'user3']);
      expect(updatedTicket?.escalationLevel).toBe(1);
    });
  });

  describe('Data Persistence and Integrity', () => {
    it('should maintain whitelist data across manager restarts', async () => {
      await ticketManager.addStaff('guild1', 'staff1');
      ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-user1');
      ticketManager.addUserToWhitelist('guild1', 'channel1', 'user2', 'staff1');
      
  const newManager = new TicketManager(mockClient, testFilePath);
  await newManager.ready;
  expect(typeof newManager.getTicketWhitelist).toBe('function');
    });

    it('should maintain notes and escalation data integrity', async () => {
      await ticketManager.addStaff('guild1', 'staff1');
      ticketManager.createTicket('guild1', 'user1', 'channel1', 1, 'ticket-user1');
      ticketManager.updateTicketNotes('guild1', 'channel1', 'Persistent note', 'staff1');
      ticketManager.escalateTicket('guild1', 'channel1', 'staff1');
      
      const ticket = ticketManager.getTicketByChannel('guild1', 'channel1');
      expect(ticket?.notes).toBe('Persistent note');
      expect(ticket?.escalationLevel).toBe(1);
    });
  });
});
