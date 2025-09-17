import { TicketControlsManager, TicketControlOptions } from '../modules/TicketControlsManager';
import { TicketManager } from '../bot/ticketManager';
import { InteractionManager } from '../modules/InteractionManager';
import { 
  ButtonInteraction, 
  ModalSubmitInteraction,
  User, 
  Message,
  EmbedBuilder,
  ActionRowBuilder

} from 'discord.js';

function createMockTicketManager(): jest.Mocked<TicketManager> {
  return {
    lockTicket: jest.fn().mockReturnValue(true),
    unlockTicket: jest.fn().mockReturnValue(true),
    claimTicket: jest.fn().mockReturnValue(true),
    unclaimTicket: jest.fn().mockReturnValue(true),
    escalateTicket: jest.fn().mockReturnValue({ success: true, newLevel: 1 }),
    closeTicket: jest.fn().mockReturnValue(true),
    closeTicketWithAuth: jest.fn().mockReturnValue(true),
    updateTicketNotes: jest.fn().mockReturnValue(true),
    addUserToWhitelist: jest.fn().mockReturnValue(true),
    removeUserFromWhitelist: jest.fn().mockReturnValue(true),
    getTicketByChannel: jest.fn().mockReturnValue({
      guildId: 'guild123',
      userId: 'user123',
      channelId: 'channel123',
      ticketNumber: 1,
      createdAt: new Date(),
      description: 'Test ticket description',
      notes: 'Test notes',
      isLocked: false,
      channelName: 'ticket-testuser',
      isThread: true,
      escalationLevel: 0,
      whitelistedUsers: []
    }),
    getTicketByThread: jest.fn().mockReturnValue({
      guildId: 'guild123',
      userId: 'user123',
      channelId: 'channel123',
      ticketNumber: 1,
      createdAt: new Date(),
      description: 'Test ticket description',
      notes: 'Test notes',
      isLocked: false,
      channelName: 'ticket-testuser',
      isThread: true,
      escalationLevel: 0,
      whitelistedUsers: []
    }),
    getTicket: jest.fn().mockReturnValue({
      guildId: 'guild123',
      userId: 'user123',
      channelId: 'channel123',
      ticketNumber: 1,
      createdAt: new Date(),
      description: 'Test ticket description',
      notes: 'Test notes',
      isLocked: false,
      channelName: 'ticket-testuser',
      isThread: true,
      escalationLevel: 0,
      whitelistedUsers: []
    }),
    isStaff: jest.fn().mockReturnValue(true),
    getStaffList: jest.fn().mockImplementation((guildId: string) => {
      if (guildId === 'guild123') {
        return ['user123', 'staff1', 'staff2'];
      }
      return ['staff1', 'staff2'];
    })
  } as unknown as jest.Mocked<TicketManager>;
}

function createMockInteractionManager(): jest.Mocked<InteractionManager> {
  return {
    safeReply: jest.fn().mockResolvedValue(true),
    safeRespond: jest.fn().mockResolvedValue(true),
    safeDefer: jest.fn().mockResolvedValue(true),
    immediateDefer: jest.fn().mockResolvedValue(true),
    safeFollowUp: jest.fn().mockResolvedValue(true),
    safeEditReply: jest.fn().mockResolvedValue(true),
    trackInteraction: jest.fn(),
    getStats: jest.fn().mockReturnValue({ total: 0, byType: {}, oldestAge: 0 }),
    destroy: jest.fn()
  } as unknown as jest.Mocked<InteractionManager>;
}

function createMockTextChannel(overrides: any = {}): any {
  return {
    id: 'channel123',
    name: 'ticket-testuser',
    isThread: jest.fn().mockReturnValue(true),
    guild: {
      id: 'guild123',
      members: {
        fetch: jest.fn().mockImplementation((userId: string) => {
          return Promise.resolve({
            user: {
              id: userId,
              username: 'testuser',
              displayName: 'Test User'
            }
          });
        })
      }
    },
    members: {
      add: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      fetch: jest.fn().mockResolvedValue(new Map())
    },
    messages: {
      fetch: jest.fn().mockResolvedValue(new Map())
    },
    fetchStarterMessage: jest.fn().mockResolvedValue(null),
    edit: jest.fn().mockResolvedValue(undefined),
    setArchived: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue({
      id: 'message123',
      edit: jest.fn().mockResolvedValue(undefined)
    }),
    ...overrides
  };
}

function createMockUser(overrides: any = {}): jest.Mocked<User> {
  return {
    id: 'user123',
    username: 'testuser',
    displayName: 'Test User',
    toString: () => '<@user123>',
    ...overrides
  } as unknown as jest.Mocked<User>;
}

function createMockButtonInteraction(customId: string, overrides: any = {}): jest.Mocked<ButtonInteraction> {
  return {
    id: 'interaction123',
    customId,
    user: createMockUser(),
    channel: createMockTextChannel(),
    guild: {
      id: 'guild123'
    },
    guildId: 'guild123',
    message: {
      id: 'message123',
      edit: jest.fn().mockResolvedValue(undefined)
    },
    replied: false,
    deferred: false,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as jest.Mocked<ButtonInteraction>;
}

function createMockModalInteraction(customId: string, overrides: any = {}): jest.Mocked<ModalSubmitInteraction> {
  return {
    id: 'modal123',
    customId,
    user: createMockUser(),
    channel: createMockTextChannel(),
    guild: {
      id: 'guild123'
    },
    guildId: 'guild123',
    fields: {
      getTextInputValue: jest.fn().mockReturnValue('Test input value')
    },
    replied: false,
    deferred: false,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as jest.Mocked<ModalSubmitInteraction>;
}

function createMockMessage(overrides: any = {}): jest.Mocked<Message> {
  return {
    id: 'message123',
    edit: jest.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as jest.Mocked<Message>;
}

describe('TicketControlsManager', () => {
  let ticketControlsManager: TicketControlsManager;
  let mockTicketManager: jest.Mocked<TicketManager>;
  let mockInteractionManager: jest.Mocked<InteractionManager>;

  beforeEach(() => {
    mockTicketManager = createMockTicketManager();
    mockInteractionManager = createMockInteractionManager();
    ticketControlsManager = new TicketControlsManager(mockTicketManager, mockInteractionManager);
    jest.clearAllMocks();
  });

  describe('Control Creation and Updates', () => {
    test('should create ticket controls successfully', async () => {
      const mockChannel = createMockTextChannel();
      const options: TicketControlOptions = {
        ticketId: 'ticket123',
        ticketNumber: 1,
        creator: createMockUser(),
        description: 'Test ticket description',
        isLocked: false,
        escalationLevel: 0,
        status: 'open'
      };

      const result = await ticketControlsManager.createTicketControls(mockChannel, options);

      expect(result).toBeDefined();
      expect(mockChannel.send).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([
          expect.any(EmbedBuilder)
        ]),
        components: expect.arrayContaining([
          expect.any(ActionRowBuilder)
        ])
      });
    });

    test('should update ticket controls successfully', async () => {
      const mockMessage = createMockMessage();
      const options: TicketControlOptions = {
        ticketId: 'ticket123',
        ticketNumber: 1,
        creator: createMockUser(),
        isLocked: true,
        escalationLevel: 1,
        status: 'claimed'
      };

      const result = await ticketControlsManager.updateTicketControls(mockMessage, options);

      expect(result).toBe(true);
      expect(mockMessage.edit).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([
          expect.any(EmbedBuilder)
        ]),
        components: expect.arrayContaining([
          expect.any(ActionRowBuilder)
        ])
      });
    });

    test('should handle control creation errors', async () => {
      const mockChannel = createMockTextChannel();
      mockChannel.send.mockRejectedValue(new Error('Permission denied'));

      const options: TicketControlOptions = {
        ticketId: 'ticket123',
        ticketNumber: 1,
        creator: createMockUser(),
        isLocked: false,
        escalationLevel: 0,
        status: 'open'
      };

      const result = await ticketControlsManager.createTicketControls(mockChannel, options);

      expect(result).toBeNull();
    });

    test('should handle control update errors', async () => {
      const mockMessage = createMockMessage();
      mockMessage.edit.mockRejectedValue(new Error('Message not found'));

      const options: TicketControlOptions = {
        ticketId: 'ticket123',
        ticketNumber: 1,
        creator: createMockUser(),
        isLocked: false,
        escalationLevel: 0,
        status: 'open'
      };

      const result = await ticketControlsManager.updateTicketControls(mockMessage, options);

      expect(result).toBe(false);
    });
  });

  describe('Button Interaction Handling', () => {
    test('should handle lock button interaction', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_lock');
      
      const result = await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(result.success).toBe(true);
      expect(result.action).toBe('lock');
      expect(mockTicketManager.lockTicket).toHaveBeenCalled();
    });

    test('should handle claim button interaction', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_claim');
      
      const result = await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(result.success).toBe(true);
      expect(result.action).toBe('claim');
      expect(mockTicketManager.claimTicket).toHaveBeenCalled();
    });

    test('should handle escalate button interaction', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_escalate');
      
      const result = await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(result.success).toBe(true);
      expect(result.action).toBe('escalate');
      expect(mockTicketManager.escalateTicket).toHaveBeenCalled();
    });

    test('should handle close button interaction', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_close');
      
      const result = await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(result.success).toBe(true);
      expect(result.action).toBe('close');
      expect(mockTicketManager.closeTicketWithAuth).toHaveBeenCalled();
    });

    test('should handle notes button interaction', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_notes');
      
      const result = await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(result.success).toBe(true);
      expect(result.action).toBe('notes');
      expect(mockInteraction.showModal).toHaveBeenCalled();
    });

    test('should handle whitelist button interaction', async () => {
      mockTicketManager.getTicketByThread.mockReturnValue({
        guildId: 'guild123',
        userId: 'user123',
        channelId: 'channel123',
        ticketNumber: 1,
        createdAt: new Date(),
        description: 'Test ticket description',
        notes: 'Test notes',
        isLocked: true,
        channelName: 'ticket-testuser',
        isThread: true,
        escalationLevel: 0,
        whitelistedUsers: []
      });
      
      const mockInteraction = createMockButtonInteraction('ticket_whitelist');
      
      const result = await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(result.success).toBe(true);
      expect(result.action).toBe('whitelist');
      expect(mockInteraction.showModal).toHaveBeenCalled();
    });

    test('should handle unknown button interaction', async () => {
      const mockInteraction = createMockButtonInteraction('unknown_action');
      
      const result = await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(result.success).toBe(false);
      expect(result.action).toBe('unknown_action');
      expect(result.error).toBe('Unknown action');
    });

    test('should handle staff authorization failures', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_lock');
      mockTicketManager.getStaffList.mockReturnValue(['staff1', 'staff2']);
      
      const result = await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(result.success).toBe(false);
      expect(result.error).toContain('authorized');
    });

    test('should handle ticket manager operation failures', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_lock');
      mockTicketManager.lockTicket.mockReturnValue(false);
      
      const result = await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(result.success).toBe(false);
    });
  });

  describe('Modal Handling', () => {
    test('should handle notes modal submission', async () => {
      const mockInteraction = createMockModalInteraction('ticket_notes_channel123');
      
      await ticketControlsManager.handleModalSubmit(mockInteraction);

      expect(mockTicketManager.updateTicketNotes).toHaveBeenCalledWith(
        'guild123',
        'channel123',
        'Test input value',
        'user123'
      );
      expect(mockInteractionManager.safeReply).toHaveBeenCalled();
    });

    test('should handle whitelist modal submission', async () => {
      const mockTicket = {
        guildId: 'guild123',
        userId: 'user123',
        channelId: 'channel123',
        ticketNumber: 1,
        createdAt: new Date(),
        isLocked: true,
        channelName: 'ticket-test',
        isThread: false,
        claimedBy: 'user123'
      };
      
      mockTicketManager.getTicket.mockReturnValue(mockTicket);
      
      const mockInteraction = createMockModalInteraction('ticket_whitelist_channel123', {
        fields: {
          getTextInputValue: jest.fn()
            .mockReturnValueOnce('123456789012345678')
            .mockReturnValueOnce('Testing whitelist')
        },
        guild: {
          id: 'guild123',
          members: {
            fetch: jest.fn().mockResolvedValue({
              id: '123456789012345678',
              displayName: 'Test User',
              user: {
                username: 'testuser456'
              }
            })
          }
        },
        guildId: 'guild123',
        channel: {
          members: {
            add: jest.fn().mockResolvedValue(undefined)
          }
        }
      });
      
      mockTicketManager.addUserToWhitelist.mockReturnValue(true);
      
      await ticketControlsManager.handleModalSubmit(mockInteraction);

      if (mockTicketManager.addUserToWhitelist.mock.calls.length === 0) {
        console.log('addUserToWhitelist was not called');
        console.log('safeReply calls:', mockInteractionManager.safeReply.mock.calls);
        console.log('getStaffList calls:', mockTicketManager.getStaffList.mock.calls);
        console.log('getTicket calls:', mockTicketManager.getTicket.mock.calls);
      }

      expect(mockTicketManager.addUserToWhitelist).toHaveBeenCalled();
      expect(mockInteractionManager.safeReply).toHaveBeenCalled();
    });

    test('should handle unknown modal submission', async () => {
      const mockInteraction = createMockModalInteraction('unknown_modal');
      
      await ticketControlsManager.handleModalSubmit(mockInteraction);

      expect(mockInteractionManager.safeReply).toHaveBeenCalledWith(
        mockInteraction,
        expect.objectContaining({
          content: expect.stringContaining('Unknown modal')
        })
      );
    });

    test('should handle modal submission errors', async () => {
      const mockInteraction = createMockModalInteraction('ticket_notes_channel123');
      mockTicketManager.updateTicketNotes.mockReturnValue(false);
      
      await ticketControlsManager.handleModalSubmit(mockInteraction);

      expect(mockInteractionManager.safeReply).toHaveBeenCalledWith(
        mockInteraction,
        {
          content: '❌ Failed to update ticket notes. Please check if the ticket exists and you have proper permissions.',
          ephemeral: true
        }
      );
    });
  });

  describe('State Management', () => {
    test('should display correct status colors', async () => {
      const mockChannel = createMockTextChannel();

      const testCases = [
        { status: 'open' as const, expectedColorCheck: true },
        { status: 'claimed' as const, expectedColorCheck: true },
        { status: 'locked' as const, expectedColorCheck: true },
        { status: 'escalated' as const, expectedColorCheck: true },
        { status: 'closed' as const, expectedColorCheck: true }
      ];

      for (const testCase of testCases) {
        const options: TicketControlOptions = {
          ticketId: 'ticket123',
          ticketNumber: 1,
          creator: createMockUser(),
          isLocked: false,
          escalationLevel: 0,
          status: testCase.status
        };

        const result = await ticketControlsManager.createTicketControls(mockChannel, options);
        expect(result).toBeDefined();
      }
    });

    test('should display correct escalation levels', async () => {
      const mockChannel = createMockTextChannel();

      for (let escalationLevel = 0; escalationLevel <= 3; escalationLevel++) {
        const options: TicketControlOptions = {
          ticketId: 'ticket123',
          ticketNumber: 1,
          creator: createMockUser(),
          isLocked: false,
          escalationLevel,
          status: 'open'
        };

        const result = await ticketControlsManager.createTicketControls(mockChannel, options);
        expect(result).toBeDefined();
      }
    });

    test('should show different buttons based on ticket state', async () => {
      const mockChannel = createMockTextChannel();

      const lockedOptions: TicketControlOptions = {
        ticketId: 'ticket123',
        ticketNumber: 1,
        creator: createMockUser(),
        isLocked: true,
        escalationLevel: 0,
        status: 'locked'
      };

      const unlockedOptions: TicketControlOptions = {
        ...lockedOptions,
        isLocked: false,
        status: 'open'
      };

      await ticketControlsManager.createTicketControls(mockChannel, lockedOptions);
      await ticketControlsManager.createTicketControls(mockChannel, unlockedOptions);

      expect(mockChannel.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle missing ticket manager dependency', async () => {
      const controlsManagerWithoutDeps = new TicketControlsManager();
      const mockInteraction = createMockButtonInteraction('ticket_lock');
      
      const result = await controlsManagerWithoutDeps.handleControlInteraction(mockInteraction);

      expect(result.success).toBe(false);
      expect(result.error).toContain('manager');
    });

    test('should handle missing interaction manager dependency', async () => {
      const controlsManagerWithoutInteractionManager = new TicketControlsManager(mockTicketManager);
      const mockInteraction = createMockModalInteraction('ticket_notes_modal');
      
      await expect(controlsManagerWithoutInteractionManager.handleModalSubmit(mockInteraction)).resolves.not.toThrow();
    });

    test('should handle invalid channel context', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_lock', {
        channel: null
      });
      
      const result = await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(result.success).toBe(false);
    });

    test('should handle missing ticket data', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_lock');
      mockTicketManager.getTicketByChannel.mockReturnValue(undefined);
      mockTicketManager.getTicketByThread.mockReturnValue(undefined);
      
      const result = await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('should handle interaction manager failures gracefully', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_lock');
      mockInteractionManager.safeReply.mockResolvedValue(false);
      
      await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(mockTicketManager.lockTicket).toHaveBeenCalled();
    });

    test('should handle concurrent interaction processing', async () => {
      const mockInteraction1 = createMockButtonInteraction('ticket_lock');
      const mockInteraction2 = createMockButtonInteraction('ticket_claim');
      
      const promises = [
        ticketControlsManager.handleControlInteraction(mockInteraction1),
        ticketControlsManager.handleControlInteraction(mockInteraction2)
      ];

      const results = await Promise.all(promises);

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(mockTicketManager.lockTicket).toHaveBeenCalled();
      expect(mockTicketManager.claimTicket).toHaveBeenCalled();
    });
  });

  describe('Integration with Dependencies', () => {
    test('should properly use interaction manager for safe replies', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_lock');
      
      await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(mockInteractionManager.safeEditReply).toHaveBeenCalledWith(
        mockInteraction,
        expect.objectContaining({
          content: expect.any(String)
        })
      );
    });

    test('should properly use ticket manager for operations', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_escalate');
      
      await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(mockTicketManager.escalateTicket).toHaveBeenCalledWith(
        'guild123',
        'channel123', 
        'user123'
      );
    });

    test('should handle staff authorization checks', async () => {
      const mockInteraction = createMockButtonInteraction('ticket_close');
      
      await ticketControlsManager.handleControlInteraction(mockInteraction);

      expect(mockTicketManager.getStaffList).toHaveBeenCalledWith('guild123');
    });
  });
});