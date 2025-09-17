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
} from 'discord.js';
import {TicketManager} from './ticketManager.js';
import {CommandHandler} from './commandHandler.js';
import {InteractionManager} from '../modules/InteractionManager.js';
import {SupportChannelManager} from '../modules/SupportChannelManager.js';
import {TicketControlsManager} from '../modules/TicketControlsManager.js';

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

  constructor(client: Client) {
    this.client = client;
    this.ticketManager = new TicketManager();
    this.interactionManager = new InteractionManager();
    this.supportChannelManager = new SupportChannelManager();
    this.commandHandler = new CommandHandler(this.ticketManager, this.interactionManager, this.supportChannelManager);
    this.ticketControlsManager = new TicketControlsManager(this.ticketManager, this.interactionManager);
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
   * Sets up event listeners for Discord events.
   */
  private setupEventListeners(): void {
    this.client.once(Events.ClientReady, this.onReady.bind(this));
    this.client.on(Events.InteractionCreate, this.onInteraction.bind(this));
    this.client.on(Events.MessageCreate, this.onMessage.bind(this));
    this.client.on(Events.PresenceUpdate, this.onPresenceUpdate.bind(this));
  }

  private onReady(): void {
    console.log(`Bot is ready! Logged in as ${this.client.user?.tag}`);
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
   * Creates a ticket thread from a user's message.
   */
  private async createTicketFromMessage(message: Message): Promise<void> {
    const { guild, member, content, channel } = message;
    if (!guild || !member) return;

    try {
      const ticketNumber = this.ticketManager.getNextTicketNumber(guild.id);
      const threadName = `ticket-${member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

      try {
        await message.fetch();
      } catch (fetchError) {
        console.error('Message no longer exists, cannot create thread:', fetchError);
        await this.createFallbackTicketThread(guild, member, content, channel as TextChannel, ticketNumber, threadName);
        return;
      }

      const thread = await message.startThread({
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
        content,
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

      await this.ticketControlsManager.createTicketControls(thread as any, {
        ticketId: thread.id,
        ticketNumber: ticketNumber,
        creator: member.user,
        claimedBy: undefined,
        isLocked: false,
        escalationLevel: 0,
        status: 'open'
      });

      const staffPings = await this.getSmartStaffPings(guild.id, staffList);

      if (staffPings.trim()) {
        await thread.send({
          content: `🔔 ${staffPings} - New support ticket requires assistance.`
        });
      }

      await message.react('✅');

      const supportChannelConfig = this.supportChannelManager.getSupportChannelConfig(channel.id);
      if (supportChannelConfig?.deleteUserMessages) {
        try {
          await message.delete();
          console.log('Original message deleted after successful thread creation');
        } catch (deleteError) {
          console.warn('Failed to delete original message after thread creation:', deleteError);
        }
      }

    } catch (error) {
      console.error('Error creating ticket thread from message:', error);
      
      try {
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
        content,
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

      await this.ticketControlsManager.createTicketControls(thread as any, {
        ticketId: thread.id,
        ticketNumber: ticketNumber,
        creator: member.user,
        claimedBy: undefined,
        isLocked: false,
        escalationLevel: 0,
        status: 'open'
      });

      const staffPings = await this.getSmartStaffPings(guild.id, staffList);

      if (staffPings.trim()) {
        await thread.send({
          content: `🔔 ${staffPings} - New support ticket requires assistance.`
        });
      }

      try {
        await tempMessage.delete();
      } catch (deleteError) {
        console.warn('Failed to delete temporary message:', deleteError);
      }

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
          await actionable.followUp({content: errorMessage, ephemeral: true});
        } else {
          await actionable.reply({content: errorMessage, ephemeral: true});
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
        ephemeral: true,
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
            ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    const ticketId = channel.isThread() ? channel.id : channel.id;
    const ticket = this.ticketManager.getTicket(guild.id, ticketId);
    
    if (!ticket) {
      await interaction.reply({
        content: 'This channel is not a valid ticket.',
        ephemeral: true,
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
        ephemeral: true,
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
        ephemeral: true,
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
        ephemeral: true,
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
              ephemeral: true,
            });
          }
        }
      } catch (error) {
        console.error('Error handling ticket controls button:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ An error occurred while processing your request.',
            ephemeral: true,
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
          ephemeral: true,
        });
    }
  }

  private async createTicket(
    interaction: ButtonInteraction,
    guild: Guild,
    member: GuildMember
  ): Promise<void> {
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
          ephemeral: true,
        });
        return;
      }
    }

    await interaction.deferReply({ephemeral: true});

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
        ephemeral: true,
      });
      return;
    }

    const channelId = channel.isThread() ? channel.parent?.id : channel.id;
    const ticketId = channel.isThread() ? channel.id : channel.id;
    
    if (!channelId) {
      await interaction.reply({
        content: 'Unable to determine ticket location.',
        ephemeral: true,
      });
      return;
    }

    const ticket = this.ticketManager.getTicket(guild.id, ticketId);

    if (!ticket) {
      await interaction.reply({
        content: 'This channel is not a valid ticket.',
        ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const embed = new EmbedBuilder()
      .setTitle('🔒 Ticket Closed')
      .setDescription(
        `This ticket has been closed by ${guildMember.displayName}.`
      )
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.editReply({embeds: [embed]});

    this.ticketManager.closeTicket(guild.id, ticketId);

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
        ephemeral: true,
      });
      return;
    }

    if (!this.ticketManager.isStaff(guild.id, guildMember.id)) {
      await interaction.reply({
        content: 'You must be a staff member to claim tickets.',
        ephemeral: true,
      });
      return;
    }

    const ticketId = channel.isThread() ? channel.id : channel.id;
    const ticket = this.ticketManager.getTicket(guild.id, ticketId);
    
    if (!ticket) {
      await interaction.reply({
        content: 'This channel is not a valid ticket.',
        ephemeral: true,
      });
      return;
    }

    if (ticket.claimedBy) {
      await interaction.reply({
        content: `This ticket is already claimed by <@${ticket.claimedBy}>.`,
        ephemeral: true,
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
        ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    if (!this.ticketManager.isStaff(guild.id, guildMember.id)) {
      await interaction.reply({
        content: 'You must be a staff member to lock tickets.',
        ephemeral: true,
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
        ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    const ticketId = channel.isThread() ? channel.id : channel.id;
    const ticket = this.ticketManager.getTicket(guild.id, ticketId);
    
    if (!ticket) {
      await interaction.reply({
        content: 'This channel is not a valid ticket.',
        ephemeral: true,
      });
      return;
    }

    if (ticket.claimedBy !== guildMember.id) {
      await interaction.reply({
        content: 'Only the staff member who claimed this ticket can unlock it.',
        ephemeral: true,
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
        ephemeral: true,
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
        ephemeral: true,
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