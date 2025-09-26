import { EmbedBuilder, AttachmentBuilder, Client, DMChannel } from 'discord.js';
import { TicketSummary } from '../bot/ticketManager.js';

export interface TicketSendResult {
  dmChannel: DMChannel | null;
  wasSent: boolean;
  inGuild: boolean;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * Send ticket summary with optional transcript to user via DM
 * @param ticketSummary Ticket summary with optional transcript data
 * @param client Discord client instance
 * @param reason Close reason (optional)
 * @returns Promise resolving to send result
 */
export async function sendTicketSummary(
  ticketSummary: TicketSummary,
  client: Client,
  reason: string = ''
): Promise<TicketSendResult> {
  try {
    const { ticketData, transcriptResult } = ticketSummary;

    // Validate transcript content if provided
    if (transcriptResult && !transcriptResult.success) {
      console.error('[ERR]: Invalid transcript result provided');
      return {
        dmChannel: null,
        wasSent: false,
        inGuild: true,
        error: {
          code: 'INVALID_TRANSCRIPT',
          message: 'Transcript result is not successful',
          details: transcriptResult.error
        }
      };
    }

    // Get the guild to check membership
    const guild = client.guilds.cache.get(ticketData.guildId);
    if (!guild) {
      console.error(`[ERR]: Guild ${ticketData.guildId} not found`);
      return {
        dmChannel: null,
        wasSent: false,
        inGuild: false,
        error: {
          code: 'GUILD_NOT_FOUND',
          message: `Guild ${ticketData.guildId} not found`
        }
      };
    }

    // Check if user is still in guild
    let inGuild = true;
    try {
      const guildMember = await guild.members.fetch(ticketData.userId);
      inGuild = !!guildMember;
    } catch {
      console.log(`[INFO]: User ${ticketData.userId} is no longer in the guild`);
      inGuild = false;
    }

    if (!inGuild) {
      console.log(`[INFO]: Skipping ticket summary send to ${ticketData.userId} as they are no longer in the guild`);
      return {
        dmChannel: null,
        wasSent: false,
        inGuild: false,
        error: {
          code: 'USER_NOT_IN_GUILD',
          message: 'User is no longer a member of the guild'
        }
      };
    }

    // Create DM channel
    let dmChannel: DMChannel;
    try {
      const user = await client.users.fetch(ticketData.userId);
      dmChannel = await user.createDM();
    } catch (dmError) {
      console.error('[ERR]: Failed to create DM channel:', dmError);
      return {
        dmChannel: null,
        wasSent: false,
        inGuild,
        error: {
          code: 'DM_CREATION_FAILED',
          message: 'Failed to create DM channel',
          details: dmError instanceof Error ? dmError.message : 'Unknown error'
        }
      };
    }

    // Prepare message content
    const messageParts: any[] = [];

    // Create embed with transcript information
    const embed = EmbedBuilder.from(ticketSummary.embed);

    // Add transcript information if available
    if (transcriptResult) {
      embed.addFields({
        name: '📄 Transcript',
        value: `A transcript of your ticket conversation is attached below.`,
        inline: false
      });
    }

    // Add close reason if provided
    if (reason && reason.trim()) {
      embed.addFields({
        name: 'Reason',
        value: reason.trim(),
        inline: false
      });
    }

    messageParts.push(embed);

    // Add transcript attachment if available
    if (transcriptResult) {
      const htmlContent = transcriptResult.html;
      if (!htmlContent) {
        console.error('[ERR]: No transcript HTML content available');
        return {
          dmChannel: null,
          wasSent: false,
          inGuild,
          error: {
            code: 'NO_TRANSCRIPT_CONTENT',
            message: 'Transcript result contains no HTML content'
          }
        };
      }

      const buffer = Buffer.from(htmlContent, 'utf-8');
      const attachment = new AttachmentBuilder(buffer, {
        name: `ticket-${ticketData.ticketNumber}-transcript.html`,
        description: `Transcript for ticket #${ticketData.ticketNumber}`,
      });

      messageParts.push(attachment);
    }

    // Send the message
    await dmChannel.send({
      embeds: [embed],
      files: transcriptResult ? [messageParts[1]] : []
    });

    console.log(`[INFO]: Successfully sent ticket summary${transcriptResult ? ' with transcript' : ''} to user ${ticketData.userId} for ticket #${ticketData.ticketNumber}`);

    return {
      dmChannel,
      wasSent: true,
      inGuild
    };

  } catch (error) {
    console.error('[ERR]: sendTicketSummary error:', error);
    return {
      dmChannel: null,
      wasSent: false,
      inGuild: true,
      error: {
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        details: error
      }
    };
  }
}