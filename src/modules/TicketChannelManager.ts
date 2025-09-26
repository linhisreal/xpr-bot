import {
  Guild,
  TextChannel,
  CategoryChannel,
  ChannelType,
  PermissionFlagsBits,
  OverwriteResolvable,
  User,
  OverwriteType,
} from 'discord.js';
import * as logger from '../utils/logger.js';

/**
 * Interface for ticket channel creation options
 */
export interface TicketChannelOptions {
  guild: Guild;
  creator: User;
  ticketNumber: number;
  originalMessage?: {
    content: string;
    timestamp: Date;
    attachments?: string[];
  };
  category?: CategoryChannel;
}

/**
 * Result of channel creation operation
 */
export interface ChannelCreationResult {
  success: boolean;
  channel?: TextChannel;
  error?: string;
}

/**
 * Centralized permission flags for ticket channels
 */
const TICKET_PERMISSIONS = {
  USER_ALLOW: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks
  ],
  BOT_ALLOW: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks
  ],
  EVERYONE_DENY: [PermissionFlagsBits.ViewChannel],
  LOCK_DENY: [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads
  ],
  UNLOCK_ALLOW: [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory
  ]
} as const;

/**
 * Manages ticket channel creation, permissions, and lifecycle
 */
export class TicketChannelManager {
  /**
   * Creates a new ticket channel with proper permissions and setup
   */
  async createTicketChannel(options: TicketChannelOptions): Promise<ChannelCreationResult> {
    try {
      const channelName = this.generateChannelName(options.creator.username, options.ticketNumber);
      
      
      const channel = await options.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: options.category,
        permissionOverwrites: this.buildPermissionOverwrites(options),
        topic: `Ticket #${options.ticketNumber} - Created by ${options.creator.username}`,
        reason: `Automated ticket creation for ${options.creator.username}`
      }) as TextChannel;

      
      if (options.originalMessage) {
        try {
          await this.setupInitialTicketContent(channel, options);
        } catch (error) {
          logger.stepEvent('ticket-channel', 'initial-content', 'failed', 
            error instanceof Error ? error.message : 'Failed to setup initial content');
        }
      }

      return {
        success: true,
        channel
      };
    } catch (error) {
      logger.stepEvent('ticket-channel', 'create', 'failed', error instanceof Error ? error.message : 'Unknown error occurred');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Archives a ticket channel by moving it to archive category
   */
  async archiveTicketChannel(channel: TextChannel, archiveCategory?: CategoryChannel): Promise<boolean> {
    try {
      if (archiveCategory) {
        await channel.setParent(archiveCategory, {
          reason: 'Ticket closed - moved to archive'
        });
      }

      if (!channel.name.startsWith('archived-')) {
        const archivedName = `archived-${channel.name}`;
        await channel.setName(archivedName);
      }

      const currentOverwrites = Array.from(channel.permissionOverwrites.cache.values());
      const deletionPromises = currentOverwrites
        .filter(overwrite => overwrite.type === OverwriteType.Member)
        .map(overwrite => 
          channel.permissionOverwrites.delete(overwrite.id, 'Ticket archived')
            .catch(err => logger.stepEvent('ticket-archive', 'delete-overwrite', 'failed', `Failed to delete overwrite ${overwrite.id}: ${err.message}`))
        );
      
      await Promise.allSettled(deletionPromises);

      return true;
    } catch (error) {
      logger.stepEvent('ticket-channel', 'archive', 'failed', error instanceof Error ? error.message : 'Unknown error occurred');
      return false;
    }
  }

  /**
   * Locks a ticket channel by restricting user permissions
   */
  async lockTicketChannel(channel: TextChannel, userId: string): Promise<boolean> {
    try {
      await this.applyUserPermissions(channel, userId, TICKET_PERMISSIONS.LOCK_DENY, false, 'Ticket locked by staff');
      return true;
    } catch (error) {
      logger.stepEvent('ticket-channel', 'lock', 'failed', error instanceof Error ? error.message : 'Unknown error occurred');
      return false;
    }
  }

  /**
   * Unlocks a ticket channel by restoring user permissions
   */
  async unlockTicketChannel(channel: TextChannel, userId: string): Promise<boolean> {
    try {
      await this.applyUserPermissions(channel, userId, TICKET_PERMISSIONS.UNLOCK_ALLOW, true, 'Ticket unlocked by staff');
      return true;
    } catch (error) {
      logger.stepEvent('ticket-channel', 'unlock', 'failed', error instanceof Error ? error.message : 'Unknown error occurred');
      return false;
    }
  }

  /**
   * Deletes a ticket channel after confirmation
   */
  async deleteTicketChannel(channel: TextChannel): Promise<boolean> {
    try {
      await channel.delete('Ticket permanently closed');
      return true;
    } catch (error) {
      logger.stepEvent('ticket-channel', 'delete', 'failed', error instanceof Error ? error.message : 'Unknown error occurred');
      return false;
    }
  }

  /**
   * Generates a sanitized channel name for the ticket
   * 
   * Purpose: Creates a Discord-compliant channel name based on the user's username
   * Limitations: 
   * - Channel names must be lowercase and contain only alphanumeric characters and hyphens
   * - Maximum length is limited to 20 characters for the username portion
   * - Consecutive hyphens are collapsed to single hyphens
   * - Leading and trailing hyphens are removed
   * 
   * Usage: Called during ticket channel creation to ensure consistent naming
   * 
   * @param username - The Discord username to sanitize
   * @param _ticketNumber - Currently unused but reserved for future enhancement
   * @returns Sanitized channel name in format 'ticket-{sanitized-username}'
   */
  private generateChannelName(username: string, _ticketNumber: number): string {
    
    const cleanUsername = username
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 20);

    return `ticket-${cleanUsername}`;
  }

  /**
   * Builds permission overwrites for the ticket channel
   */
  private buildPermissionOverwrites(options: TicketChannelOptions): OverwriteResolvable[] {
    return [
      this.createEveryoneOverwrite(options.guild),
      this.createUserOverwrite(options.creator),
      this.createBotOverwrite(options.guild)
    ];
  }

  /**
   * Creates permission overwrite for @everyone role
   */
  private createEveryoneOverwrite(guild: Guild): OverwriteResolvable {
    return {
      id: guild.roles.everyone.id,
      deny: TICKET_PERMISSIONS.EVERYONE_DENY
    };
  }

  /**
   * Creates permission overwrite for the ticket creator
   */
  private createUserOverwrite(user: User): OverwriteResolvable {
    return {
      id: user.id,
      allow: TICKET_PERMISSIONS.USER_ALLOW
    };
  }

  /**
   * Creates permission overwrite for the bot
   */
  private createBotOverwrite(guild: Guild): OverwriteResolvable {
    return {
      id: guild.client.user!.id,
      allow: TICKET_PERMISSIONS.BOT_ALLOW
    };
  }

  /**
   * Helper method to apply permissions to a user in a consistent way
   */
  private async applyUserPermissions(
    channel: TextChannel, 
    userId: string, 
    permissions: readonly bigint[], 
    allow: boolean, 
    reason: string
  ): Promise<void> {
    const permissionObject = permissions.reduce((acc, perm) => {
      acc[perm.toString()] = allow;
      return acc;
    }, {} as Record<string, boolean>);

    await channel.permissionOverwrites.edit(userId, permissionObject, { reason });
  }

  /**
   * Sets up initial content in the ticket channel
   * @deprecated This method is deprecated, only used for fallback scenarios
   */
  private async setupInitialTicketContent(channel: TextChannel, options: TicketChannelOptions): Promise<void> {
    if (!options.originalMessage) return;

    
    const welcomeContent = [
      `🎫 **Ticket Created** 🎫`,
      ``,
      `**User:** ${options.creator.toString()}`,
      `**Ticket ID:** #${options.ticketNumber}`,
      `**Created:** <t:${Math.floor(Date.now() / 1000)}:F>`,
      ``,
      `**Original Message:**`,
      `> ${options.originalMessage.content}`,
      ``,
      `*A staff member will be with you shortly. Please provide any additional details about your issue.*`
    ].join('\n');

    await channel.send(welcomeContent);
  }
}