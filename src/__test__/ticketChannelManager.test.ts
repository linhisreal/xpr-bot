import { TicketChannelManager, TicketChannelOptions, ChannelCreationResult } from '../modules/TicketChannelManager';
import { 
  Guild, 
  TextChannel, 
  CategoryChannel, 
  User, 
  GuildChannelManager,
  PermissionOverwrites,
  OverwriteType,
  Client
} from 'discord.js';

function createMockGuild(overrides: any = {}): Guild {
  const mockClient = {
    user: { id: 'bot123' }
  } as Client;

  return {
    id: 'guild123',
    client: mockClient,
    channels: {
      create: jest.fn().mockResolvedValue({
        id: 'channel123',
        name: 'ticket-testuser',
        send: jest.fn().mockResolvedValue(undefined),
        setParent: jest.fn().mockResolvedValue(undefined),
        setName: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        permissionOverwrites: {
          cache: new Map(),
          edit: jest.fn().mockResolvedValue(undefined),
          delete: jest.fn().mockResolvedValue(undefined)
        }
      })
    } as unknown as GuildChannelManager,
    roles: {
      everyone: { id: 'everyone123' }
    },
    ...overrides
  } as unknown as Guild;
}

function createMockUser(overrides: any = {}): User {
  return {
    id: 'user123',
    username: 'testuser',
    displayName: 'Test User',
    toString: () => '<@user123>',
    ...overrides
  } as unknown as User;
}

function createMockTextChannel(overrides: any = {}): TextChannel {
  return {
    id: 'channel123',
    name: 'ticket-testuser',
    send: jest.fn().mockResolvedValue(undefined),
    setParent: jest.fn().mockResolvedValue(undefined),
    setName: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    permissionOverwrites: {
      cache: new Map([
        ['user123', { 
          id: 'user123', 
          type: OverwriteType.Member,
          allow: [],
          deny: []
        }],
        ['staff456', { 
          id: 'staff456', 
          type: OverwriteType.Member,
          allow: [],
          deny: []
        }]
      ]),
      edit: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined)
    } as unknown as PermissionOverwrites,
    ...overrides
  } as unknown as TextChannel;
}

function createMockCategory(overrides: any = {}): CategoryChannel {
  return {
    id: 'category123',
    name: 'Support Tickets',
    ...overrides
  } as unknown as CategoryChannel;
}

describe('TicketChannelManager', () => {
  let ticketChannelManager: TicketChannelManager;

  beforeEach(() => {
    ticketChannelManager = new TicketChannelManager();
    jest.clearAllMocks();
  });

  describe('Channel Creation', () => {
    test('should create ticket channel successfully', async () => {
      const mockGuild = createMockGuild();
      const mockUser = createMockUser();
      const mockCategory = createMockCategory();

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 1,
        category: mockCategory,
        originalMessage: {
          content: 'I need help with my account',
          timestamp: new Date()
        }
      };

      const result: ChannelCreationResult = await ticketChannelManager.createTicketChannel(options);

      expect(result.success).toBe(true);
      expect(result.channel).toBeDefined();
      expect(mockGuild.channels.create).toHaveBeenCalledWith({
        name: 'ticket-testuser',
        type: 0,
        parent: mockCategory,
        permissionOverwrites: expect.arrayContaining([
          expect.objectContaining({ id: 'everyone123' }),
          expect.objectContaining({ id: 'user123' }),
          expect.objectContaining({ id: 'bot123' })
        ]),
        topic: 'Ticket #1 - Created by testuser',
        reason: 'Automated ticket creation for testuser'
      });
    });

    test('should create ticket channel without category', async () => {
      const mockGuild = createMockGuild();
      const mockUser = createMockUser();

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 2
      };

      const result = await ticketChannelManager.createTicketChannel(options);

      expect(result.success).toBe(true);
      expect(mockGuild.channels.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: undefined
        })
      );
    });

    test('should send initial content when original message provided', async () => {
      const mockGuild = createMockGuild();
      const mockUser = createMockUser();
      const mockChannel = mockGuild.channels.create as jest.Mock;

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 3,
        originalMessage: {
          content: 'Test message content',
          timestamp: new Date()
        }
      };

      await ticketChannelManager.createTicketChannel(options);

      const createdChannel = await mockChannel.mock.results[0].value;
      expect(createdChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('🎫 **Ticket Created** 🎫')
      );
      expect(createdChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('Test message content')
      );
    });

    test('should handle channel creation errors', async () => {
      const mockGuild = createMockGuild();
      const mockUser = createMockUser();
      
      (mockGuild.channels.create as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 4
      };

      const result = await ticketChannelManager.createTicketChannel(options);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
      expect(result.channel).toBeUndefined();
    });

    test('should sanitize usernames in channel names', async () => {
      const mockGuild = createMockGuild();
      const mockUser = createMockUser({ username: 'Test@User#123!' });

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 5
      };

      await ticketChannelManager.createTicketChannel(options);

      expect(mockGuild.channels.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ticket-test-user-123'
        })
      );
    });

    test('should truncate long usernames', async () => {
      const mockGuild = createMockGuild();
      const mockUser = createMockUser({ 
        username: 'verylongusernamethatexceedstwentycharacters' 
      });

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 6
      };

      await ticketChannelManager.createTicketChannel(options);

      expect(mockGuild.channels.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ticket-verylongusernamethat'
        })
      );
    });
  });

  describe('Channel Archiving', () => {
    test('should archive channel with category', async () => {
      const mockChannel = createMockTextChannel();
      const mockArchiveCategory = createMockCategory({ name: 'Archived Tickets' });

      const result = await ticketChannelManager.archiveTicketChannel(mockChannel, mockArchiveCategory);

      expect(result).toBe(true);
      expect(mockChannel.setParent).toHaveBeenCalledWith(mockArchiveCategory, {
        reason: 'Ticket closed - moved to archive'
      });
      expect(mockChannel.setName).toHaveBeenCalledWith('archived-ticket-testuser');
    });

    test('should archive channel without category', async () => {
      const mockChannel = createMockTextChannel();

      const result = await ticketChannelManager.archiveTicketChannel(mockChannel);

      expect(result).toBe(true);
      expect(mockChannel.setParent).not.toHaveBeenCalled();
      expect(mockChannel.setName).toHaveBeenCalledWith('archived-ticket-testuser');
    });

    test('should not double-prefix archived channels', async () => {
      const mockChannel = createMockTextChannel({ name: 'archived-ticket-testuser' });

      const result = await ticketChannelManager.archiveTicketChannel(mockChannel);

      expect(result).toBe(true);
      expect(mockChannel.setName).not.toHaveBeenCalled();
    });

    test('should remove member permission overwrites during archiving', async () => {
      const mockChannel = createMockTextChannel();

      const result = await ticketChannelManager.archiveTicketChannel(mockChannel);

      expect(result).toBe(true);
      expect(mockChannel.permissionOverwrites.delete).toHaveBeenCalledWith('user123', 'Ticket archived');
      expect(mockChannel.permissionOverwrites.delete).toHaveBeenCalledWith('staff456', 'Ticket archived');
    });

    test('should handle archiving errors gracefully', async () => {
      const mockChannel = createMockTextChannel();
      (mockChannel.setName as jest.Mock).mockRejectedValue(new Error('Missing permissions'));

      const result = await ticketChannelManager.archiveTicketChannel(mockChannel);

      expect(result).toBe(false);
    });
  });

  describe('Channel Locking and Unlocking', () => {
    test('should lock ticket channel for user', async () => {
      const mockChannel = createMockTextChannel();
      const userId = 'user123';

      const result = await ticketChannelManager.lockTicketChannel(mockChannel, userId);

      expect(result).toBe(true);
      expect(mockChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
        }),
        { reason: 'Ticket locked by staff' }
      );
    });

    test('should unlock ticket channel for user', async () => {
      const mockChannel = createMockTextChannel();
      const userId = 'user123';

      const result = await ticketChannelManager.unlockTicketChannel(mockChannel, userId);

      expect(result).toBe(true);
      expect(mockChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
        }),
        { reason: 'Ticket unlocked by staff' }
      );
    });

    test('should handle locking errors', async () => {
      const mockChannel = createMockTextChannel();
      (mockChannel.permissionOverwrites.edit as jest.Mock).mockRejectedValue(new Error('Permission error'));

      const result = await ticketChannelManager.lockTicketChannel(mockChannel, 'user123');

      expect(result).toBe(false);
    });

    test('should handle unlocking errors', async () => {
      const mockChannel = createMockTextChannel();
      (mockChannel.permissionOverwrites.edit as jest.Mock).mockRejectedValue(new Error('Permission error'));

      const result = await ticketChannelManager.unlockTicketChannel(mockChannel, 'user123');

      expect(result).toBe(false);
    });
  });

  describe('Channel Deletion', () => {
    test('should delete ticket channel successfully', async () => {
      const mockChannel = createMockTextChannel();

      const result = await ticketChannelManager.deleteTicketChannel(mockChannel);

      expect(result).toBe(true);
      expect(mockChannel.delete).toHaveBeenCalledWith('Ticket permanently closed');
    });

    test('should handle deletion errors', async () => {
      const mockChannel = createMockTextChannel();
      (mockChannel.delete as jest.Mock).mockRejectedValue(new Error('Missing permissions'));

      const result = await ticketChannelManager.deleteTicketChannel(mockChannel);

      expect(result).toBe(false);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle missing bot user in guild', async () => {
      const mockGuild = createMockGuild({
        client: { user: null }
      });
      const mockUser = createMockUser();

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 7
      };

      const result = await ticketChannelManager.createTicketChannel(options);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle empty username', async () => {
      const mockGuild = createMockGuild();
      const mockUser = createMockUser({ username: '' });

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 8
      };

      await ticketChannelManager.createTicketChannel(options);

      expect(mockGuild.channels.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ticket-'
        })
      );
    });

    test('should handle special characters in username', async () => {
      const mockGuild = createMockGuild();
      const mockUser = createMockUser({ username: '!@#$%^&*()' });

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 9
      };

      await ticketChannelManager.createTicketChannel(options);

      expect(mockGuild.channels.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringMatching(/^ticket-[a-z0-9-]*$/)
        })
      );
    });

    test('should handle initial content setup failure gracefully', async () => {
      const mockGuild = createMockGuild();
      const mockUser = createMockUser();
      
      const mockChannel = {
        id: 'channel123',
        send: jest.fn().mockRejectedValue(new Error('Cannot send message'))
      };
      (mockGuild.channels.create as jest.Mock).mockResolvedValue(mockChannel);

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 10,
        originalMessage: {
          content: 'Test message',
          timestamp: new Date()
        }
      };

      const result = await ticketChannelManager.createTicketChannel(options);

      expect(result.success).toBe(true);
      expect(result.channel).toBe(mockChannel);
    });
  });

  describe('Permission Management', () => {
    test('should set correct permissions for everyone role', async () => {
      const mockGuild = createMockGuild();
      const mockUser = createMockUser();

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 11
      };

      await ticketChannelManager.createTicketChannel(options);

      const createCall = (mockGuild.channels.create as jest.Mock).mock.calls[0][0];
      const everyoneOverwrite = createCall.permissionOverwrites.find((p: any) => p.id === 'everyone123');
      
      expect(everyoneOverwrite).toBeDefined();
      expect(everyoneOverwrite.deny).toBeDefined();
    });

    test('should set correct permissions for ticket creator', async () => {
      const mockGuild = createMockGuild();
      const mockUser = createMockUser();

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 12
      };

      await ticketChannelManager.createTicketChannel(options);

      const createCall = (mockGuild.channels.create as jest.Mock).mock.calls[0][0];
      const userOverwrite = createCall.permissionOverwrites.find((p: any) => p.id === 'user123');
      
      expect(userOverwrite).toBeDefined();
      expect(userOverwrite.allow).toBeDefined();
    });

    test('should set correct permissions for bot', async () => {
      const mockGuild = createMockGuild();
      const mockUser = createMockUser();

      const options: TicketChannelOptions = {
        guild: mockGuild,
        creator: mockUser,
        ticketNumber: 13
      };

      await ticketChannelManager.createTicketChannel(options);

      const createCall = (mockGuild.channels.create as jest.Mock).mock.calls[0][0];
      const botOverwrite = createCall.permissionOverwrites.find((p: any) => p.id === 'bot123');
      
      expect(botOverwrite).toBeDefined();
      expect(botOverwrite.allow).toBeDefined();
    });
  });
});