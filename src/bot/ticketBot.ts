import {
  Client,
  Events,
  Guild,
  GuildMember,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Interaction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  CategoryChannel,
  TextChannel,
  ApplicationCommandDataResolvable,
  Message,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  MessageFlags,
} from 'discord.js';
import {TicketManager} from './ticketManager.js';
import {CommandHandler} from './commandHandler.js';
import {InteractionManager} from '../modules/InteractionManager.js';
import {SupportChannelManager} from '../modules/SupportChannelManager.js';
import {TicketControlsManager} from '../modules/TicketControlsManager.js';
import {OperationQueue, OperationType, OperationPriority} from './operationQueue.js';
import { sendTicketSummary, TicketSendResult } from '../utils/transcriptSender.js';

/**
 * Main bot class
 */
export class TicketBot {
  private readonly client: Client;
  private readonly ticketManager: TicketManager;
  private readonly commandHandler: CommandHandler;
  private readonly interactionManager: InteractionManager;
  private readonly supportChannelManager: SupportChannelManager;
  private readonly ticketControlsManager: TicketControlsManager;
  private readonly operationQueue: OperationQueue;

  constructor(client: Client) {
    this.client = client;
    this.ticketManager = new TicketManager(this.client);
    this.interactionManager = new InteractionManager();
    this.supportChannelManager = new SupportChannelManager();
    this.commandHandler = new CommandHandler(this.ticketManager, this.interactionManager, this.supportChannelManager);
    this.ticketControlsManager = new TicketControlsManager(this.ticketManager, this.interactionManager);
    this.operationQueue = new OperationQueue();
    this.setupEventListeners();
  }

  /**
   * Starts the bot and logs in to Discord.
   */
  async start(): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      throw new Error('DISCORD_TOKEN environment variable is required');
    }

    try {
      await this.client.login(token);
      console.log('✅ Enhanced Support System: Bot successfully logged in');
      console.log('✅ Enhanced Support System: All modules loaded and integrated');
    } catch (error) {
      console.error('❌ Enhanced Support System: Failed to start bot:', error);
      throw error;
    }
  }

  /**
   * Validates the system configuration for a guild
   */
  async validateGuildConfiguration(guildId: string): Promise<{
    isValid: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];

    try {
      const supportChannels = this.supportChannelManager.getAllSupportChannels();
      const guildSupportChannels = Array.from(supportChannels.values())
        .filter(config => config.channelId.startsWith(guildId));

      if (guildSupportChannels.length === 0) {
        issues.push('No support channels configured for automated ticket creation');
      }

      const staffList = this.ticketManager.getStaffList(guildId);
      if (staffList.length === 0) {
        issues.push('No staff members configured for ticket management');
      }

      const presenceConfig = this.ticketManager.getPresenceConfig(guildId);
      if (!presenceConfig.enabled) {
        issues.push('Presence tracking disabled - staff availability will not be shown');
      }

      return {
        isValid: issues.length === 0,
        issues
      };
    } catch (error) {
      console.error('Error validating guild configuration:', error);
      return {
        isValid: false,
        issues: ['Failed to validate configuration due to system error']
      };
    }
  }

  /**
   * Validates and recovers ticket data after bot restart
   */
  private async validateAndRecoverTicketData(): Promise<void> {
    console.log('Enhanced Support System: Starting ticket data validation and recovery...');
    
    try {
      // Wait for ticket manager to be ready
      await this.ticketManager.ready;
      
      let totalTicketsChecked = 0;
      let staleTicketsRemoved = 0;
      let threadsRecovered = 0;
      
      // Get all guilds the bot is in
      for (const guild of this.client.guilds.cache.values()) {
        const guildTickets = this.ticketManager.getGuildTickets(guild.id);
        totalTicketsChecked += guildTickets.length;
        
        console.log(`Validating ${guildTickets.length} tickets for guild ${guild.name} (${guild.id})`);
        
        // Validate each ticket
        for (const ticket of guildTickets) {
          try {
            if (ticket.isThread && ticket.threadId) {
              // For thread tickets, check if the thread still exists
              const thread = await guild.channels.fetch(ticket.threadId).catch(() => null);
              
              if (!thread || !thread.isThread()) {
                console.warn(`Thread ticket ${ticket.threadId} no longer exists, removing from records`);
                this.ticketManager.closeTicket(guild.id, ticket.threadId);
                staleTicketsRemoved++;
              } else if (thread.isThread() && thread.archived) {
                console.log(`Thread ticket ${ticket.threadId} is archived but still exists, keeping in records`);
                threadsRecovered++;
              } else {
                console.log(`Thread ticket ${ticket.threadId} validated successfully`);
                threadsRecovered++;
              }
            } else if (!ticket.isThread && ticket.channelId) {
              // For channel tickets, check if the channel still exists
              const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
              
              if (!channel) {
                console.warn(`Channel ticket ${ticket.channelId} no longer exists, removing from records`);
                this.ticketManager.closeTicket(guild.id, ticket.channelId);
                staleTicketsRemoved++;
              } else {
                console.log(`Channel ticket ${ticket.channelId} validated successfully`);
              }
            } else {
              console.warn(`Ticket has invalid structure:`, {
                ticketNumber: ticket.ticketNumber,
                isThread: ticket.isThread,
                threadId: ticket.threadId,
                channelId: ticket.channelId
              });
            }
          } catch (error) {
            console.error(`Error validating ticket ${ticket.ticketNumber}:`, error);
          }
        }
      }
      
      console.log('Enhanced Support System: Ticket validation completed', {
        totalTicketsChecked,
        staleTicketsRemoved,
        threadsRecovered,
        guildsProcessed: this.client.guilds.cache.size
      });
      
    } catch (error) {
      console.error('Enhanced Support System: Failed during ticket data validation:', error);
    }
  }

  /**
   * Sets up event listeners for Discord events.
   */
  private setupEventListeners(): void {
    this.client.once(Events.ClientReady, this.onReady.bind(this));
    this.client.on(Events.InteractionCreate, this.onInteraction.bind(this));
    this.client.on(Events.MessageCreate, this.onMessage.bind(this));
    this.client.on(Events.PresenceUpdate, this.onPresenceUpdate.bind(this));
  }

  private async onReady(): Promise<void> {
    console.log(`Bot is ready! Logged in as ${this.client.user?.tag}`);
    
    this.supportChannelManager.setClient(this.client);
    
    try {
      await this.supportChannelManager.recoverChannelReferences();
      console.log('Enhanced Support System: Channel reference recovery completed');
    } catch (error) {
      console.error('Enhanced Support System: Failed to recover channel references:', error);
    }
    
    // Validate and recover existing ticket data
    try {
      await this.validateAndRecoverTicketData();
      console.log('Enhanced Support System: Ticket data validation and recovery completed');
    } catch (error) {
      console.error('Enhanced Support System: Failed to validate ticket data:', error);
    }
    
    this.registerCommands();
  }

  /**
   * Handles message events to capture ticket requests in support channels.
   */
  private async onMessage(message: Message): Promise<void> {
    if (message.author.bot) return;

    if (message.channel.type !== ChannelType.GuildText) return;
    const textChannel = message.channel as TextChannel;

    const { guild, member } = message;
    if (!guild || !member) return;

    if (!this.supportChannelManager.isSupportChannel(textChannel.id)) {
      return;
    }

    const existingTicket = this.ticketManager.getUserTicket(guild.id, member.id);
    if (existingTicket) {
      let ticketExists = false;
      let ticketReference = '';
      
      try {
        if (existingTicket.isThread && existingTicket.threadId) {
          const thread = await guild.channels.fetch(existingTicket.threadId);
          if (thread && thread.isThread() && !thread.archived) {
            ticketExists = true;
            ticketReference = `<#${existingTicket.threadId}>`;
          }
        } else if (existingTicket.channelId) {
          const channel = await guild.channels.fetch(existingTicket.channelId);
          if (channel) {
            ticketExists = true;
            ticketReference = `<#${existingTicket.channelId}>`;
          }
        }
      } catch (error) {
        console.log(`Ticket channel/thread ${existingTicket.isThread ? existingTicket.threadId : existingTicket.channelId} no longer exists, removing from records`);
        const ticketKey = existingTicket.isThread ? existingTicket.threadId : existingTicket.channelId;
        this.ticketManager.closeTicket(guild.id, ticketKey!);
        ticketExists = false;
      }
      
      if (ticketExists && ticketReference) {
        const reply = await message.reply({
          content: `You already have an open ticket: ${ticketReference}`,
          allowedMentions: { repliedUser: false }
        });
        
        setTimeout(() => reply.delete().catch(() => {}), 5000);
        return;
      }
    }

    const processResult = await this.supportChannelManager.processMessage(message);
    
    if (!processResult.success) {
      console.error('Enhanced Support System: Failed to process support message:', {
        error: processResult.error,
        guildId: guild.id,
        channelId: textChannel.id,
        userId: member.id
      });
      return;
    }

    // Check if DMs are disabled and send ephemeral warning
    if (processResult.dmAvailable === false) {
      try {
        const warningMsg = await message.reply({
          content: `⚠️ You need to enable DMs before creating a ticket. Ticket summaries are sent via direct message when tickets are closed. Please enable DMs and try again.`,
          allowedMentions: { repliedUser: true }
        });
        
        // Auto-delete the warning after 15 seconds
        setTimeout(() => {
          warningMsg.delete().catch(() => {
            console.warn('Failed to delete DM warning message');
          });
        }, 15000);
        
        console.log('Enhanced Support System: Sent DM warning reply to user', {
          guildId: guild.id,
          userId: member.id,
          username: member.user.username
        });
      } catch (error) {
        console.error('Enhanced Support System: Failed to send DM warning reply:', error);
      }
      return;
    }

    if (processResult.shouldCreateTicket) {
      try {
        await this.createTicketFromMessage(message);
        console.log('Enhanced Support System: Successfully created ticket', {
          guildId: guild.id,
          userId: member.id,
          username: member.user.username
        });
      } catch (error) {
        console.error('Enhanced Support System: Failed to create ticket from message:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          guildId: guild.id,
          userId: member.id
        });
      }
    }
  }

  /**
   * Checks if a user has DMs enabled by attempting to create a DM channel and send a test message
   */
  private async checkUserDMAvailability(user: any): Promise<boolean> {
    try {
      const dmChannel = await user.createDM();
      const testMessage = await dmChannel.send('DM test - this message will be deleted immediately');
      await testMessage.delete();
      console.log('TicketBot: DMs available for user', {
        userId: user.id,
        username: user.username
      });
      return true;
    } catch (error) {
      console.log('TicketBot: DMs unavailable for user', {
        userId: user.id,
        username: user.username,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Sends an ephemeral warning about DM unavailability
   */
  private async sendDMWarning(channel: TextChannel, member: GuildMember): Promise<void> {
    try {
      const warningMsg = await channel.send({
        content: `⚠️ ${member}, your DMs appear to be disabled. You won't receive ticket summaries when your ticket is closed, but your ticket has been created successfully.`
      });
      
      // Auto-delete the warning after 15 seconds
      setTimeout(() => {
        warningMsg.delete().catch(() => {
          console.warn('Failed to delete DM warning message');
        });
      }, 15000);
      
      console.log('TicketBot: Sent DM unavailability warning to user', {
        userId: member.id,
        channelId: channel.id
      });
    } catch (error) {
      console.error('TicketBot: Failed to send DM warning:', error);
    }
  }

  /**
   * Sends an ephemeral message about DM unavailability for ticket creation prevention
   */
  private async sendEphemeralDMWarning(interaction: ButtonInteraction): Promise<void> {
    try {
      await interaction.reply({
        content: '⚠️ Please enable your DMs before creating a ticket. Ticket summaries are sent via direct message when tickets are closed.',
        flags: MessageFlags.Ephemeral,
      });
      
      console.log('TicketBot: Sent ephemeral DM warning to user', {
        userId: interaction.user.id,
        guildId: interaction.guild?.id
      });
    } catch (error) {
      console.error('TicketBot: Failed to send ephemeral DM warning:', error);
    }
  }

  /**
   * Creates a ticket thread from a user's message.
   */
  private async createTicketFromMessage(message: Message): Promise<void> {
    const { guild, member, content, channel } = message;
    if (!guild || !member) return;

    try {
      // Check DM availability at the beginning of ticket creation process
      const dmAvailable = await this.checkUserDMAvailability(member.user);
      
      const ticketNumber = this.ticketManager.getNextTicketNumber(guild.id);
      const threadName = `ticket-${member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

      // Check if message still exists before trying to create thread
      let messageExists = true;
      try {
        await message.fetch();
      } catch (fetchError) {
        console.error('Message no longer exists, cannot create thread:', fetchError);
        messageExists = false;
      }

      let thread;
      if (messageExists) {
        // Message exists, create thread normally
        thread = await message.startThread({
          name: threadName,
          autoArchiveDuration: 10080,
          reason: `Support ticket #${ticketNumber} created by ${member.user.username}`,
        });
      } else {
        // Message doesn't exist, use fallback method
        await this.createFallbackTicketThread(guild, member, content, channel as TextChannel, ticketNumber, threadName);
        return;
      }

      this.ticketManager.createTicket(
        guild.id,
        member.id,
        channel.id,
        ticketNumber,
        threadName,
        content || 'No description provided',
        thread.id
      );

      const staffList = this.ticketManager.getStaffList(guild.id);
      for (const staffId of staffList) {
        try {
          await thread.members.add(staffId);
        } catch (error) {
          console.warn(`Failed to add staff member ${staffId} to thread:`, error);
        }
      }

      await thread.send({
        content: `${member} Welcome to your support ticket! Please describe your issue and our team will assist you shortly.`
      });

      // Add validation for description
      const validatedDescription = content && content.trim() ? content.trim() : undefined;

      // Use operation queue for proper ordering of ticket creation operations
      const batchId = `create-ticket-${member.id}-${Date.now()}`;
      console.log(`Starting ticket creation operations for user ${member.id}`);

      // HIGH PRIORITY: Create ticket controls with description
      this.operationQueue.enqueue({
        id: `${batchId}-create-controls`,
        type: OperationType.DATA,
        priority: OperationPriority.HIGH,
        description: `Create ticket controls for thread ${thread.id}`,
        execute: async () => {
          await this.ticketControlsManager.createTicketControls(thread as any, {
            ticketId: thread.id,
            ticketNumber: ticketNumber,
            creator: member.user,
            description: validatedDescription,
            claimedBy: undefined,
            isLocked: false,
            escalationLevel: 0,
            status: 'open'
          });
          return { controlsCreated: true };
        }
      });

      // MEDIUM PRIORITY: Send staff notifications
      this.operationQueue.enqueue({
        id: `${batchId}-staff-notification`,
        type: OperationType.UI_UPDATE,
        priority: OperationPriority.MEDIUM,
        description: `Send staff notification for new ticket`,
        execute: async () => {
          const staffPings = await this.getSmartStaffPings(guild.id, staffList);
          if (staffPings.trim()) {
            await thread.send({
              content: `🔔 ${staffPings} - New support ticket requires assistance.`
            });
          }
          return { notificationSent: true, staffPings };
        }
      });

      // LOW PRIORITY: Send DM warning if needed
      if (!dmAvailable) {
        this.operationQueue.enqueue({
          id: `${batchId}-dm-warning`,
          type: OperationType.CLEANUP,
          priority: OperationPriority.LOW,
          description: `Send DM unavailability warning`,
          execute: async () => {
            await this.sendDMWarning(channel as TextChannel, member);
            return { dmWarningSent: true };
          }
        });
      }

      // LOW PRIORITY: React to message
      this.operationQueue.enqueue({
        id: `${batchId}-react-message`,
        type: OperationType.CLEANUP,
        priority: OperationPriority.LOW,
        description: `React to original message`,
        execute: async () => {
          try {
            await message.react('✅');
            return { reactionAdded: true };
          } catch (reactError) {
            console.warn('Failed to react to message (may have been deleted):', reactError);
            return { reactionAdded: false, error: reactError instanceof Error ? reactError.message : String(reactError) };
          }
        }
      });

      // CRITICAL PRIORITY: Delete original message (ALWAYS LAST)
      const supportChannelConfig = this.supportChannelManager.getSupportChannelConfig(channel.id);
      if (supportChannelConfig?.deleteUserMessages) {
        this.operationQueue.enqueue({
          id: `${batchId}-delete-message`,
          type: OperationType.DELETE,
          priority: OperationPriority.CRITICAL,
          description: `Delete original user message`,
          execute: async () => {
            try {
              await message.delete();
              console.log('Original message deleted after successful thread creation');
              return { messageDeleted: true };
            } catch (deleteError) {
              console.warn('Failed to delete original message after thread creation:', deleteError);
              return { messageDeleted: false, error: deleteError instanceof Error ? deleteError.message : String(deleteError) };
            }
          },
          rollback: async () => {
            // Cannot rollback message deletion
            console.log('Cannot rollback message deletion');
          }
        });
      }

      // Process all operations in order
      console.log(`Processing ${this.operationQueue.getStatus().queueLength} operations for ticket creation`);
      const results = await this.operationQueue.processQueue();
      
      const successfulOps = results.filter(r => r.success).length;
      const totalOps = results.length;
      
      console.log(`Ticket creation completed: ${successfulOps}/${totalOps} operations successful`);

      // Original createTicketControls call removed as it's now handled by operation queue

    } catch (error) {
      console.error('Error creating ticket thread from message:', error);
      
      try {
        // Check if message still exists before trying to reply
        await message.fetch();
        const errorMsg = await message.reply({
          content: '❌ There was an error creating your ticket. Please try again or contact an administrator.',
          allowedMentions: { repliedUser: false }
        });
        
        setTimeout(() => errorMsg.delete().catch(() => {}), 10000);
      } catch (replyError) {
        console.error('Error sending error message (message may have been deleted):', replyError);
        try {
          const errorMsg = await (channel as TextChannel).send({
            content: `❌ ${member}, there was an error creating your ticket. Please try again or contact an administrator.`
          });
          setTimeout(() => errorMsg.delete().catch(() => {}), 10000);
        } catch (channelError) {
          console.error('Failed to send error message to channel:', channelError);
        }
      }
    }
  }

  /**
   * Creates a fallback ticket thread when the original message is no longer available.
   */
  private async createFallbackTicketThread(
    guild: Guild, 
    member: GuildMember, 
    content: string, 
    channel: TextChannel, 
    ticketNumber: number, 
    threadName: string
  ): Promise<void> {
    try {
      // Check DM availability for fallback ticket creation
      const dmAvailable = await this.checkUserDMAvailability(member.user);
      
      const tempMessage = await channel.send({
        content: `Support ticket requested by ${member.displayName}`,
        allowedMentions: { users: [] }
      });

      const thread = await tempMessage.startThread({
        name: threadName,
        autoArchiveDuration: 10080,
        reason: `Support ticket #${ticketNumber} created by ${member.user.username}`,
      });

      this.ticketManager.createTicket(
        guild.id,
        member.id,
        channel.id,
        ticketNumber,
        threadName,
        content || 'No description provided',
        thread.id
      );

      const staffList = this.ticketManager.getStaffList(guild.id);
      for (const staffId of staffList) {
        try {
          await thread.members.add(staffId);
        } catch (error) {
          console.warn(`Failed to add staff member ${staffId} to thread:`, error);
        }
      }

      await thread.send({
        content: `${member} Welcome to your support ticket! Please describe your issue and our team will assist you shortly.`
      });

      // Add validation for description in fallback
      const validatedDescription = content && content.trim() ? content.trim() : undefined;

      // Use operation queue for fallback ticket creation operations
      const batchId = `fallback-ticket-${member.id}-${Date.now()}`;
      console.log(`Starting fallback ticket creation operations for user ${member.id}`);

      // HIGH PRIORITY: Create ticket controls
      this.operationQueue.enqueue({
        id: `${batchId}-create-controls`,
        type: OperationType.DATA,
        priority: OperationPriority.HIGH,
        description: `Create ticket controls for fallback thread ${thread.id}`,
        execute: async () => {
          await this.ticketControlsManager.createTicketControls(thread as any, {
            ticketId: thread.id,
            ticketNumber: ticketNumber,
            creator: member.user,
            description: validatedDescription,
            claimedBy: undefined,
            isLocked: false,
            escalationLevel: 0,
            status: 'open'
          });
          return { controlsCreated: true };
        }
      });

      // MEDIUM PRIORITY: Send staff notifications
      this.operationQueue.enqueue({
        id: `${batchId}-staff-notification`,
        type: OperationType.UI_UPDATE,
        priority: OperationPriority.MEDIUM,
        description: `Send staff notification for fallback ticket`,
        execute: async () => {
          const staffPings = await this.getSmartStaffPings(guild.id, staffList);
          if (staffPings.trim()) {
            await thread.send({
              content: `🔔 ${staffPings} - New support ticket requires assistance.`
            });
          }
          return { notificationSent: true };
        }
      });

      // LOW PRIORITY: Send DM warning if needed
      if (!dmAvailable) {
        this.operationQueue.enqueue({
          id: `${batchId}-dm-warning`,
          type: OperationType.CLEANUP,
          priority: OperationPriority.LOW,
          description: `Send DM warning for fallback ticket`,
          execute: async () => {
            await this.sendDMWarning(channel, member);
            return { dmWarningSent: true };
          }
        });
      }

      // CRITICAL PRIORITY: Delete temporary message (ALWAYS LAST)
      this.operationQueue.enqueue({
        id: `${batchId}-delete-temp-message`,
        type: OperationType.DELETE,
        priority: OperationPriority.CRITICAL,
        description: `Delete temporary message used for thread creation`,
        execute: async () => {
          try {
            await tempMessage.delete();
            console.log('Temporary message deleted after fallback thread creation');
            return { tempMessageDeleted: true };
          } catch (deleteError) {
            console.warn('Failed to delete temporary message:', deleteError);
            return { tempMessageDeleted: false, error: deleteError instanceof Error ? deleteError.message : String(deleteError) };
          }
        }
      });

      // Process all operations in order
      console.log(`Processing ${this.operationQueue.getStatus().queueLength} operations for fallback ticket creation`);
      const results = await this.operationQueue.processQueue();
      
      const successfulOps = results.filter(r => r.success).length;
      console.log(`Fallback ticket creation completed: ${successfulOps}/${results.length} operations successful`);

      console.log('Fallback ticket thread created successfully');
    } catch (error) {
      console.error('Error creating fallback ticket thread:', error);
      throw error;
    }
  }

  /**
   * Handles presence update events to track staff availability.
   */
  private async onPresenceUpdate(oldPresence: any, newPresence: any): Promise<void> {
    if (!newPresence || !newPresence.guild) return;
    
    const { guild } = newPresence;
    const userId = newPresence.userId || newPresence.user?.id;
    
    if (!userId || !this.ticketManager.isStaff(guild.id, userId)) {
      return;
    }

    const presenceConfig = this.ticketManager.getPresenceConfig(guild.id);
    if (!presenceConfig.enabled) {
      return;
    }

    const newStatus = newPresence.status || 'offline';
    
    console.log(`Staff member ${userId} in guild ${guild.id} changed status from ${oldPresence?.status || 'unknown'} to ${newStatus}`);

    const presenceUpdate = this.ticketManager.updateStaffPresence(guild.id, userId, newStatus);

    if (presenceUpdate.wasOffline && presenceUpdate.isNowAvailable && presenceConfig.smartPing.offlineQueueing) {
      const offlineQueue = this.ticketManager.getOfflineQueue(guild.id);
      if (offlineQueue.length > 0) {
        try {
          const member = await guild.members.fetch(userId);
          const queueMessage = this.buildOfflineQueueNotification(offlineQueue);
          await member.send({
            content: `👋 Welcome back! While you were offline, ${offlineQueue.length} ticket(s) were created and need attention:`,
            embeds: [queueMessage]
          });
          console.log(`Notified ${userId} about ${offlineQueue.length} queued tickets`);
        } catch (error) {
          console.error(`Failed to notify ${userId} about offline queue:`, error);
        }
      }
    }

    if (presenceConfig.showInEmbeds) {
      try {
        const allStaffPresence = this.ticketManager.getAllStaffPresences(guild.id);
        const presenceMap = new Map<string, { status: string; lastSeen: Date }>();
        
        allStaffPresence.forEach(presence => {
          presenceMap.set(presence.userId, {
            status: presence.status,
            lastSeen: presence.lastSeen
          });
        });
        
        console.log(`Updating staff presence embeds for guild ${guild.id} with status map:`, 
          Array.from(presenceMap.entries()).map(([id, data]) => `${id}: ${data.status}`));
        
        await this.supportChannelManager.updateStaffPresenceEmbed(guild.id, presenceMap, guild);
        console.log(`Successfully updated staff presence embeds for guild ${guild.id}`);
      } catch (error) {
        console.error('Failed to update staff presence embeds:', error);
      }
    }
  }

  /**
   * Generates smart staff pings based on presence status.
   */
  private async getSmartStaffPings(guildId: string, staffList: string[]): Promise<string> {
    if (staffList.length === 0) {
      return 'No staff members configured. Use `/addstaff` to add staff.';
    }

    const presenceConfig = this.ticketManager.getPresenceConfig(guildId);
    
    if (!presenceConfig.enabled || !presenceConfig.smartPing.enabled) {
      return staffList.map((id: string) => `<@${id}>`).join(' ');
    }

    const onlineStaff: string[] = [];
    const idleStaff: string[] = [];
    const dndStaff: string[] = [];
    const offlineStaff: string[] = [];

    for (const staffId of staffList) {
      const presence = this.ticketManager.getStaffPresence(guildId, staffId);
      if (!presence) {
        offlineStaff.push(staffId);
        continue;
      }

      switch (presence.status) {
        case 'online':
          onlineStaff.push(staffId);
          break;
        case 'idle':
          idleStaff.push(staffId);
          break;
        case 'dnd':
          dndStaff.push(staffId);
          break;
        case 'offline':
        default:
          offlineStaff.push(staffId);
          break;
      }
    }

    const pings: string[] = [];

    if (onlineStaff.length > 0) {
      pings.push(...onlineStaff.map(id => `<@${id}>`));
    }

    if (idleStaff.length > 0) {
      pings.push(...idleStaff.map(id => `<@${id}>`));
    }

    if (dndStaff.length > 0 && presenceConfig.smartPing.dndMentionOnly) {
      pings.push(...dndStaff.map(id => `<@${id}>`));
    }

    if (offlineStaff.length > 0 && presenceConfig.smartPing.offlineQueueing) {
      const totalAvailableStaff = onlineStaff.length + idleStaff.length + 
        (presenceConfig.smartPing.dndMentionOnly ? dndStaff.length : 0);
      
      if (totalAvailableStaff === 0) {
        return 'All staff are currently offline. Your ticket has been queued and staff will be notified when they return.';
      }
    }

    return pings.length > 0 ? pings.join(' ') : 'No staff currently available.';
  }

  /**
   * Builds an embed notification for offline queue
   */
  private buildOfflineQueueNotification(queue: any[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('🎫 Queued Tickets - Staff Notification')
      .setColor(0xFF6B35)
      .setDescription(`${queue.length} ticket(s) were created while you were offline and need attention.`)
      .setTimestamp();

    const recentTickets = queue.slice(-5).reverse();
    for (const ticket of recentTickets) {
      const timeAgo = Math.floor((Date.now() - new Date(ticket.createdAt).getTime()) / (1000 * 60));
      embed.addFields({
        name: `🆔 ${ticket.ticketId}`,
        value: `**User:** <@${ticket.userId}>\n**Channel:** <#${ticket.channelId}>\n**Created:** ${timeAgo}m ago\n**Description:** ${ticket.description.substring(0, 100)}${ticket.description.length > 100 ? '...' : ''}`,
        inline: false
      });
    }

    if (queue.length > 5) {
      embed.setFooter({ text: `Showing 5 of ${queue.length} total queued tickets.` });
    }

    return embed;
  }

  /**
   * Queues a ticket for offline staff notification
   */
  async queueTicketForOfflineStaff(ticket: any, guildId: string): Promise<boolean> {
    try {
      const queuedNotification = {
        ticketId: ticket.channelId || `ticket-${ticket.ticketNumber}`,
        guildId: guildId,
        channelId: ticket.channelId,
        userId: ticket.userId,
        description: ticket.description || 'No description provided',
        createdAt: ticket.createdAt || new Date(),
        priority: 'normal' as const
      };

      return this.ticketManager.queueOfflineTicket(queuedNotification);
    } catch (error) {
      console.error('Failed to queue ticket for offline staff:', error);
      return false;
    }
  }

  /**
   * Handles all interaction events
   */
  private async onInteraction(interaction: Interaction): Promise<void> {
    const isCommand = interaction.isChatInputCommand && interaction.isChatInputCommand();
    const isButton = interaction.isButton && interaction.isButton();
    const isModal = interaction.isModalSubmit && interaction.isModalSubmit();

    try {
      if (isCommand) {
        await this.commandHandler.handleCommand(
          interaction as ChatInputCommandInteraction
        );
      } else if (isButton) {
        await this.handleButtonInteraction(interaction as ButtonInteraction);
      } else if (isModal) {
        await this.handleModalInteraction(interaction as ModalSubmitInteraction);
      }
    } catch (error) {
      console.error('Error handling interaction:', error);
      const errorMessage = 'An error occurred while processing your request.';

      if (isCommand || isButton || isModal) {
        const actionable = interaction as ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
        if (actionable.replied || actionable.deferred) {
          await actionable.followUp({content: errorMessage, flags: MessageFlags.Ephemeral});
        } else {
          await actionable.reply({content: errorMessage, flags: MessageFlags.Ephemeral});
        }
      } else {
        console.error('Cannot send error reply for this interaction type.');
      }
    }
  }

  private async handleModalInteraction(
    interaction: ModalSubmitInteraction
  ): Promise<void> {
    const { customId, guild } = interaction;

    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (customId.startsWith('ticket_notes_') || customId.startsWith('ticket_whitelist_')) {
      try {
        await this.ticketControlsManager.handleModalSubmit(interaction);
      } catch (error) {
        console.error('Error handling ticket controls modal:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ An error occurred while processing your request.',
            flags: MessageFlags.Ephemeral,
          });
        }
      }
      return;
    }

    if (customId === 'rename_ticket_modal') {
      await this.handleRenameTicketModal(interaction, guild);
    }
  }

  private async handleRenameTicketModal(
    interaction: ModalSubmitInteraction,
    guild: Guild
  ): Promise<void> {
    const { channel } = interaction;
    if (!channel) {
      await interaction.reply({
        content: 'This can only be used in a ticket channel or thread.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ticketId = channel.isThread() ? channel.id : channel.id;
    const ticket = this.ticketManager.getTicket(guild.id, ticketId);
    
    if (!ticket) {
      await interaction.reply({
        content: 'This channel is not a valid ticket.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const newName = interaction.fields.getTextInputValue('new_name');
    const sanitizedName = `ticket-${newName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    try {
      if (channel.isThread()) {
        await channel.setName(sanitizedName);
      } else if (channel.type === ChannelType.GuildText) {
        const textChannel = channel as TextChannel;
        await textChannel.setName(sanitizedName);
      }

      const embed = new EmbedBuilder()
        .setTitle('✏️ Ticket Renamed')
        .setDescription(`This ticket has been renamed to **${sanitizedName}** by ${interaction.user.displayName}.`)
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
      });
    } catch (error) {
      console.error('Error renaming ticket:', error);
      await interaction.reply({
        content: 'Failed to rename the ticket. Please try again.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async handleButtonInteraction(
    interaction: ButtonInteraction
  ): Promise<void> {
    const {customId, guild} = interaction;

    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let guildMember: GuildMember;
    try {
      if (interaction.member && interaction.member instanceof GuildMember) {
        guildMember = interaction.member as GuildMember;
      } else {
        guildMember = await guild.members.fetch(interaction.user.id);
      }
    } catch (err) {
      console.error('Failed to fetch guild member:', err);
      await interaction.reply({
        content: 'Unable to resolve your member information.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (customId.startsWith('ticket_')) {
      try {
        const result = await this.ticketControlsManager.handleControlInteraction(
          interaction
        );
        
        if (!result.success && result.error) {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: `❌ ${result.error}`,
              flags: MessageFlags.Ephemeral,
            });
          }
        }
      } catch (error) {
        console.error('Error handling ticket controls button:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ An error occurred while processing your request.',
            flags: MessageFlags.Ephemeral,
          });
        }
      }
      return;
    }

    switch (customId) {
      case 'create_ticket':
        await this.createTicket(interaction, guild, guildMember);
        break;
      case 'close_ticket':
        await this.closeTicket(interaction, guild, guildMember);
        break;
      case 'claim_ticket':
        await this.claimTicket(interaction, guild, guildMember);
        break;
      case 'lock_ticket':
        await this.lockTicket(interaction, guild, guildMember);
        break;
      case 'unlock_ticket':
        await this.unlockTicket(interaction, guild, guildMember);
        break;
      case 'rename_ticket':
        await this.renameTicket(interaction, guild, guildMember);
        break;
      default:
        await interaction.reply({
          content: 'Unknown button interaction.',
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async createTicket(
    interaction: ButtonInteraction,
    guild: Guild,
    member: GuildMember
  ): Promise<void> {
    // Check DM availability before ticket creation
    const dmAvailable = await this.checkUserDMAvailability(member.user);
    if (!dmAvailable) {
      await this.sendEphemeralDMWarning(interaction);
      return;
    }

    const existingTicket = this.ticketManager.getUserTicket(
      guild.id,
      member.id
    );

    if (existingTicket) {
      let ticketExists = false;
      let ticketReference = '';
      
      try {
        if (existingTicket.isThread && existingTicket.threadId) {
          const thread = await guild.channels.fetch(existingTicket.threadId);
          if (thread && thread.isThread() && !thread.archived) {
            ticketExists = true;
            ticketReference = `<#${existingTicket.threadId}>`;
          }
        } else if (existingTicket.channelId) {
          const channel = await guild.channels.fetch(existingTicket.channelId);
          if (channel) {
            ticketExists = true;
            ticketReference = `<#${existingTicket.channelId}>`;
          }
        }
      } catch (error) {
        console.log(`Ticket channel/thread ${existingTicket.isThread ? existingTicket.threadId : existingTicket.channelId} no longer exists, removing from records`);
        const ticketKey = existingTicket.isThread ? existingTicket.threadId : existingTicket.channelId;
        this.ticketManager.closeTicket(guild.id, ticketKey!);
        ticketExists = false;
      }
      
      if (ticketExists && ticketReference) {
        await interaction.reply({
          content: `You already have an open ticket: ${ticketReference}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferReply({flags: MessageFlags.Ephemeral});

    const categoryName = 'Tickets';
    let category = guild.channels.cache.find(
      c => c.name === categoryName && c.type === ChannelType.GuildCategory
    ) as CategoryChannel;

    if (!category) {
      category = await guild.channels.create({
        name: categoryName,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
        ],
      });
    }

    const ticketNumber = this.ticketManager.getNextTicketNumber(guild.id);
    const channelName = `ticket-${String(ticketNumber).padStart(4, '0')}`;

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });

    this.ticketManager.createTicket(guild.id, member.id, channel.id, ticketNumber, channelName);

    const embed = new EmbedBuilder()
      .setTitle(`Ticket #${ticketNumber}`)
      .setDescription(
        `Hello ${member.displayName}! Thank you for creating a ticket. Please describe your issue and a staff member will assist you shortly.`
      )
      .setColor(0x00ff00)
      .setTimestamp();

    const closeButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒')
    );

    await channel.send({
      content: `${member}`,
      embeds: [embed],
      components: [closeButton],
    });

    await interaction.editReply({
      content: `Your ticket has been created: ${channel}`,
    });
  }

  private async closeTicket(
    interaction: ButtonInteraction,
    guild: Guild,
    guildMember: GuildMember
  ): Promise<void> {
    const {channel} = interaction;

    if (!guild || !guildMember || !channel) {
      await interaction.reply({
        content: 'Unable to close ticket.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channelId = channel.isThread() ? channel.parent?.id : channel.id;
    const ticketId = channel.isThread() ? channel.id : channel.id;
    
    if (!channelId) {
      await interaction.reply({
        content: 'Unable to determine ticket location.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ticket = this.ticketManager.getTicket(guild.id, ticketId);

    if (!ticket) {
      await interaction.reply({
        content: 'This channel is not a valid ticket.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isTicketOwner = ticket.userId === guildMember.id;
    const hasManageChannels = guildMember.permissions?.has(
      PermissionFlagsBits.ManageChannels
    );
    const isStaff = this.ticketManager.isStaff(guild.id, guildMember.id);

    if (!isTicketOwner && !hasManageChannels && !isStaff) {
      await interaction.reply({
        content: 'You do not have permission to close this ticket.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    // Close the ticket with transcript generation
    const closeResult = await this.ticketManager.closeTicketWithAuth(guild.id, ticketId, guildMember.id, true);
    if (!closeResult.success) {
      await interaction.editReply({
        content: 'Failed to close ticket.',
      });
      return;
    }

    // Send enhanced transcript to ticket owner
    const transcriptResult: TicketSendResult = await sendTicketSummary(
      closeResult.summary!,
      this.client
    );

    let description = `This ticket has been closed by ${guildMember.displayName}.`;
    if (transcriptResult.wasSent) {
      description += '\n📨 A transcript has been sent to the user via DM.';
    } else {
      description += `\n⚠️ Could not send transcript via DM: ${transcriptResult.error?.message || 'Unknown error'}`;
    }

    const embed = new EmbedBuilder()
      .setTitle('🔒 Ticket Closed')
      .setDescription(description)
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.editReply({embeds: [embed]});

    setTimeout(async () => {
      try {
        if (channel.isThread()) {
          await channel.setArchived(true);
          await channel.setLocked(true);
        } else if (channel.type === ChannelType.GuildText) {
          await (channel as TextChannel).delete();
        }
      } catch (error) {
        console.error('Error closing ticket:', error);
      }
    }, 5000);
  }

  /**
   * Claims a ticket for a staff member.
   */
  private async claimTicket(
    interaction: ButtonInteraction,
    guild: Guild,
    guildMember: GuildMember
  ): Promise<void> {
    const { channel } = interaction;
    if (!channel) {
      await interaction.reply({
        content: 'Unable to claim ticket.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!this.ticketManager.isStaff(guild.id, guildMember.id)) {
      await interaction.reply({
        content: 'You must be a staff member to claim tickets.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ticketId = channel.isThread() ? channel.id : channel.id;
    const ticket = this.ticketManager.getTicket(guild.id, ticketId);
    
    if (!ticket) {
      await interaction.reply({
        content: 'This channel is not a valid ticket.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (ticket.claimedBy) {
      await interaction.reply({
        content: `This ticket is already claimed by <@${ticket.claimedBy}>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const success = this.ticketManager.claimTicket(guild.id, ticketId, guildMember.id);
    if (success) {
      const embed = new EmbedBuilder()
        .setTitle('🎫 Ticket Claimed')
        .setDescription(`This ticket has been claimed by ${guildMember.displayName}.`)
        .setColor(0x00ff00)
        .setTimestamp();

      const updatedButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('claim_ticket')
          .setLabel('Claim Ticket')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('👤')
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒'),
        new ButtonBuilder()
          .setCustomId('lock_ticket')
          .setLabel('Lock Ticket')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔐'),
        new ButtonBuilder()
          .setCustomId('rename_ticket')
          .setLabel('Rename')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✏️')
      );

      await interaction.reply({
        embeds: [embed],
        components: [updatedButtons],
      });
    } else {
      await interaction.reply({
        content: 'Failed to claim ticket.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Locks a ticket.
   */
  private async lockTicket(
    interaction: ButtonInteraction,
    guild: Guild,
    guildMember: GuildMember
  ): Promise<void> {
    const { channel } = interaction;
    if (!channel) {
      await interaction.reply({
        content: 'Unable to lock ticket.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!this.ticketManager.isStaff(guild.id, guildMember.id)) {
      await interaction.reply({
        content: 'You must be a staff member to lock tickets.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ticketId = channel.isThread() ? channel.id : channel.id;
    const success = this.ticketManager.lockTicket(guild.id, ticketId, guildMember.id);
    
    if (success) {
      const embed = new EmbedBuilder()
        .setTitle('🔐 Ticket Locked')
        .setDescription(`This ticket has been locked by ${guildMember.displayName}.`)
        .setColor(0xffa500)
        .setTimestamp();

      const updatedButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('claim_ticket')
          .setLabel('Claim Ticket')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('👤')
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒'),
        new ButtonBuilder()
          .setCustomId('unlock_ticket')
          .setLabel('Unlock Ticket')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🔓'),
        new ButtonBuilder()
          .setCustomId('rename_ticket')
          .setLabel('Rename')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✏️')
      );

      await interaction.reply({
        embeds: [embed],
        components: [updatedButtons],
      });

      const ticket = this.ticketManager.getTicket(guild.id, ticketId);
      if (ticket && channel.isThread()) {
        try {
          await channel.members.remove(ticket.userId);
        } catch (error) {
          console.warn('Failed to remove user from locked thread:', error);
        }
      }
    } else {
      await interaction.reply({
        content: 'Failed to lock ticket. You may not have permission or the ticket is already locked.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Unlocks a ticket.
   */
  private async unlockTicket(
    interaction: ButtonInteraction,
    guild: Guild,
    guildMember: GuildMember
  ): Promise<void> {
    const { channel } = interaction;
    if (!channel) {
      await interaction.reply({
        content: 'Unable to unlock ticket.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ticketId = channel.isThread() ? channel.id : channel.id;
    const ticket = this.ticketManager.getTicket(guild.id, ticketId);
    
    if (!ticket) {
      await interaction.reply({
        content: 'This channel is not a valid ticket.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (ticket.claimedBy !== guildMember.id) {
      await interaction.reply({
        content: 'Only the staff member who claimed this ticket can unlock it.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const success = this.ticketManager.unlockTicket(guild.id, ticketId, guildMember.id);
    if (success) {
      const embed = new EmbedBuilder()
        .setTitle('🔓 Ticket Unlocked')
        .setDescription(`This ticket has been unlocked by ${guildMember.displayName}.`)
        .setColor(0x00ff00)
        .setTimestamp();

      const updatedButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('claim_ticket')
          .setLabel('Claim Ticket')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('👤')
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒'),
        new ButtonBuilder()
          .setCustomId('lock_ticket')
          .setLabel('Lock Ticket')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔐'),
        new ButtonBuilder()
          .setCustomId('rename_ticket')
          .setLabel('Rename')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✏️')
      );

      await interaction.reply({
        embeds: [embed],
        components: [updatedButtons],
      });

      if (channel.isThread()) {
        try {
          await channel.members.add(ticket.userId);
        } catch (error) {
          console.warn('Failed to re-add user to unlocked thread:', error);
        }
      }
    } else {
      await interaction.reply({
        content: 'Failed to unlock ticket.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Handles ticket renaming via modal.
   */
  private async renameTicket(
    interaction: ButtonInteraction,
    guild: Guild,
    guildMember: GuildMember
  ): Promise<void> {
    if (!this.ticketManager.isStaff(guild.id, guildMember.id)) {
      await interaction.reply({
        content: 'You must be a staff member to rename tickets.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('rename_ticket_modal')
      .setTitle('Rename Ticket');

    const nameInput = new TextInputBuilder()
      .setCustomId('new_name')
      .setLabel('New Ticket Name')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter new ticket name (without ticket- prefix)')
      .setRequired(true)
      .setMaxLength(50);

    const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
  }

  private async registerCommands(): Promise<void> {
    const commands = this.commandHandler.getCommands() as
      | ApplicationCommandDataResolvable[]
      | undefined;

    if (this.client.application && commands) {
      await this.client.application.commands.set(commands);
      console.log('Commands registered successfully!');
    }
  }
}
