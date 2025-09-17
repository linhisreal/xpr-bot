import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  ButtonInteraction,
  Message,
  User,
  ThreadChannel,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
} from 'discord.js';
import { TicketManager } from '../bot/ticketManager';
import { InteractionManager } from './InteractionManager';
import { getTicketKeyFromTicket } from './ticketKey';

/**
 * Interface for ticket control options
 */
export interface TicketControlOptions {
  ticketId: string;
  ticketNumber: number;
  creator: User;
  description?: string;
  claimedBy?: User;
  isLocked: boolean;
  escalationLevel: number;
  status: 'open' | 'claimed' | 'locked' | 'escalated' | 'closed';
  hasNotes?: boolean;
}

/**
 * Interface for control button interaction results
 */
export interface ControlInteractionResult {
  success: boolean;
  action: string;
  message?: string;
  error?: string;
}

/**
 * Manages interactive ticket control embeds and button interactions
 */
export class TicketControlsManager {
  private ticketManager?: TicketManager;
  private interactionManager?: InteractionManager;

  constructor(ticketManager?: TicketManager, interactionManager?: InteractionManager) {
    this.ticketManager = ticketManager;
    this.interactionManager = interactionManager;
  }
  /**
   * Creates and sends the ticket control embed to a channel or thread
   */
  async createTicketControls(channel: TextChannel | ThreadChannel, options: TicketControlOptions): Promise<Message | null> {
    try {
      const embed = this.buildControlEmbed(options);
      const actionRow = this.buildControlButtons(options);

      const message = await channel.send({
        embeds: [embed],
        components: [actionRow]
      });

      return message;
    } catch (error) {
      console.error('Failed to create ticket controls:', error);
      return null;
    }
  }

  /**
   * Updates existing ticket control embed and buttons
   */
  async updateTicketControls(message: Message, options: TicketControlOptions): Promise<boolean> {
    try {
      const embed = this.buildControlEmbed(options);
      const actionRow = this.buildControlButtons(options);

      await message.edit({
        embeds: [embed],
        components: [actionRow]
      });

      return true;
    } catch (error) {
      console.error('Failed to update ticket controls:', error);
      return false;
    }
  }

  /**
   * Handles button interaction for ticket controls
   */
  async handleControlInteraction(interaction: ButtonInteraction): Promise<ControlInteractionResult> {
    const action = interaction.customId;

    try {
      switch (action) {
        case 'ticket_lock':
          return await this.handleLockToggle(interaction);
        case 'ticket_claim':
          return await this.handleClaimToggle(interaction);
        case 'ticket_notes':
          return await this.handleNotesModal(interaction);
        case 'ticket_escalate':
          return await this.handleEscalation(interaction);
        case 'ticket_close':
          return await this.handleTicketClose(interaction);
        case 'ticket_whitelist':
          return await this.handleWhitelistModal(interaction);
        default:
          return {
            success: false,
            action,
            error: 'Unknown action'
          };
      }
    } catch (error) {
      console.error(`Failed to handle ${action} interaction:`, error);
      return {
        success: false,
        action,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Builds the ticket control embed
   */
  private buildControlEmbed(options: TicketControlOptions): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`🎫 Support Ticket #${options.ticketNumber}`)
      .setDescription(
        `**Ticket Created By:** ${options.creator.displayName}\n` +
        `**Issue Description:**\n${options.description || '[No description provided]'}\n\n` +
        `Thank you for creating a support ticket. Our team has been notified and will assist you shortly.`
      )
      .setColor(this.getStatusColor(options.status))
      .setTimestamp();

    const levelNames = ['Normal', 'Elevated', 'High', 'Critical'];
    const escalationDisplay = levelNames[options.escalationLevel] || 'Normal';
    const escalationIcon = ['📗', '📙', '📕', '🚨'][options.escalationLevel] || '📗';
    
    let assignmentValue = '**Status:** Unclaimed';
    if (options.claimedBy) {
      assignmentValue = `**Status:** Claimed by ${options.claimedBy.toString()}`;
    }
    
    embed.addFields([
      {
        name: '📋 Ticket Info',
        value: [
          `**ID:** #${options.ticketNumber}`,
          `**Creator:** ${options.creator.toString()}`,
          `**Status:** ${this.getStatusDisplay(options.status)}`,
          `**Priority:** ${escalationIcon} ${escalationDisplay}`
        ].join('\n'),
        inline: true
      },
      {
        name: '👤 Assignment',
        value: assignmentValue,
        inline: true
      },
      {
        name: '🔒 Security & Notes',
        value: [
          options.isLocked 
            ? '**Locked:** Yes - Only staff can read/write'
            : '**Locked:** No - Normal permissions',
          options.hasNotes 
            ? '**Notes:** 📝 Has staff notes'
            : '**Notes:** No notes added'
        ].join('\n'),
        inline: true
      },
      {
        name: '👥 Support Team',
        value: 'Our team will respond within 24 hours during business days.',
        inline: false
      }
    ]);

    
    embed.setFooter({
      text: 'Use the buttons below to manage this ticket. Staff only.'
    });

    return embed;
  }

  /**
   * Builds the control action buttons
   */
  private buildControlButtons(options: TicketControlOptions): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();

    row.addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_lock')
        .setLabel(options.isLocked ? 'Unlock' : 'Lock')
        .setEmoji(options.isLocked ? '🔓' : '🔒')
        .setStyle(options.isLocked ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    row.addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel(options.claimedBy ? 'Unclaim' : 'Claim')
        .setEmoji('👤')
        .setStyle(options.claimedBy ? ButtonStyle.Secondary : ButtonStyle.Primary)
    );

    row.addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_notes')
        .setLabel('Notes')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Secondary)
    );

    row.addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_escalate')
        .setLabel('Escalate')
        .setEmoji('⚠️')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(options.escalationLevel >= 3)
    );

    if (options.isLocked) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_whitelist')
          .setLabel('Whitelist')
          .setEmoji('➕')
          .setStyle(ButtonStyle.Secondary)
      );
    } else {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_close')
          .setLabel('Close')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Danger)
      );
    }

    return row;
  }

  /**
   * Gets the embed color based on ticket status
   */
  private getStatusColor(status: string): number {
    switch (status) {
      case 'open': return 0x0099ff; 
      case 'claimed': return 0x0099ff; 
      case 'locked': return 0xff9900; 
      case 'escalated': return 0xff0000; 
      case 'closed': return 0x666666; 
      default: return 0x0099ff; 
    }
  }

  /**
   * Gets the display text for ticket status
   */
  private getStatusDisplay(status: string): string {
    switch (status) {
      case 'open': return '🟢 Open';
      case 'claimed': return '🔵 Claimed';
      case 'locked': return '🟠 Locked';
      case 'escalated': return '🔴 Escalated';
      case 'closed': return '⚫ Closed';
      default: return '🔵 Active';
    }
  }

  /**
   * Generates thread name with lock status indicator
   */
  private generateThreadNameWithStatus(originalName: string, isLocked: boolean): string {
    
    const cleanName = originalName.replace(/^(🔒|🔓)\s+/, '');
    
    const lockIcon = isLocked ? '🔒' : '';
    
    if (lockIcon) {
      return `${lockIcon} ${cleanName}`;
    }
    return cleanName;
  }

  /**
   * Updates thread name to reflect lock status
   */
  private async updateThreadName(thread: ThreadChannel, isLocked: boolean): Promise<void> {
    try {
      const newName = this.generateThreadNameWithStatus(thread.name, isLocked);
      
      if (newName !== thread.name) {
        await thread.edit({ name: newName });
        console.log(`Updated thread name: "${thread.name}" -> "${newName}"`);
      }
    } catch (error) {
      console.error('Error updating thread name:', error);
      
    }
  }

  /**
   * Handles lock/unlock button interaction
   */
  private async handleLockToggle(interaction: ButtonInteraction): Promise<ControlInteractionResult> {
    try {
      if (!this.ticketManager) {
        await interaction.reply({
          content: '❌ Ticket manager not available.',
          ephemeral: true
        });
        return { success: false, action: 'lock', error: 'Ticket manager not available' };
      }

      const isStaff = await this.verifyStaffPermissions(interaction);
      if (!isStaff) {
        await interaction.reply({
          content: '❌ Only staff members can lock/unlock tickets.',
          ephemeral: true
        });
        return { success: false, action: 'lock', error: 'Not authorized' };
      }

      const ticketData = await this.getTicketFromThread(interaction.channel);
      if (!ticketData) {
        await interaction.reply({
          content: '❌ Could not find ticket data.',
          ephemeral: true
        });
        return { success: false, action: 'lock', error: 'Ticket not found' };
      }

      await interaction.deferReply({ ephemeral: true });

      const thread = interaction.channel as ThreadChannel;
      
      if (ticketData.isLocked) {
        try {
          await thread.members.add(ticketData.userId);
          
          const lockResult = await this.updateTicketLock(thread.guild.id, ticketData, false, interaction.user.id);
          if (!lockResult) {
            const errorMessage = '❌ Failed to unlock ticket.';
            if (this.interactionManager) {
              await this.interactionManager.safeEditReply(interaction, {
                content: errorMessage
              });
            } else {
              await interaction.editReply({ content: errorMessage });
            }
            return { success: false, action: 'unlock', error: 'Failed to unlock ticket' };
          }
          
          await this.updateThreadName(thread, false);
          
          await new Promise(resolve => setTimeout(resolve, 100));
          
          const freshTicketData = await this.getTicketFromThread(interaction.channel);
          if (freshTicketData) {
            await this.refreshControlEmbed(interaction, thread, freshTicketData);
          } else {
            console.warn('Could not fetch fresh ticket data after unlocking');
          }
          
          await interaction.editReply({
            content: '🔓 Ticket unlocked. User can now respond and has full access.'
          });
          return { success: true, action: 'unlock' };
        } catch (error) {
          console.error('Error during unlock operation:', error);
          await interaction.editReply({
            content: '❌ Failed to unlock ticket properly. Some permissions may not have been updated.'
          });
          return { success: false, action: 'unlock', error: 'Unlock operation failed' };
        }
      } else {
        try {
          const threadMembers = await thread.members.fetch();
          
          const allowedUsers = new Set<string>();
          allowedUsers.add(ticketData.userId);
          if (ticketData.claimedBy) {
            allowedUsers.add(ticketData.claimedBy);
          }
          
          for (const [memberId] of threadMembers) {
            if (memberId === thread.client.user?.id) {
              continue;
            }
            
            if (!allowedUsers.has(memberId)) {
              try {
                await thread.members.remove(memberId);
                console.log(`Removed member ${memberId} from locked ticket thread`);
              } catch (error) {
                console.debug(`Could not remove member ${memberId} from thread:`, error);
              }
            }
          }
          
          await thread.members.add(ticketData.userId);
          if (ticketData.claimedBy) {
            await thread.members.add(ticketData.claimedBy);
          }
          
          const lockResult = await this.updateTicketLock(thread.guild.id, ticketData, true, interaction.user.id);
          if (!lockResult) {
            const errorMessage = '❌ Failed to lock ticket.';
            if (this.interactionManager) {
              await this.interactionManager.safeEditReply(interaction, {
                content: errorMessage
              });
            } else {
              await interaction.editReply({ content: errorMessage });
            }
            return { success: false, action: 'lock', error: 'Failed to lock ticket' };
          }
          
          await this.updateThreadName(thread, true);
          
          await new Promise(resolve => setTimeout(resolve, 100));
          
          const freshTicketData = await this.getTicketFromThread(interaction.channel);
          if (freshTicketData) {
            await this.refreshControlEmbed(interaction, thread, freshTicketData);
          } else {
            console.warn('Could not fetch fresh ticket data after locking');
          }
          
          await interaction.editReply({
            content: '🔒 Ticket locked. Only the ticket creator and staff claimer can access this thread. Use the whitelist button to grant access to additional users.'
          });
          
          return { success: true, action: 'lock' };
        } catch (error) {
          console.error('Error during lock operation:', error);
          const errorMessage = '❌ Failed to lock ticket properly. Some permissions may not have been updated.';
          if (this.interactionManager) {
            await this.interactionManager.safeEditReply(interaction, {
              content: errorMessage
            });
          } else {
            await interaction.editReply({ content: errorMessage });
          }
          return { success: false, action: 'lock', error: 'Lock operation failed' };
        }
      }
    } catch (error) {
      console.error('Error handling lock toggle:', error);
      if (this.interactionManager) {
        await this.interactionManager.safeReply(interaction, {
          content: '❌ An error occurred while processing your request.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ An error occurred while processing your request.',
          ephemeral: true
        });
      }
      return { success: false, action: 'lock', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handles claim/unclaim button interaction
   */
  private async handleClaimToggle(interaction: ButtonInteraction): Promise<ControlInteractionResult> {
    try {
      if (!this.ticketManager) {
        await interaction.reply({
          content: '❌ Ticket manager not available.',
          ephemeral: true
        });
        return { success: false, action: 'claim', error: 'Ticket manager not available' };
      }

      const isStaff = await this.verifyStaffPermissions(interaction);
      if (!isStaff) {
        await interaction.reply({
          content: '❌ Only staff members can claim tickets.',
          ephemeral: true
        });
        return { success: false, action: 'claim', error: 'Not authorized' };
      }

      const ticketData = await this.getTicketFromThread(interaction.channel);
      if (!ticketData) {
        await interaction.reply({
          content: '❌ Could not find ticket data.',
          ephemeral: true
        });
        return { success: false, action: 'claim', error: 'Ticket not found' };
      }

      await interaction.deferReply({ ephemeral: true });

      
      if (ticketData.claimedBy) {
        if (ticketData.claimedBy === interaction.user.id) {
          
          await this.updateTicketClaim(ticketData, null);
          
          await new Promise(resolve => setTimeout(resolve, 100));
          
          const freshTicketData = await this.getTicketFromThread(interaction.channel);
          if (freshTicketData) {
            await this.refreshControlEmbed(interaction, interaction.channel as ThreadChannel, freshTicketData);
          } else {
            console.warn('Could not fetch fresh ticket data after unclaiming');
          }
          
          await interaction.editReply({
            content: '✅ You have unclaimed this ticket.'
          });
          return { success: true, action: 'unclaim' };
        } else {
          await interaction.editReply({
            content: `❌ This ticket is already claimed by <@${ticketData.claimedBy}>.`
          });
          return { success: false, action: 'claim', error: 'Already claimed' };
        }
      } else {
        
        await this.updateTicketClaim(ticketData, interaction.user.id);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const freshTicketData = await this.getTicketFromThread(interaction.channel);
        if (freshTicketData) {
          await this.refreshControlEmbed(interaction, interaction.channel as ThreadChannel, freshTicketData);
        } else {
          console.warn('Could not fetch fresh ticket data after claiming');
        }
        
        await interaction.editReply({
          content: '✅ You have claimed this ticket.'
        });
        return { success: true, action: 'claim' };
      }
    } catch (error) {
      console.error('Error handling claim toggle:', error);
      const errorMessage = '❌ An error occurred while processing your request.';
      if (this.interactionManager) {
        await this.interactionManager.safeEditReply(interaction, {
          content: errorMessage
        });
      } else {
        await interaction.editReply({ content: errorMessage });
      }
      return { success: false, action: 'claim', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handles notes modal interaction
   */
  private async handleNotesModal(interaction: ButtonInteraction): Promise<ControlInteractionResult> {
    try {
      if (!this.ticketManager) {
        return { success: false, action: 'notes', error: 'Ticket manager not available' };
      }

      const isStaff = await this.verifyStaffPermissions(interaction);
      if (!isStaff) {
        if (this.interactionManager) {
          await this.interactionManager.safeReply(interaction, {
            content: '❌ Only staff members can manage ticket notes.',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ Only staff members can manage ticket notes.',
            ephemeral: true
          });
        }
        return { success: false, action: 'notes', error: 'Not authorized' };
      }

      const ticketData = await this.getTicketFromThread(interaction.channel);
      if (!ticketData) {
        if (this.interactionManager) {
          await this.interactionManager.safeReply(interaction, {
            content: '❌ Could not find ticket data.',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ Could not find ticket data.',
            ephemeral: true
          });
        }
        return { success: false, action: 'notes', error: 'Ticket not found' };
      }

  const ticketKey = getTicketKeyFromTicket(ticketData);
      const modal = new ModalBuilder()
        .setCustomId(`ticket_notes_${ticketKey}`)
        .setTitle('Ticket Notes');

      const notesInput = new TextInputBuilder()
        .setCustomId('notes_content')
        .setLabel('Add or edit ticket notes')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Enter internal notes about this ticket...')
        .setRequired(false)
        .setMaxLength(1000);

      
      if (ticketData.notes) {
        notesInput.setValue(ticketData.notes);
      }

      const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput);
      modal.addComponents(firstActionRow);

      await interaction.showModal(modal);

      return {
        success: true,
        action: 'notes',
        message: 'Notes modal opened'
      };
    } catch (error) {
      console.error('Error handling notes modal:', error);
      if (this.interactionManager) {
        await this.interactionManager.safeReply(interaction, {
          content: '❌ An error occurred while opening the notes modal.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ An error occurred while opening the notes modal.',
          ephemeral: true
        });
      }
      return { success: false, action: 'notes', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handles whitelist modal interaction
   */
  private async handleWhitelistModal(interaction: ButtonInteraction): Promise<ControlInteractionResult> {
    try {
      if (!this.ticketManager) {
        return { success: false, action: 'whitelist', error: 'Ticket manager not available' };
      }

      const isStaff = await this.verifyStaffPermissions(interaction);
      if (!isStaff) {
        if (this.interactionManager) {
          await this.interactionManager.safeReply(interaction, {
            content: '❌ Only staff members can whitelist users.',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ Only staff members can whitelist users.',
            ephemeral: true
          });
        }
        return { success: false, action: 'whitelist', error: 'Not authorized' };
      }

      const ticketData = await this.getTicketFromThread(interaction.channel);
      if (!ticketData) {
        if (this.interactionManager) {
          await this.interactionManager.safeReply(interaction, {
            content: '❌ Could not find ticket data.',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ Could not find ticket data.',
            ephemeral: true
          });
        }
        return { success: false, action: 'whitelist', error: 'Ticket not found' };
      }

      if (!ticketData.isLocked) {
        if (this.interactionManager) {
          await this.interactionManager.safeReply(interaction, {
            content: '❌ This ticket is not locked. Lock the ticket first to use the whitelist feature.',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ This ticket is not locked. Lock the ticket first to use the whitelist feature.',
            ephemeral: true
          });
        }
        return { success: false, action: 'whitelist', error: 'Ticket not locked' };
      }

  const ticketKey = getTicketKeyFromTicket(ticketData);
      const modal = new ModalBuilder()
        .setCustomId(`ticket_whitelist_${ticketKey}`)
        .setTitle('Whitelist User for Locked Ticket');

      const userInput = new TextInputBuilder()
        .setCustomId('whitelist_user')
        .setLabel('User ID or Mention')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter user ID (e.g., 123456789012345678) or @username')
        .setRequired(true)
        .setMaxLength(100);

      const reasonInput = new TextInputBuilder()
        .setCustomId('whitelist_reason')
        .setLabel('Reason (Optional)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Why should this user have access?')
        .setRequired(false)
        .setMaxLength(200);

      const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(userInput);
      const secondActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
      
      modal.addComponents(firstActionRow, secondActionRow);

      await interaction.showModal(modal);

      return {
        success: true,
        action: 'whitelist',
        message: 'Whitelist modal opened'
      };
    } catch (error) {
      console.error('Error handling whitelist modal:', error);
      if (this.interactionManager) {
        await this.interactionManager.safeReply(interaction, {
          content: '❌ An error occurred while opening the whitelist modal.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ An error occurred while opening the whitelist modal.',
          ephemeral: true
        });
      }
      return { success: false, action: 'whitelist', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async handleEscalation(interaction: ButtonInteraction): Promise<ControlInteractionResult> {
    try {
      const deferSuccess = this.interactionManager 
        ? await this.interactionManager.safeDefer(interaction, { ephemeral: true })
        : await this.safeDeferFallback(interaction);
      
      if (!deferSuccess) {
        return { success: false, action: 'escalate', error: 'Failed to defer interaction' };
      }

      if (!this.ticketManager) {
        return { success: false, action: 'escalate', error: 'Ticket manager not available' };
      }

      const isStaff = await this.verifyStaffPermissions(interaction);
      if (!isStaff) {
        const errorMessage = '❌ Only staff members can escalate tickets.';
        if (this.interactionManager) {
          await this.interactionManager.safeEditReply(interaction, {
            content: errorMessage
          });
        } else {
          await interaction.editReply({ content: errorMessage });
        }
        return { success: false, action: 'escalate', error: 'Not authorized' };
      }

      const ticketData = await this.getTicketFromThread(interaction.channel);
      if (!ticketData) {
        const errorMessage = '❌ Could not find ticket data.';
        if (this.interactionManager) {
          await this.interactionManager.safeEditReply(interaction, {
            content: errorMessage
          });
        } else {
          await interaction.editReply({ content: errorMessage });
        }
        return { success: false, action: 'escalate', error: 'Ticket not found' };
      }

  const ticketKey = getTicketKeyFromTicket(ticketData);
      console.log(`Escalating ticket ${ticketKey} (isThread: ${ticketData.isThread}) by staff ${interaction.user.id}`);
      
      const result = this.ticketManager?.escalateTicket(
        interaction.guildId!,
        ticketKey,
        interaction.user.id
      );

      if (result?.success) {
        const levelNames = ['Normal', 'Elevated', 'High', 'Critical'];
        const levelName = levelNames[result.newLevel || 0];
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const updatedTicketData = await this.getTicketFromThread(interaction.channel);
        if (updatedTicketData) {
          await this.refreshControlEmbed(interaction, interaction.channel as ThreadChannel, updatedTicketData);
        } else {
          await this.refreshControlEmbed(interaction, interaction.channel as ThreadChannel, {
            ...ticketData,
            escalationLevel: result.newLevel || 0
          });
        }
        
        const successMessage = `⚠️ Ticket has been escalated to **${levelName}** priority level.`;
        if (this.interactionManager) {
          await this.interactionManager.safeEditReply(interaction, {
            content: successMessage
          });
        } else {
          await interaction.editReply({ content: successMessage });
        }
        return { success: true, action: 'escalate', message: `Escalated to ${levelName}` };
      } else {
        const errorMessage = '❌ Cannot escalate ticket further or escalation failed.';
        if (this.interactionManager) {
          await this.interactionManager.safeEditReply(interaction, {
            content: errorMessage
          });
        } else {
          await interaction.editReply({ content: errorMessage });
        }
        return { success: false, action: 'escalate', error: 'Escalation failed' };
      }
    } catch (error) {
      console.error('Error handling escalation:', error);
      const errorMessage = '❌ An error occurred while escalating the ticket.';
      if (this.interactionManager) {
        await this.interactionManager.safeEditReply(interaction, {
          content: errorMessage
        });
      } else {
        await interaction.editReply({ content: errorMessage });
      }
      return { success: false, action: 'escalate', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handles ticket close button interaction
   */
  private async handleTicketClose(interaction: ButtonInteraction): Promise<ControlInteractionResult> {
    try {
      if (!this.ticketManager) {
        return { success: false, action: 'close', error: 'Ticket manager not available' };
      }

      const isStaff = await this.verifyStaffPermissions(interaction);
      if (!isStaff) {
        if (this.interactionManager) {
          await this.interactionManager.safeReply(interaction, {
            content: '❌ Only staff members can close tickets.',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ Only staff members can close tickets.',
            ephemeral: true
          });
        }
        return { success: false, action: 'close', error: 'Not authorized' };
      }

      const ticketData = await this.getTicketFromThread(interaction.channel);
      if (!ticketData) {
        if (this.interactionManager) {
          await this.interactionManager.safeReply(interaction, {
            content: '❌ Could not find ticket data.',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ Could not find ticket data.',
            ephemeral: true
          });
        }
        return { success: false, action: 'close', error: 'Ticket not found' };
      }

  const ticketId = getTicketKeyFromTicket(ticketData);
      const success = this.ticketManager?.closeTicketWithAuth(
        interaction.guildId!,
        ticketId,
        interaction.user.id
      );

      if (success) {
        const thread = interaction.channel as ThreadChannel;
        if (this.interactionManager) {
          await this.interactionManager.safeReply(interaction, {
            content: '❌ This ticket is being closed. The thread will be archived.',
            ephemeral: false 
          });
        } else {
          await interaction.reply({
            content: '❌ This ticket is being closed. The thread will be archived.',
            ephemeral: false 
          });
        }

        setTimeout(async () => {
          try {
            await thread.setArchived(true, 'Ticket closed by staff');
          } catch (error) {
            console.error('Error archiving thread:', error);
          }
        }, 2000).unref();

        return { success: true, action: 'close', message: 'Ticket closed and archived' };
      } else {
        if (this.interactionManager) {
          await this.interactionManager.safeReply(interaction, {
            content: '❌ Failed to close the ticket.',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ Failed to close the ticket.',
            ephemeral: true
          });
        }
        return { success: false, action: 'close', error: 'Close failed' };
      }
    } catch (error) {
      console.error('Error handling ticket close:', error);
      if (this.interactionManager) {
        await this.interactionManager.safeReply(interaction, {
          content: '❌ An error occurred while closing the ticket.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ An error occurred while closing the ticket.',
          ephemeral: true
        });
      }
      return { success: false, action: 'close', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Fallback defer method when InteractionManager is not available
   */
  private async safeDeferFallback(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<boolean> {
    try {
      if (interaction.deferred || interaction.replied) {
        return false;
      }
      await interaction.deferReply({ ephemeral: true });
      return true;
    } catch (error: any) {
      if (error.code === 10062) {
        console.warn(`[${interaction.user.tag}] Interaction expired (10062) - operation will continue in background`);
        return false;
      }
      if (error.code === 40060) {
        console.warn(`[${interaction.user.tag}] Interaction already acknowledged (40060) - skipping defer`);
        return false;
      }
      console.error('Failed to defer interaction:', error);
      return false;
    }
  }

  /**
   * Checks if a ticket has any staff notes
   */
  private checkTicketHasNotes(ticketData: any): boolean {
    return ticketData && ticketData.notes && ticketData.notes.trim().length > 0;
  }

  /**
   * Refreshes the control embed to reflect current ticket state
   */
  private async refreshControlEmbed(interaction: ButtonInteraction | ModalSubmitInteraction, thread: ThreadChannel, ticketData: any): Promise<void> {
    try {
      console.log(`[${interaction.user.tag}] Refreshing ticket embed for ticket ${ticketData.channelId}`);
      
      let ticketMessage = null;
      
      try {
        const starterMessage = await thread.fetchStarterMessage();
        if (starterMessage && starterMessage.embeds.length > 0) {
          const embed = starterMessage.embeds[0];
          if (embed.title?.includes('Support Ticket #')) {
            ticketMessage = starterMessage;
            console.log('Found starter message as ticket message');
          }
        }
      } catch (starterError) {
        console.warn('Could not fetch starter message, searching manually:', starterError);
      }
      
      if (!ticketMessage) {
        const messages = await thread.messages.fetch({ limit: 50 });
        
        ticketMessage = messages
          .filter(msg => msg.author.bot && msg.embeds.length > 0)
          .find(msg => {
            const embed = msg.embeds[0];
            return embed.title?.includes('Support Ticket #') || 
                   embed.title?.includes(`#${ticketData.ticketNumber}`);
          });
      }
      
      if (ticketMessage) {
        console.log(`Found ticket message: ${ticketMessage.id}`);
        
        const updatedOptions: TicketControlOptions = {
          ticketId: ticketData.channelId,
          ticketNumber: ticketData.ticketNumber || 1,
          creator: await thread.guild.members.fetch(ticketData.userId).then(m => m.user),
          description: ticketData.description,
          claimedBy: ticketData.claimedBy ? await thread.guild.members.fetch(ticketData.claimedBy).then(m => m.user) : undefined,
          isLocked: ticketData.isLocked,
          escalationLevel: ticketData.escalationLevel || 0,
          status: ticketData.isLocked ? 'locked' : (ticketData.claimedBy ? 'claimed' : 'open'),
          hasNotes: this.checkTicketHasNotes(ticketData)
        };
        
        console.log('Updating ticket message with options:', {
          isLocked: updatedOptions.isLocked,
          claimedBy: updatedOptions.claimedBy?.username,
          escalationLevel: updatedOptions.escalationLevel,
          status: updatedOptions.status
        });
        
        const updateSuccess = await this.updateTicketControls(ticketMessage, updatedOptions);
        if (updateSuccess) {
          console.log('Successfully updated ticket embed');
        } else {
          console.error('Failed to update ticket embed');
        }
      } else {
        console.error(`Ticket message not found for ticket ${ticketData.channelId} in thread ${thread.id}`);
        
        console.error('Original ticket message missing - this should not happen');
      }
    } catch (error) {
      console.error('Error refreshing control embed:', error);
    }
  }

  /**
   * Verifies if user has staff permissions
   */
  private async verifyStaffPermissions(interaction: ButtonInteraction): Promise<boolean> {
    if (!this.ticketManager || !interaction.guild) return false;
    
    const staffList = this.ticketManager.getStaffList(interaction.guild.id);
    return staffList.includes(interaction.user.id);
  }

  /**
   * Gets ticket data from thread channel
   */
  private async getTicketFromThread(channel: any): Promise<any> {
    if (!this.ticketManager || !channel?.isThread()) return null;
    
    const thread = channel as ThreadChannel;
    const guild = thread.guild;
    
    const ticket = this.ticketManager.getTicketByThread(guild.id, thread.id);
    if (ticket) {
      console.log(`Found ticket via thread ID ${thread.id}: ${ticket.channelId}`);
      return ticket;
    }
    
    const ticketByChannel = this.ticketManager.getTicketByChannel(guild.id, thread.id);
    if (ticketByChannel) {
      console.log(`Found ticket via channel ID ${thread.id}: ${ticketByChannel.channelId}`);
      return ticketByChannel;
    }
    
    console.warn(`No ticket found for thread ${thread.id} in guild ${guild.id}`);
    return null;
  }

  /**
   * Updates ticket claim status
   */
  private async updateTicketClaim(ticketData: any, claimedBy: string | null): Promise<boolean> {
    if (!this.ticketManager) return false;
    
      const ticketKey = getTicketKeyFromTicket(ticketData);
    const guildId = ticketData.guildId;
    
    console.log(`Updating claim status for ticket ${ticketKey} (isThread: ${ticketData.isThread}) claimedBy: ${claimedBy}`);
    
    if (claimedBy) {
      return this.ticketManager.claimTicket(guildId, ticketKey, claimedBy);
    } else {
      if (ticketData.claimedBy) {
        return this.ticketManager.unclaimTicket(guildId, ticketKey, ticketData.claimedBy);
      }
    }
    return false;
  }

  /**
   * Updates ticket lock status
   */
  private async updateTicketLock(guildId: string, ticketData: any, isLocked: boolean, staffId: string): Promise<boolean> {
    if (!this.ticketManager) return false;
    
      const ticketKey = getTicketKeyFromTicket(ticketData);
    console.log(`Updating lock status for ticket ${ticketKey} (isThread: ${ticketData.isThread}) to ${isLocked}`);
    
    if (isLocked) {
      return this.ticketManager.lockTicket(guildId, ticketKey, staffId);
    } else {
      return this.ticketManager.unlockTicket(guildId, ticketKey, staffId);
    }
  }

  /**
   * Handles modal submit interaction for notes and whitelist
   */
  async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    try {
      if (interaction.customId.startsWith('ticket_notes_')) {
        await this.handleNotesModalSubmit(interaction);
      } else if (interaction.customId.startsWith('ticket_whitelist_')) {
        await this.handleWhitelistModalSubmit(interaction);
      } else {
        if (this.interactionManager) {
          await this.interactionManager.safeReply(interaction, {
            content: '❌ Unknown modal submission. Please try again.',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ Unknown modal submission. Please try again.',
            ephemeral: true
          });
        }
      }
    } catch (error) {
      console.error('Error handling modal submit:', error);
      if (this.interactionManager) {
        await this.interactionManager.safeReply(interaction, {
          content: '❌ An error occurred while processing your request.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ An error occurred while processing your request.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * Handles notes modal submit
   */
  private async handleNotesModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const ticketKey = interaction.customId.replace('ticket_notes_', '');
    const notesContent = interaction.fields.getTextInputValue('notes_content');

    console.log(`Processing notes update for ticket ${ticketKey} by ${interaction.user.username}`);

    const isStaff = await this.verifyStaffPermissionsModal(interaction);
    if (!isStaff) {
      if (this.interactionManager) {
        await this.interactionManager.safeReply(interaction, {
          content: '❌ Only staff members can manage ticket notes.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ Only staff members can manage ticket notes.',
          ephemeral: true
        });
      }
      return;
    }

    const success = this.ticketManager?.updateTicketNotes(
      interaction.guildId!,
      ticketKey,
      notesContent,
      interaction.user.id
    );

    console.log(`Notes update result for ticket ${ticketKey}: ${success}`);

    if (success) {
      await new Promise(resolve => setTimeout(resolve, 100));
      
      try {
        const freshTicketData = await this.getTicketFromThread(interaction.channel);
        if (freshTicketData) {
          await this.refreshControlEmbed(interaction, interaction.channel as ThreadChannel, freshTicketData);
        } else {
          console.warn('Could not fetch fresh ticket data after notes update');
        }
      } catch (error) {
        console.error('Error refreshing control embed after notes update:', error);
      }
      
      const successMessage = notesContent.trim() 
        ? '📝 Ticket notes have been updated successfully.'
        : '📝 Ticket notes have been cleared.';
      if (this.interactionManager) {
        await this.interactionManager.safeReply(interaction, {
          content: successMessage,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: successMessage,
          ephemeral: true
        });
      }
    } else {
      if (this.interactionManager) {
        await this.interactionManager.safeReply(interaction, {
          content: '❌ Failed to update ticket notes. Please check if the ticket exists and you have proper permissions.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ Failed to update ticket notes. Please check if the ticket exists and you have proper permissions.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * Handles whitelist modal submit
   */
  private async handleWhitelistModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const ticketKey = interaction.customId.replace('ticket_whitelist_', '');
    const userInput = interaction.fields.getTextInputValue('whitelist_user').trim();
    const reason = interaction.fields.getTextInputValue('whitelist_reason').trim();

    console.log(`Processing whitelist request for ticket ${ticketKey} by ${interaction.user.username}`);

    const isStaff = await this.verifyStaffPermissionsModal(interaction);
    if (!isStaff) {
      if (this.interactionManager) {
        await this.interactionManager.safeReply(interaction, {
          content: '❌ Only staff members can whitelist users.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ Only staff members can whitelist users.',
          ephemeral: true
        });
      }
      return;
    }

    let userId = userInput;
    if (userInput.startsWith('<@') && userInput.endsWith('>')) {
      userId = userInput.slice(2, -1);
      if (userId.startsWith('!')) {
        userId = userId.slice(1);
      }
    }

    if (!/^\d{17,20}$/.test(userId)) {
      if (this.interactionManager) {
        await this.interactionManager.safeReply(interaction, {
          content: '❌ Invalid user ID format. Please provide a valid Discord user ID.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ Invalid user ID format. Please provide a valid Discord user ID.',
          ephemeral: true
        });
      }
      return;
    }

    try {
      const guild = interaction.guild!;
      const member = await guild.members.fetch(userId).catch(() => null);
      
      if (!member) {
        if (this.interactionManager) {
          await this.interactionManager.safeReply(interaction, {
            content: '❌ User not found in this server. They must be a member to be whitelisted.',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ User not found in this server. They must be a member to be whitelisted.',
            ephemeral: true
          });
        }
        return;
      }

      const whitelistSuccess = this.ticketManager?.addUserToWhitelist(
        interaction.guildId!,
        ticketKey,
        userId,
        interaction.user.id
      );

      console.log(`Whitelist operation result for ticket ${ticketKey}: ${whitelistSuccess}`);

      if (!whitelistSuccess) {
        if (this.interactionManager) {
          await this.interactionManager.safeReply(interaction, {
            content: '❌ Failed to add user to whitelist. Ticket may not exist or user may already be whitelisted.',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ Failed to add user to whitelist. Ticket may not exist or user may already be whitelisted.',
            ephemeral: true
          });
        }
        return;
      }

      const thread = interaction.channel as ThreadChannel;
      await thread.members.add(userId);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      try {
        const freshTicketData = await this.getTicketFromThread(interaction.channel);
        if (freshTicketData) {
          await this.refreshControlEmbed(interaction, thread, freshTicketData);
        }
      } catch (error) {
        console.error('Error refreshing control embed after whitelist update:', error);
      }

      const logMessage = reason 
        ? `User ${member.user.username} (${userId}) whitelisted by ${interaction.user.username}. Reason: ${reason}`
        : `User ${member.user.username} (${userId}) whitelisted by ${interaction.user.username}.`;
      
      console.log(`Ticket ${ticketKey}: ${logMessage}`);

      if (this.interactionManager) {
        await this.interactionManager.safeReply(interaction, {
          content: `✅ ${member.user.username} has been whitelisted and added to this locked ticket.${reason ? `\n**Reason:** ${reason}` : ''}`,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: `✅ ${member.user.username} has been whitelisted and added to this locked ticket.${reason ? `\n**Reason:** ${reason}` : ''}`,
          ephemeral: true
        });
      }

      await thread.send({
        content: `📝 **Staff Notice:** ${member.user.username} has been granted access to this locked ticket by ${interaction.user.username}.`,
      });

    } catch (error) {
      console.error('Error whitelisting user:', error);
      if (this.interactionManager) {
        await this.interactionManager.safeReply(interaction, {
          content: '❌ Failed to whitelist user. They may already be in the thread or there was a permission error.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ Failed to whitelist user. They may already be in the thread or there was a permission error.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * Verifies if user has staff permissions (for modal interactions)
   */
  private async verifyStaffPermissionsModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!this.ticketManager || !interaction.guild) return false;
    
    const staffList = this.ticketManager.getStaffList(interaction.guild.id);
    return staffList.includes(interaction.user.id);
  }
}