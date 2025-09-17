import {
  TextChannel,
  Message,
  Guild,
  CategoryChannel,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';

const DATA_FILE_PATH = path.join(process.cwd(), 'data', 'supportChannels.json');

/**
 * Interface for support channel configuration
 */
export interface SupportChannelConfig {
  channelId: string;
  autoTicketCreation: boolean;
  deleteUserMessages: boolean;
  strictFiltering: boolean;
  welcomeMessage?: string;
  ticketCategory?: string;
  archiveCategory?: string;
  staffEmbedMessageId?: string;
}

/**
 * Interface for message processing result
 */
export interface MessageProcessResult {
  success: boolean;
  shouldCreateTicket: boolean;
  ticketCreated?: boolean;
  error?: string;
}

/**
 * Manages support channel automation and message processing
 */
export class SupportChannelManager {
  private supportChannels: Map<string, SupportChannelConfig> = new Map();
  private channelRefs: Map<string, TextChannel> = new Map();

  constructor() {
    this.loadSupportChannelData();
  }

  /**
   * Loads support channel configuration from file
   */
  private loadSupportChannelData(): void {
    try {
      console.log(`Attempting to load support channel data from: ${DATA_FILE_PATH}`);
      if (fs.existsSync(DATA_FILE_PATH)) {
        const data = fs.readFileSync(DATA_FILE_PATH, 'utf8');
        console.log(`Support channel file content: ${data.substring(0, 200)}...`);
        const parsed = JSON.parse(data);
        
        if (parsed && typeof parsed === 'object') {
          for (const [channelId, config] of Object.entries(parsed)) {
            if (config && typeof config === 'object') {
              this.supportChannels.set(channelId, config as SupportChannelConfig);
              console.log(`Loaded support channel config for channel: ${channelId}`);
            }
          }
          console.log(`Successfully loaded ${this.supportChannels.size} support channel configurations`);
        }
      } else {
        console.log('Support channel data file does not exist, starting with empty configuration');
      }
    } catch (error) {
      console.error('Failed to load support channel data:', error);
    }
  }

  /**
   * Saves support channel configuration to file
   */
  private saveSupportChannelData(): void {
    try {
      const dataDir = path.dirname(DATA_FILE_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const data = Object.fromEntries(this.supportChannels);
      fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(data, null, 2));
      console.log('Support channel data saved successfully');
    } catch (error) {
      console.error('Failed to save support channel data:', error);
    }
  }

  /**
   * Configures a channel for automated support ticket creation
   */
  async configureSupportChannel(
    channel: TextChannel, 
    config: Partial<SupportChannelConfig>,
    sendConfigMessage: boolean = false
  ): Promise<boolean> {
    try {
      const fullConfig: SupportChannelConfig = {
        channelId: channel.id,
        autoTicketCreation: true,
        deleteUserMessages: true,
        strictFiltering: false,
        ...config
      };

      this.supportChannels.set(channel.id, fullConfig);
      this.saveSupportChannelData();
      
      console.log(`Support channel configuration ${this.supportChannels.has(channel.id) ? 'updated' : 'created'} for channel ${channel.id}`);
      
      try {
        this.channelRefs.set(channel.id, channel);
      } catch (err) {
        console.warn('SupportChannelManager: Failed to store channel reference', err);
      }

      if (sendConfigMessage) {
        await this.sendConfigurationMessage(channel, fullConfig);
      }

      return true;
    } catch (error) {
      console.error('Failed to configure support channel:', error);
      return false;
    }
  }

  /**
   * Processes a message in a support channel for potential ticket creation
   */
  async processMessage(message: Message): Promise<MessageProcessResult> {
    console.log('SupportChannelManager: Processing message', {
      channelId: message.channel.id,
      userId: message.author.id,
      isBot: message.author.bot,
      isSystem: message.system,
      contentLength: message.content.length
    });

    
    if (message.author.bot || message.system) {
      console.log('SupportChannelManager: Skipping bot or system message');
      return {
        success: true,
        shouldCreateTicket: false
      };
    }

    const config = this.supportChannels.get(message.channel.id);
    console.log('SupportChannelManager: Channel config', {
      channelId: message.channel.id,
      hasConfig: !!config,
      autoTicketCreation: config?.autoTicketCreation
    });

    if (!config || !config.autoTicketCreation) {
      console.log('SupportChannelManager: No config or auto ticket creation disabled');
      return {
        success: true,
        shouldCreateTicket: false
      };
    }

    try {
      
      const shouldCreateTicket = await this.shouldCreateTicketFromMessage(message);
      
      console.log('SupportChannelManager: Ticket creation decision', {
        shouldCreateTicket,
        messageContent: message.content.substring(0, 100)
      });

      if (config.deleteUserMessages) {
        try {
          await message.delete();
          console.log('SupportChannelManager: Deleted user message per configuration');
        } catch (error) {
          console.warn('SupportChannelManager: Failed to delete message:', error);
        }
      }

      return {
        success: true,
        shouldCreateTicket: shouldCreateTicket,
        ticketCreated: false
      };
    } catch (error) {
      console.error('SupportChannelManager: Failed to process support channel message:', error);
      return {
        success: false,
        shouldCreateTicket: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Gets the configuration for a support channel
   */
  getSupportChannelConfig(channelId: string): SupportChannelConfig | undefined {
    return this.supportChannels.get(channelId);
  }

  /**
   * Removes support channel configuration
   */
  removeSupportChannel(channelId: string): boolean {
    const removed = this.supportChannels.delete(channelId);
    this.channelRefs.delete(channelId);
    if (removed) {
      this.saveSupportChannelData();
    }
    return removed;
  }

  /**
   * Clears all support channel configurations - used for test isolation
   */
  clearAllConfigurations(): void {
    console.log('SupportChannelManager: Clearing all configurations for test isolation');
    this.supportChannels.clear();
    this.channelRefs.clear();
  }

  /**
   * Lists all configured support channels
   */
  getAllSupportChannels(): Map<string, SupportChannelConfig> {
    return new Map(this.supportChannels);
  }

  /**
   * Checks if a channel is configured as a support channel
   */
  isSupportChannel(channelId: string): boolean {
    return this.supportChannels.has(channelId);
  }

  /**
   * Updates support channel configuration
   */
  updateSupportChannelConfig(
    channelId: string, 
    updates: Partial<SupportChannelConfig>
  ): boolean {
    const existingConfig = this.supportChannels.get(channelId);
    if (!existingConfig) {
      return false;
    }

    const updatedConfig = { ...existingConfig, ...updates };
    this.supportChannels.set(channelId, updatedConfig);
    this.saveSupportChannelData();
    return true;
  }

  /**
   * Manually sends a configuration message to a support channel
   */
  async sendManualConfigurationMessage(
    channel: TextChannel,
    config?: SupportChannelConfig
  ): Promise<boolean> {
    try {
      const channelConfig = config || this.supportChannels.get(channel.id);
      if (!channelConfig) {
        console.error('No configuration found for channel:', channel.id);
        return false;
      }

      await this.sendConfigurationMessage(channel, channelConfig);
      return true;
    } catch (error) {
      console.error('Failed to send configuration message:', error);
      return false;
    }
  }

  /**
   * Sends the initial configuration message to the support channel
   */
  private async sendConfigurationMessage(
    channel: TextChannel,
    config: SupportChannelConfig
  ): Promise<void> {
    const configMessage = [
      '🎫 **Support Channel Configured** 🎫',
      '',
      '✅ This channel is now set up for automatic ticket creation!',
      '',
      '**How it works:**',
      '• Send a message describing your issue',
      '• A private ticket channel will be created automatically',
      '• Your message will be moved to the ticket channel',
      '• Staff will assist you in your private ticket',
      '',
      '**Settings:**',
      `• Auto-create tickets: ${config.autoTicketCreation ? '✅ Enabled' : '❌ Disabled'}`,
      `• Delete user messages: ${config.deleteUserMessages ? '✅ Enabled' : '❌ Disabled'}`,
      `• Ticket category: ${config.ticketCategory || 'Default'}`,
      `• Message filtering: ${config.strictFiltering ? '🔒 Strict' : '🔓 Permissive'}`,
      '',
      '*Ready to help! Just send your message below.*'
    ].join('\n');

    await channel.send(configMessage);
  }

  /**
   * Determines if a message should trigger ticket creation
   */
  private async shouldCreateTicketFromMessage(message: Message): Promise<boolean> {
    console.log('SupportChannelManager: Evaluating message for ticket creation', {
      hasContent: !!message.content?.trim(),
      contentLength: message.content?.trim().length || 0,
      hasAttachments: message.attachments.size > 0,
      attachmentCount: message.attachments.size
    });

    const config = this.supportChannels.get(message.channel.id);
    const useStrictFiltering = config?.strictFiltering ?? false;

    if (!message.content?.trim() && message.attachments.size === 0) {
      console.log('SupportChannelManager: Message has no content or attachments');
      return false;
    }
    
    if (message.content && message.content.trim().length < 1) {
      console.log('SupportChannelManager: Message too short', {
        content: message.content.trim(),
        length: message.content.trim().length
      });
      return false;
    }
    if (useStrictFiltering) {
      if (message.content && message.content.trim().length < 10) {
        console.log('SupportChannelManager: Message too short (strict mode)', {
          content: message.content.trim(),
          length: message.content.trim().length
        });
        return false;
      }
      const spamPhrases = ['test', 'ping'];
      const lowerContent = message.content?.toLowerCase().trim();
      if (lowerContent && spamPhrases.includes(lowerContent)) {
        console.log('SupportChannelManager: Message is spam phrase (strict mode)', {
          content: lowerContent
        });
        return false;
      }
    } else {
      const spamPhrases = ['test', 'ping'];
      const lowerContent = message.content?.toLowerCase().trim();
      if (lowerContent && spamPhrases.includes(lowerContent)) {
        console.log('SupportChannelManager: Message is spam phrase', {
          content: lowerContent
        });
        return false;
      }
    }

    console.log('SupportChannelManager: Message approved for ticket creation', {
      strictMode: useStrictFiltering,
      content: message.content?.substring(0, 50)
    });
    return true;
  }

  /**
   * Gets the category for new tickets
   */
  async getTicketCategory(guild: Guild, config: SupportChannelConfig): Promise<CategoryChannel | undefined> {
    if (!config.ticketCategory) {
      return undefined;
    }

    try {
      const category = guild.channels.cache.find(
        channel => channel.name === config.ticketCategory && channel.type === ChannelType.GuildCategory
      ) as CategoryChannel;

      return category;
    } catch (error) {
      console.error('Failed to get ticket category:', error);
      return undefined;
    }
  }

  /**
   * Gets the archive category for closed tickets
   */
  async getArchiveCategory(guild: Guild, config: SupportChannelConfig): Promise<CategoryChannel | undefined> {
    if (!config.archiveCategory) {
      return undefined;
    }

    try {
      const category = guild.channels.cache.find(
        channel => channel.name === config.archiveCategory && channel.type === ChannelType.GuildCategory
      ) as CategoryChannel;

      return category;
    } catch (error) {
      console.error('Failed to get archive category:', error);
      return undefined;
    }
  }

  /**
   * Updates staff presence information in support channel embeds
   */
  async updateStaffPresenceEmbed(
    guildId: string, 
    staffPresenceMap: Map<string, { status: string; lastSeen: Date }>,
    guild: Guild
  ): Promise<boolean> {
    try {
      const guildSupportChannels = Array.from(this.supportChannels.values())
        .filter(config => {
          const channel = this.channelRefs.get(config.channelId);
          return channel?.guild.id === guildId;
        });

      if (guildSupportChannels.length === 0) {
        return false;
      }

      const statusEmojis = {
        online: '🟢',
        idle: '🟡', 
        dnd: '🔴',
        offline: '⚫'
      };

      let staffStatusText = '';
      let totalStaffFound = 0;

      for (const [userId, presence] of staffPresenceMap) {
        try {
          const member = await guild.members.fetch(userId);
          const displayName = member.displayName || member.user.username;
          const status = presence.status;
          
          const emoji = statusEmojis[status as keyof typeof statusEmojis] || '⚫';
          staffStatusText += `${emoji} ${displayName} - ${status.charAt(0).toUpperCase() + status.slice(1)}\n`;
          totalStaffFound++;
        } catch (error) {
          console.warn(`Could not fetch member ${userId}:`, error);
        }
      }

      if (totalStaffFound === 0) {
        staffStatusText = 'No staff members found or all staff are offline.';
      }

      for (const config of guildSupportChannels) {
        const channel = this.channelRefs.get(config.channelId);
        if (channel) {
          try {
            let targetMessage = null;
            
            if (config.staffEmbedMessageId) {
              try {
                targetMessage = await channel.messages.fetch(config.staffEmbedMessageId);
                console.log(`Found stored support embed message ${config.staffEmbedMessageId} in channel ${config.channelId}`);
              } catch (error) {
                console.warn(`Stored message ID ${config.staffEmbedMessageId} not found, will search for embed`);
                config.staffEmbedMessageId = undefined;
                this.saveSupportChannelData();
              }
            }
            
            if (!targetMessage) {
              const messages = await channel.messages.fetch({ limit: 10 });
              targetMessage = messages.find(msg => 
                msg.author.id === channel.client.user?.id && 
                msg.embeds.length > 0 && 
                msg.embeds[0].fields && 
                msg.embeds[0].fields.some(field => field.name === '�‍💼 Staff Availability')
              );
              
              if (targetMessage) {
                config.staffEmbedMessageId = targetMessage.id;
                this.saveSupportChannelData();
                console.log(`Found and stored support embed message ID ${targetMessage.id} in channel ${config.channelId}`);
              }
            }

            if (targetMessage && targetMessage.embeds[0]) {
              const existingEmbed = targetMessage.embeds[0];
              const updatedEmbed = new EmbedBuilder()
                .setTitle(existingEmbed.title)
                .setDescription(existingEmbed.description)
                .setColor(existingEmbed.color)
                .setTimestamp();

              if (existingEmbed.footer) {
                updatedEmbed.setFooter({
                  text: existingEmbed.footer.text,
                  iconURL: existingEmbed.footer.iconURL || undefined
                });
              }

              for (const field of existingEmbed.fields) {
                if (field.name === '👨‍💼 Staff Availability') {
                  updatedEmbed.addFields({
                    name: '👨‍💼 Staff Availability',
                    value: staffStatusText,
                    inline: field.inline
                  });
                } else {
                  updatedEmbed.addFields({
                    name: field.name,
                    value: field.value,
                    inline: field.inline
                  });
                }
              }

              await targetMessage.edit({ embeds: [updatedEmbed] });
              console.log(`Updated staff availability field in support embed for channel ${config.channelId}`);
            } else {
              console.warn(`Could not find support embed to update in channel ${config.channelId}`);
            }
          } catch (error) {
            console.error(`Failed to update staff presence embed in channel ${config.channelId}:`, error);
          }
        }
      }

      return true;
    } catch (error) {
      console.error('Failed to update staff presence embed:', error);
      return false;
    }
  }
}