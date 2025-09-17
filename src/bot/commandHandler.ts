import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ApplicationCommandDataResolvable,
  TextChannel,
  ChannelType,
  CategoryChannel,
} from 'discord.js';
import {TicketManager} from './ticketManager.js';
import {SupportChannelManager} from '../modules/SupportChannelManager.js';
import {InteractionManager} from '../modules/InteractionManager.js';
import {
  EMBED_COLORS,
  SUPPORT_MESSAGES,
  STATUS_EMOJIS,
  VALID_PRESENCE_STATUSES,
  ValidPresenceStatus,
  DEFAULT_CATEGORIES,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '../constants/commands';

/**
 * Handles slash commands
 */
export class CommandHandler {
  private readonly ticketManager: TicketManager;
  private readonly supportChannelManager: SupportChannelManager;
  private readonly interactionManager: InteractionManager;
  private readonly commandMap: Map<string, (interaction: ChatInputCommandInteraction) => Promise<void>>;

  constructor(
    ticketManager: TicketManager, 
    interactionManager: InteractionManager,
    supportChannelManager: SupportChannelManager
  ) {
    this.ticketManager = ticketManager;
    this.supportChannelManager = supportChannelManager;
    this.interactionManager = interactionManager;
    this.commandMap = new Map([
      ['ticket-stats', this.handleTicketStats.bind(this)],
      ['addstaff', this.handleAddStaff.bind(this)],
      ['removestaff', this.handleRemoveStaff.bind(this)],
      ['setup-support', this.handleSetupSupport.bind(this)],
      ['presence-tracking', this.handlePresenceTracking.bind(this)],
      ['staff-status', this.handleStaffStatus.bind(this)],
    ]);
  }

  async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const {commandName} = interaction;

    const handler = this.commandMap.get(commandName);
    if (handler) {
      await handler(interaction);
    } else {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.UNKNOWN_COMMAND,
        ephemeral: true,
      });
    }
  }

  /**
   * Normalizes presence status to ensure it's one of the known valid statuses
   */
  private normalizePresenceStatus(status: string | undefined): ValidPresenceStatus {
    if (status && VALID_PRESENCE_STATUSES.includes(status as ValidPresenceStatus)) {
      return status as ValidPresenceStatus;
    }
    return 'offline';
  }

  /**
   * Checks if a channel is text-capable (can send messages)
   */
  private isTextCapableChannel(channel: any): channel is TextChannel {
    return channel && (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement
    ) && typeof channel.send === 'function';
  }



  /**
   * Shows ticket statistics for the guild.
   */
  private async handleTicketStats(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const {guild} = interaction;

    if (!guild) {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.GUILD_ONLY,
        ephemeral: true,
      });
      return;
    }

    const totalTickets = this.ticketManager.getTotalTickets(guild.id);
    const activeTickets = this.ticketManager.getGuildTickets(guild.id) ?? [];

    const embed = new EmbedBuilder()
      .setTitle('📊 Ticket Statistics')
      .addFields(
        {
          name: 'Total Tickets Created',
          value: totalTickets.toString(),
          inline: true,
        },
        {
          name: 'Active Tickets',
          value: activeTickets.length.toString(),
          inline: true,
        },
        {
          name: 'Closed Tickets',
          value: (totalTickets - activeTickets.length).toString(),
          inline: true,
        }
      )
      .setColor(EMBED_COLORS.PRIMARY)
      .setTimestamp();

    await this.interactionManager.safeReply(interaction, {embeds: [embed], ephemeral: true});
  }

  /**
   * Adds a staff member to the ticket system.
   */
  private async handleAddStaff(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const {guild} = interaction;

    if (!guild) {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.GUILD_ONLY,
        ephemeral: true,
      });
      return;
    }

    const memberPermissions = interaction.memberPermissions;
    if (!memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.MISSING_PERMISSIONS,
        ephemeral: true,
      });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);
    
    try {
      const wasAdded = await this.ticketManager.addStaff(guild.id, targetUser.id);

      if (wasAdded) {
        await this.interactionManager.safeReply(interaction, {
          content: SUCCESS_MESSAGES.STAFF_ADDED(targetUser.username),
          ephemeral: true,
        });
      } else {
        await this.interactionManager.safeReply(interaction, {
          content: `${targetUser.username} is already a staff member.`,
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error('Failed to add staff member:', error);
      await this.interactionManager.safeReply(interaction, {
        content: `❌ Failed to add ${targetUser.username} as a staff member. Please try again.`,
        ephemeral: true,
      });
    }
  }

  /**
   * Removes a staff member from the ticket system.
   */
  private async handleRemoveStaff(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const {guild} = interaction;

    if (!guild) {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.GUILD_ONLY,
        ephemeral: true,
      });
      return;
    }

    const memberPermissions = interaction.memberPermissions;
    if (!memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.MISSING_PERMISSIONS,
        ephemeral: true,
      });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);
    
    try {
      const wasRemoved = await this.ticketManager.removeStaff(guild.id, targetUser.id);

      if (wasRemoved) {
        await this.interactionManager.safeReply(interaction, {
          content: SUCCESS_MESSAGES.STAFF_REMOVED(targetUser.username),
          ephemeral: true,
        });
      } else {
        await this.interactionManager.safeReply(interaction, {
          content: `${targetUser.username} was not a staff member.`,
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error('Failed to remove staff member:', error);
      await this.interactionManager.safeReply(interaction, {
        content: `❌ Failed to remove ${targetUser.username} from staff. Please try again.`,
        ephemeral: true,
      });
    }
  }



  /**
   * Sets up the support center channel with the professional embed and automated ticket creation.
   */
  private async handleSetupSupport(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const {guild} = interaction;

    if (!guild) {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.GUILD_ONLY,
        ephemeral: true,
      });
      return;
    }

    const memberPermissions = interaction.memberPermissions;
    if (!memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.MISSING_PERMISSIONS,
        ephemeral: true,
      });
      return;
    }

    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const ticketCategory = interaction.options.getString('ticket-category');
    
    if (!targetChannel || !this.isTextCapableChannel(targetChannel)) {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.INVALID_CHANNEL,
        ephemeral: true,
      });
      return;
    }

    let categoryChannel: CategoryChannel | undefined;
    if (ticketCategory) {
      categoryChannel = guild.channels.cache.find(
        channel => channel.name === ticketCategory && channel.type === ChannelType.GuildCategory
      ) as CategoryChannel;
      
      if (!categoryChannel) {
        await this.interactionManager.safeReply(interaction, {
          content: `❌ Category "${ticketCategory}" not found. Please create the category first or use an existing one.\n\n**Available categories:**\n${guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).map(c => `• ${c.name}`).join('\n') || 'No categories found'}`,
          ephemeral: true,
        });
        return;
      }
    }

    const textChannel = targetChannel as TextChannel;

    try {
      const config = {
        autoTicketCreation: true,
        deleteUserMessages: true,
        ticketCategory: categoryChannel?.id || ticketCategory || DEFAULT_CATEGORIES.TICKETS,
        archiveCategory: DEFAULT_CATEGORIES.ARCHIVED,
        welcomeMessage: SUPPORT_MESSAGES.WELCOME_MESSAGE,
        strictFiltering: false,
        staffEmbedMessageId: undefined as string | undefined
      };

      const configurationSuccess = await this.supportChannelManager.configureSupportChannel(
        textChannel,
        config,
        false
      );

      if (!configurationSuccess) {
        await this.interactionManager.safeReply(interaction, {
          content: `❌ Failed to configure support channel automation for ${textChannel}.`,
          ephemeral: true,
        });
        return;
      }

      await this.ticketManager.setSupportChannel(guild.id, textChannel.id);

      const embed = new EmbedBuilder()
        .setTitle(SUPPORT_MESSAGES.TITLE)
        .setDescription(SUPPORT_MESSAGES.DESCRIPTION)
        .setColor(EMBED_COLORS.SUPPORT)
        .addFields(
          {
            name: '📝 Creating a Support Ticket',
            value: '1. Describe your issue in detail as a single message\n2. A private support channel will be created instantly\n3. Our team will assist you promptly',
            inline: false,
          },
          {
            name: '📋 Important Guidelines',
            value: '▪ One active ticket per user at a time\n▪ Provide clear and detailed descriptions\n▪ Be patient while our team responds\n▪ Use the "Close Ticket" button when resolved',
            inline: false,
          },
          {
            name: '⚡ What happens next?',
            value: 'Your message will be automatically processed and a dedicated support channel will be created where our team can assist you privately.',
            inline: false,
          },
          {
            name: '🔒 Privacy & Security',
            value: 'All tickets are private and only visible to you and our support team.',
            inline: true,
          },
          {
            name: '⏱️ Response Time',
            value: 'We typically respond within 24 hours during business days.',
            inline: true,
          },
          {
            name: '🎯 Priority Support',
            value: 'Premium members receive priority assistance.',
            inline: true,
          }
        );

      const staffList = this.ticketManager.getStaffList(guild.id) ?? [];
      const presenceConfig = this.ticketManager.getPresenceConfig(guild.id) ?? { enabled: false };
      
      let staffStatusText = '';
      let onlineCount = 0;
      
      if (staffList.length === 0) {
        staffStatusText = 'No staff members configured yet';
      } else if (!presenceConfig.enabled) {
        staffStatusText = staffList.map(id => `• <@${id}> - Status unknown`).join('\n');
        staffStatusText += '\n\n*Enable presence tracking with `/presence-tracking` for real-time status*';
      } else {
        for (const staffId of staffList) {
          const presence = this.ticketManager.getStaffPresence(guild.id, staffId);
          const status = this.normalizePresenceStatus(presence?.status);
          
          if (status === 'online' || status === 'idle') {
            onlineCount++;
          }
          
          const emoji = STATUS_EMOJIS[status];
          staffStatusText += `${emoji} <@${staffId}> - ${status.charAt(0).toUpperCase() + status.slice(1)}\n`;
        }
      }

      embed.addFields({
        name: '👨‍💼 Staff Availability',
        value: staffStatusText || 'No staff members configured',
        inline: false,
      });

      embed.setFooter({
        text: SUPPORT_MESSAGES.FOOTER_TEXT,
      });
      
      embed.setTimestamp();

      const headerText = presenceConfig.enabled 
        ? SUPPORT_MESSAGES.HEADER_TEXT.WITH_PRESENCE(onlineCount, staffList.length)
        : SUPPORT_MESSAGES.HEADER_TEXT.WITHOUT_PRESENCE(staffList.length);

      const categoryText = ticketCategory ? ` Tickets will be created in the "${ticketCategory}" category.` : '';
      
      const replySuccess = await this.interactionManager.safeReply(interaction, {
        content: SUCCESS_MESSAGES.SUPPORT_SETUP(textChannel.toString(), categoryText),
        ephemeral: true,
      });

      if (!replySuccess) {
        console.error('Failed to send setup-support confirmation reply');
        return;
      }

      const message = await textChannel.send({
        embeds: [embed],
        content: headerText,
      });

      // Store the message ID for future updates
      config.staffEmbedMessageId = message.id;
      await this.supportChannelManager.configureSupportChannel(textChannel, config, false);
    } catch (error) {
      console.error('Failed to setup support channel:', error);
      await this.interactionManager.safeReply(interaction, {
        content: `❌ Failed to setup support channel. Please try again.`,
        ephemeral: true,
      });
    }
  }

  /**
   * Handles the presence tracking command.
   */
  private async handlePresenceTracking(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const { guild } = interaction;

    if (!guild) {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.GUILD_ONLY,
        ephemeral: true,
      });
      return;
    }

    const memberPermissions = interaction.memberPermissions;
    if (!memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.MISSING_PERMISSIONS,
        ephemeral: true,
      });
      return;
    }

    const enabled = interaction.options.getBoolean('enabled', true);

    try {
      await this.ticketManager.setPresenceTracking(guild.id, enabled);

      const embed = new EmbedBuilder()
        .setTitle(`🔄 Presence Tracking ${enabled ? 'Enabled' : 'Disabled'}`)
        .setDescription(
          enabled 
            ? SUCCESS_MESSAGES.PRESENCE_ENABLED
            : SUCCESS_MESSAGES.PRESENCE_DISABLED
        )
        .setColor(enabled ? EMBED_COLORS.PRIMARY : EMBED_COLORS.WARNING)
        .setTimestamp();

      await this.interactionManager.safeReply(interaction, {
        embeds: [embed],
        ephemeral: true,
      });

      console.log(`Presence tracking ${enabled ? 'enabled' : 'disabled'} for guild ${guild.id} - embeds should be updated`);
      
    } catch (error) {
      console.error('Failed to update presence tracking:', error);
      await this.interactionManager.safeReply(interaction, {
        content: '❌ Failed to update presence tracking setting. Please try again.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handles the staff status command.
   */
  private async handleStaffStatus(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const { guild } = interaction;

    if (!guild) {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.GUILD_ONLY,
        ephemeral: true,
      });
      return;
    }

    const staffList = this.ticketManager.getStaffList(guild.id) ?? [];
    if (staffList.length === 0) {
      await this.interactionManager.safeReply(interaction, {
        content: ERROR_MESSAGES.NO_STAFF_CONFIGURED,
        ephemeral: true,
      });
      return;
    }

    const presenceConfig = this.ticketManager.getPresenceConfig(guild.id) ?? { enabled: false };

    let statusText = '';
    
    if (!presenceConfig.enabled) {
      statusText = '⚠️ **Presence tracking is disabled**\n\n';
      statusText += staffList.map(id => `• <@${id}> - Status unknown`).join('\n');
    } else {
      const statusCounts: Record<ValidPresenceStatus, number> = { online: 0, idle: 0, dnd: 0, offline: 0 };
      
      statusText += '**Staff Availability:**\n\n';
      
      for (const staffId of staffList) {
        const presence = this.ticketManager.getStaffPresence(guild.id, staffId);
        const status = this.normalizePresenceStatus(presence?.status);
        statusCounts[status]++;
        
        const emoji = STATUS_EMOJIS[status];
        const lastSeen = presence?.lastSeen ? `(Last seen: <t:${Math.floor(presence.lastSeen.getTime() / 1000)}:R>)` : '';
        
        statusText += `${emoji} <@${staffId}> - ${status.charAt(0).toUpperCase() + status.slice(1)} ${status === 'offline' ? lastSeen : ''}\n`;
      }
      
      statusText += `\n**Summary:**\n`;
      statusText += `🟢 Online: ${statusCounts.online}\n`;
      statusText += `🟡 Idle: ${statusCounts.idle}\n`;
      statusText += `🔴 DND: ${statusCounts.dnd}\n`;
      statusText += `⚫ Offline: ${statusCounts.offline}`;
    }

    const embed = new EmbedBuilder()
      .setTitle('📊 Staff Status Overview')
      .setDescription(statusText)
      .setColor(EMBED_COLORS.INFO)
      .setTimestamp()
      .setFooter({
        text: presenceConfig.enabled 
          ? 'Real-time presence tracking enabled' 
          : 'Enable presence tracking with /presence-tracking'
      });

    await this.interactionManager.safeReply(interaction, {
      embeds: [embed],
      ephemeral: true,
    });
  }

  /**
   * Returns the slash command definitions.
   */
  getCommands(): ApplicationCommandDataResolvable[] {
    return [
      new SlashCommandBuilder()
        .setName('ticket-stats')
        .setDescription('View ticket statistics')
        .toJSON(),

      new SlashCommandBuilder()
        .setName('addstaff')
        .setDescription('Add a staff member to the ticket system')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('The user to add as staff')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .toJSON(),

      new SlashCommandBuilder()
        .setName('removestaff')
        .setDescription('Remove a staff member from the ticket system')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('The user to remove from staff')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .toJSON(),

      new SlashCommandBuilder()
        .setName('setup-support')
        .setDescription('Set up the professional support center embed with automated ticket creation')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('The channel to configure for automated support (defaults to current channel)')
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('ticket-category')
            .setDescription('The category name where new tickets will be created')
            .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .toJSON(),

      new SlashCommandBuilder()
        .setName('presence-tracking')
        .setDescription('Enable or disable staff presence tracking')
        .addBooleanOption(option =>
          option
            .setName('enabled')
            .setDescription('Whether to enable presence tracking')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .toJSON(),

      new SlashCommandBuilder()
        .setName('staff-status')
        .setDescription('View current staff availability status')
        .toJSON(),
    ];
  }
}