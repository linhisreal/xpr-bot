import { Channel, Message, User, Embed, Attachment, MessageReaction, TextChannel, ThreadChannel, Collection } from 'discord.js';
import {
  TranscriptOptions,
  TranscriptResult,
  TranscriptMessage,
  TranscriptEmbed,
  TranscriptAttachment,
  TranscriptReaction,
  TranscriptComponent,
  HtmlGenerationOptions
} from '../types/transcript.js';

export type { TranscriptOptions, TranscriptResult };

/**
Ehhh, ignore this section

interface MobileGestureEvent {
  startX: number;
  currentX: number;
  isDragging: boolean;
}

interface MobileBreakpoints {
  xs: number; // 320px
  sm: number; // 480px
  md: number; // 768px
  lg: number; // 1024px
}

interface TouchGestureConfig {
  swipeThreshold: number;
  dragThreshold: number;
  animationDuration: number;
}
*/

const mentionCache = {
  users: new Map<string, string>(),
  channels: new Map<string, string>(),
  roles: new Map<string, string>()
};


/**
 * Gets username from user ID with caching
 */
function getUsernameFromId(userId: string, channel: any): string | null {
  if (mentionCache.users.has(userId)) {
    return mentionCache.users.get(userId)!;
  }
  try {
    if (channel.client && channel.client.users.cache.has(userId)) {
      const user = channel.client.users.cache.get(userId);
      mentionCache.users.set(userId, user.username);
      return user.username;
    }
    return null;
  } catch (error) {
    console.error('[TRANSCRIPT]: Error getting username for ID', userId, error);
    return null;
  }
}

/**
 * Gets channel name from channel ID with caching
 */
function getChannelNameFromId(channelId: string, channel: any): string | null {
  if (mentionCache.channels.has(channelId)) {
    return mentionCache.channels.get(channelId)!;
  }
  try {
    if (channel.client && channel.client.channels.cache.has(channelId)) {
      const foundChannel = channel.client.channels.cache.get(channelId);
      mentionCache.channels.set(channelId, foundChannel.name);
      return foundChannel.name;
    }
    return null;
  } catch (error) {
    console.error('[TRANSCRIPT]: Error getting channel name for ID', channelId, error);
    return null;
  }
}

/**
 * Gets role name from role ID with caching
 */
function getRoleNameFromId(roleId: string, channel: any): string | null {
  if (mentionCache.roles.has(roleId)) {
    return mentionCache.roles.get(roleId)!;
  }
  try {
    if (channel.guild && channel.guild.roles.cache.has(roleId)) {
      const role = channel.guild.roles.cache.get(roleId);
      mentionCache.roles.set(roleId, role.name);
      return role.name;
    }
    return null;
  } catch (error) {
    console.error('[TRANSCRIPT]: Error getting role name for ID', roleId, error);
    return null;
  }
}

/**
 * Generates a comprehensive HTML transcript for a Discord channel
 * @param options Configuration options for transcript generation
 * @returns Promise resolving to transcript result
 */
export async function generateTranscript(options: TranscriptOptions): Promise<TranscriptResult> {
  const startTime = Date.now();

  try {
    const {
      channel,
      darkMode = true,
      limit = 500,
      includeReactions = true,
      includeComponents = true,
      customCss = '',
      includeSearch = true,
      includeJumpNav = true,
      after,
      before
    } = options;

    // Validate channel
    if (!channel || !('guild' in channel) || !channel.guild) {
      throw new TranscriptError('INVALID_CHANNEL', 'Invalid or inaccessible channel provided', { channelId: channel?.id }, new Date());
    }

    console.log(`[TRANSCRIPT]: Starting message fetch for channel #${channel.name} (${channel.id})`);

    // Try to refresh presence data to get most accurate status before generating transcript
    try {
      if (channel.guild && channel.guild.members && channel.guild.presences) {
        console.log(`[TRANSCRIPT]: Attempting to refresh presence cache for accurate status...`);
        // Force a small delay to allow Discord.js to update presence cache
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } catch (presenceError) {
      console.warn(`[TRANSCRIPT]: Could not refresh presence data:`, presenceError);
    }

    const messages = await fetchMessages(channel, limit, after, before);
    console.log(`[TRANSCRIPT]: Completed fetch for #${channel.name} - ${messages.length} messages retrieved`);

    // Convert messages to transcript format  
    const transcriptMessages = await convertMessages(messages, includeReactions, includeComponents);

    const guildChannel = channel as TextChannel | ThreadChannel;
    const htmlOptions: HtmlGenerationOptions = {
      darkMode,
      includeSearch,
      includeJumpNav,
      customCss,
      channelInfo: {
        id: guildChannel.id,
        name: guildChannel.name || 'Unknown Channel',
        type: guildChannel.type.toString()
      },
      guildInfo: {
        id: guildChannel.guild.id,
        name: guildChannel.guild.name,
        iconURL: guildChannel.guild.iconURL({ size: 128 }) || undefined
      },
      generatedAt: new Date()
    };

    const html = await generateHtml(transcriptMessages, htmlOptions, channel);

    const text = transcriptMessages.map(m => `[${formatDate(m.timestamp)}] ${m.author.username}: ${m.content || '[No text content]'}`).join('\n');

    // Calculate metadata
    const participants = Array.from(new Set(transcriptMessages.map(m => m.author.id)));
    const timestamps = transcriptMessages.map(m => m.timestamp);
    const dateRange = {
      start: timestamps.length > 0 ? new Date(Math.min(...timestamps.map(t => t.getTime()))) : new Date(),
      end: timestamps.length > 0 ? new Date(Math.max(...timestamps.map(t => t.getTime()))) : new Date()
    };

    const metadata = {
      messageCount: transcriptMessages.length,
      dateRange,
      participants,
      channel: htmlOptions.channelInfo,
      guild: htmlOptions.guildInfo
    };

    console.log(`[TRANSCRIPT]: Generated transcript for #${guildChannel.name} with ${transcriptMessages.length} messages in ${Date.now() - startTime}ms`);

    return {
      html,
      text,
      metadata,
      generatedAt: new Date(),
      success: true
    };

  } catch (error) {
    console.error('[TRANSCRIPT]: Error generating transcript:', error);

    const transcriptError = error instanceof TranscriptError ? error : new TranscriptError(
      'GENERATION_FAILED',
      error instanceof Error ? error.message : 'Unknown error occurred',
      { originalError: error },
      new Date()
    );

    // Generate fallback text transcript
    let fallbackText = '** ERROR GENERATING HTML TRANSCRIPT **\n\n';
    fallbackText += `Error details: ${transcriptError.message}\n\n`;
    fallbackText += '** Simple text version provided: **\n\n';
    
    try {
      const guildChannel = options.channel as TextChannel | ThreadChannel;
      const messages = await guildChannel.messages.fetch({ limit: 100 });
      fallbackText += `Channel: #${guildChannel.name} (${guildChannel.id})\n`;
      fallbackText += `Server: ${guildChannel.guild.name}\n`;
      fallbackText += `Transcript generated: ${new Date().toLocaleString()}\n`;
      fallbackText += `Messages retrieved: ${messages.size}\n\n`;
      
      const sortedMessages = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      sortedMessages.forEach(message => {
        fallbackText += `[${formatDate(new Date(message.createdTimestamp))}] ${message.author.username}: ${message.content || '[No text content]'}\n`;
        if (message.attachments.size > 0) {
          message.attachments.forEach(attachment => {
            fallbackText += `  - Attachment: ${attachment.name || 'Unnamed'} (${attachment.url})\n`;
          });
        }
        if (message.embeds.length > 0) {
          fallbackText += `  - Message contained ${message.embeds.length} embed(s)\n`;
        }
      });
    } catch (fallbackError) {
      console.error('[TRANSCRIPT]: Error in fallback transcript generation:', fallbackError);
      fallbackText += '** Failed to fetch messages for transcript **\n';
      fallbackText += `Error details: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`;
    }

    return {
      html: '',
      text: fallbackText,
      metadata: {
        messageCount: 0,
        dateRange: { start: new Date(), end: new Date() },
        participants: [],
        channel: { id: '', name: '', type: '' },
        guild: { id: '', name: '' }
      },
      generatedAt: new Date(),
      success: false,
      error: transcriptError.message
    };
  }
}

/**
 * Fetches messages from a Discord channel using comprehensive approach
 */
async function fetchMessages(
  channel: Channel,
  limit: number,
  after?: string,
  before?: string
): Promise<Message[]> {
  if (!channel.isTextBased()) {
    throw new TranscriptError('UNSUPPORTED_CHANNEL_TYPE', 'Channel type not supported for transcripts', { channelType: channel.type }, new Date());
  }

  const textChannel = channel as TextChannel | ThreadChannel;
  const fetchedMessages: Message[] = [];
  let lastId: string | null = null;
  let batchNumber = 0;
  let totalFetched = 0;

  while (batchNumber < 5) {
    batchNumber++;
    const options: any = { limit: 100 };
    if (lastId && !before) options.before = lastId;
    if (after) options.after = after;
    if (before) options.before = before;

    try {
      console.log(`[TRANSCRIPT]: Fetching batch #${batchNumber}...`);
      const messages = await textChannel.messages.fetch(options);
      if (!(messages instanceof Collection)) {
        break;
      }
      if (messages.size === 0) break;

      const messagesArray = Array.from(messages.values());
      fetchedMessages.push(...messagesArray);
      lastId = messagesArray[messagesArray.length - 1]?.id || null;
      if (!lastId) break;

      totalFetched += messages.size;
      console.log(`[TRANSCRIPT]: Batch #${batchNumber} - Got ${messages.size} messages, total: ${totalFetched}`);

      if (messages.size < 100) break;
      if (totalFetched >= limit) break;
    } catch (fetchError) {
      console.error(`[TRANSCRIPT]: Error fetching batch #${batchNumber}:`, fetchError);
      break;
    }
  }

  // Sort messages chronologically
  fetchedMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return fetchedMessages.slice(0, limit);
}

/**
 * Converts Discord.js messages to transcript format
 */
async function convertMessages(
  messages: Message[],
  includeReactions: boolean,
  includeComponents: boolean
): Promise<TranscriptMessage[]> {
  const transcriptMessages: TranscriptMessage[] = [];

  for (const message of messages) {
    try {
      // Debug: Log if message has components
      if (message.components && message.components.length > 0) {
        console.log(`[TRANSCRIPT]: Message ${message.id} has ${message.components.length} component containers`);
      }
      
      const transcriptMessage: TranscriptMessage = {
        id: message.id,
        content: message.content,
        author: await getUserInfo(message.author),
        timestamp: message.createdAt,
        embeds: message.embeds.map(embed => convertEmbed(embed)),
        attachments: message.attachments.map(att => convertAttachment(att)),
        reactions: includeReactions ? message.reactions.cache.map(r => convertReaction(r)) : [],
        components: includeComponents ? flattenMessageComponents(message.components) : [],
        edited: message.editedAt !== null,
        editedTimestamp: message.editedAt || undefined,
        mentionEveryone: message.mentions.everyone,
        mentions: {
          users: message.mentions.users.map(u => u.id),
          roles: message.mentions.roles.map(r => r.id),
          channels: message.mentions.channels?.map(c => c.id) || []
        },
        referencedMessage: message.reference?.messageId,
        type: message.type,
        flags: message.flags?.bitfield
      };

      transcriptMessages.push(transcriptMessage);
    } catch (error) {
      console.error(`[TRANSCRIPT]: Error converting message ${message.id}:`, error);
    }
  }

  return transcriptMessages;
}

/**
 * Gets cached user information
 */
async function getUserInfo(user: User): Promise<TranscriptMessage['author']> {
  const userInfo = {
    id: user.id,
    username: user.username,
    discriminator: user.discriminator,
    avatar: user.displayAvatarURL({ size: 128 }),
    bot: user.bot
  };

  return userInfo;
}

/**
 * Converts Discord embed to transcript format
 */
function convertEmbed(embed: Embed): TranscriptEmbed {
  return {
    title: embed.data.title || undefined,
    type: embed.data.type || undefined,
    description: embed.data.description || undefined,
    url: embed.data.url || undefined,
    timestamp: embed.data.timestamp ? new Date(embed.data.timestamp) : undefined,
    color: embed.data.color || undefined,
    footer: embed.data.footer ? {
      text: embed.data.footer.text,
      iconURL: embed.data.footer.icon_url
    } : undefined,
    image: embed.data.image ? {
      url: embed.data.image.url,
      proxyURL: embed.data.image.proxy_url,
      height: embed.data.image.height,
      width: embed.data.image.width
    } : undefined,
    thumbnail: embed.data.thumbnail ? {
      url: embed.data.thumbnail.url,
      proxyURL: embed.data.thumbnail.proxy_url,
      height: embed.data.thumbnail.height,
      width: embed.data.thumbnail.width
    } : undefined,
    author: embed.data.author ? {
      name: embed.data.author.name,
      url: embed.data.author.url,
      iconURL: embed.data.author.icon_url
    } : undefined,
    fields: embed.data.fields?.map(field => ({
      name: field.name,
      value: field.value,
      inline: field.inline
    })),
    provider: embed.data.provider && embed.data.provider.name ? {
      name: embed.data.provider.name,
      url: embed.data.provider.url
    } : undefined,
    video: embed.data.video && embed.data.video.url ? {
      url: embed.data.video.url,
      proxyURL: embed.data.video.proxy_url,
      height: embed.data.video.height,
      width: embed.data.video.width
    } : undefined
  };
}

/**
 * Converts Discord attachment to transcript format
 */
function convertAttachment(attachment: Attachment): TranscriptAttachment {
  return {
    id: attachment.id,
    name: attachment.name || 'Unknown',
    size: attachment.size,
    url: attachment.url,
    proxyURL: attachment.proxyURL,
    contentType: attachment.contentType || undefined,
    height: attachment.height || undefined,
    width: attachment.width || undefined,
    isImage: attachment.contentType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(attachment.name || ''),
    isVideo: attachment.contentType?.startsWith('video/') || /\.(mp4|webm|mov|avi)$/i.test(attachment.name || ''),
    isAudio: attachment.contentType?.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/i.test(attachment.name || '')
  };
}

/**
 * Converts Discord reaction to transcript format
 */
function convertReaction(reaction: MessageReaction): TranscriptReaction {
  return {
    emoji: {
      id: reaction.emoji.id || undefined,
      name: reaction.emoji.name || '',
      animated: reaction.emoji.animated || undefined
    },
    count: reaction.count,
    me: reaction.me
  };
}

/**
 * Flattens Discord.js message components from ActionRows
 */
function flattenMessageComponents(messageComponents: any[]): TranscriptComponent[] {
  if (!messageComponents || !Array.isArray(messageComponents)) {
    return [];
  }

  const components: TranscriptComponent[] = [];
  
  console.log(`[TRANSCRIPT]: Processing ${messageComponents.length} message component containers`);
  
  for (const actionRow of messageComponents) {
    // ActionRow type is 1, and it contains components
    if (actionRow.type === 1 && actionRow.components && Array.isArray(actionRow.components)) {
      console.log(`[TRANSCRIPT]: Found ActionRow with ${actionRow.components.length} components`);
      for (const component of actionRow.components) {
        try {
          const convertedComponent = convertComponent(component);
          components.push(convertedComponent);
          console.log(`[TRANSCRIPT]: Converted component type ${component.type}: ${component.label || component.placeholder || 'unlabeled'}`);
        } catch (error) {
          console.error('[TRANSCRIPT]: Error converting component:', error);
        }
      }
    } else {
      console.log(`[TRANSCRIPT]: Skipping non-ActionRow component with type ${actionRow.type}`);
    }
  }
  
  console.log(`[TRANSCRIPT]: Total components extracted: ${components.length}`);
  return components;
}

/**
 * Converts Discord component to transcript format
 */
function convertComponent(component: any): TranscriptComponent {
  const transcriptComponent: TranscriptComponent = {
    type: component.type,
    style: component.style,
    label: component.label,
    emoji: component.emoji ? {
      id: component.emoji.id || undefined,
      name: component.emoji.name || '',
      animated: component.emoji.animated || false
    } : undefined,
    url: component.url,
    customId: component.customId || component.custom_id, // Handle both naming conventions
    disabled: component.disabled || false,
    placeholder: component.placeholder,
    minValues: component.minValues || component.min_values,
    maxValues: component.maxValues || component.max_values
  };

  // Handle select menu options
  if (component.options && Array.isArray(component.options)) {
    transcriptComponent.options = component.options.map((opt: any) => ({
      label: opt.label || '',
      value: opt.value || '',
      description: opt.description,
      emoji: opt.emoji ? {
        id: opt.emoji.id || undefined,
        name: opt.emoji.name || '',
        animated: opt.emoji.animated || false
      } : undefined,
      default: opt.default || false
    }));
  }

  return transcriptComponent;
}

/**
 * Generates sidebar members HTML
 */
function generateSidebarMembers(threadMembers: any): string {
  if (!threadMembers || threadMembers.size === 0) {
    return '<div class="member-entry"><div class="member-name">No participants found</div></div>';
  }

  const members = Array.from(threadMembers.values());
  
  // Sort members by status then by name with better status handling
  const statusOrder = { 'online': 0, 'idle': 1, 'dnd': 2, 'offline': 3 } as const;
  members.sort((a: any, b: any) => {
    // Get status for both members using the same logic we'll use in rendering
    const getStatusForSorting = (member: any) => {
      if (member.presence?.status) return member.presence.status.toLowerCase();
      if (member.user?.presence?.status) return member.user.presence.status.toLowerCase();
      if (member.guild?.presences?.cache?.has(member.id)) {
        const guildPresence = member.guild.presences.cache.get(member.id);
        if (guildPresence?.status) return guildPresence.status.toLowerCase();
      }
      return 'offline';
    };
    
    const aStatus = getStatusForSorting(a);
    const bStatus = getStatusForSorting(b);
    
    const aOrder = statusOrder[aStatus as keyof typeof statusOrder] ?? 3;
    const bOrder = statusOrder[bStatus as keyof typeof statusOrder] ?? 3;
    
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    
    const aName = a.displayName || a.user?.username || 'Unknown';
    const bName = b.displayName || b.user?.username || 'Unknown';
    return aName.localeCompare(bName);
  });
  
  return members.slice(0, 20).map((member: any) => {
    // Try multiple ways to get status with more comprehensive checking
    let status = 'offline';
    let statusSource = 'default';
    
    // Method 1: Direct member presence
    if (member.presence?.status) {
      status = member.presence.status;
      statusSource = 'member.presence';
    }
    // Method 2: User presence from member
    else if (member.user?.presence?.status) {
      status = member.user.presence.status;
      statusSource = 'member.user.presence';
    }
    // Method 3: Guild presence cache lookup
    else if (member.guild?.presences?.cache?.has(member.id)) {
      const guildPresence = member.guild.presences.cache.get(member.id);
      if (guildPresence?.status) {
        status = guildPresence.status;
        statusSource = 'guild.presences.cache';
      }
    }
    // Method 4: Direct guild presence cache without member.guild reference
    else if (member.client?.guilds?.cache?.get(member.guild?.id)?.presences?.cache?.has(member.id)) {
      const clientGuildPresence = member.client.guilds.cache.get(member.guild.id).presences.cache.get(member.id);
      if (clientGuildPresence?.status) {
        status = clientGuildPresence.status;
        statusSource = 'client.guilds.presences';
      }
    }
    // Method 5: Try to fetch fresh presence from API if available
    else if (member.guild?.members?.cache?.get(member.id)) {
      const guildMember = member.guild.members.cache.get(member.id);
      if (guildMember?.presence?.status) {
        status = guildMember.presence.status;
        statusSource = 'guild.members.cache.presence';
      }
    }
    
    // Normalize status values (Discord.js sometimes uses different casing)
    if (typeof status === 'string') {
      status = status.toLowerCase();
      // Map any non-standard status values
      if (!['online', 'idle', 'dnd', 'offline'].includes(status)) {
        status = 'offline';
        statusSource += ' (normalized to offline)';
      }
    }
    
    const displayName = member.displayName || member.user?.username || 'Unknown User';
    console.log(`[TRANSCRIPT]: Member ${displayName} status: ${status} (source: ${statusSource})`);
    
    const avatar = member.displayAvatarURL ? member.displayAvatarURL({ size: 32, extension: 'png' }) : member.user?.displayAvatarURL({ size: 32, extension: 'png' }) || 'https://discord.com/assets/5fb477ca84edd15d9a2888765a7fe30c.png';
    const roleColor = member.displayHexColor !== '#000000' ? member.displayHexColor : '#DCDDDE';
    
    return `<div class="member-entry">
      <div class="member-avatar">
        <img src="${avatar}" alt="${escapeHtml(displayName)}" width="32" height="32" style="border-radius: 50%;" onerror="this.src='https://discord.com/assets/5fb477ca84edd15d9a2888765a7fe30c.png';">
        <div class="member-status status-${status}"></div>
      </div>
      <div class="member-name" style="color: ${roleColor}">${escapeHtml(displayName)}</div>
    </div>`;
  }).join('');
}

/**
 * Generates HTML transcript from messages with comprehensive functionality
 */
async function generateHtml(messages: TranscriptMessage[], options: HtmlGenerationOptions, channel: Channel): Promise<string> {
  const { darkMode, includeSearch, includeJumpNav, customCss, channelInfo, guildInfo, generatedAt } = options;

  const style = generateCss(customCss);
  const channelTopic = (channel as any).topic;
  
  // Get thread participants or channel members instead of all guild members
  let threadMembers = new Map();
  try {
    // For threads, get thread members; for regular channels, get participants from messages
    if ((channel as any).isThread?.()) {
      const members = await (channel as any).members.fetch();
      threadMembers = members;
    } else {

      const uniqueAuthors = new Set(messages.map(msg => msg.author.id));
      
      // Ensure the guild has presence data cached
      try {
        await (channel as any).guild.members.fetch({ withPresences: true });
      } catch (presenceError) {
        console.warn('[TRANSCRIPT]: Could not fetch guild members with presence data:', presenceError);
      }
      
      for (const authorId of uniqueAuthors) {
        try {
          const member = await (channel as any).guild.members.fetch({ user: authorId, force: true });
          
          // Explicitly try to get presence data from multiple sources
          let presence = null;
          
          // Try guild presence cache first
          if ((channel as any).guild.presences?.cache?.has(authorId)) {
            presence = (channel as any).guild.presences.cache.get(authorId);
          }
          
          // Attach presence to member for later use
          if (presence) {
            member.presence = presence;
          }
          
          threadMembers.set(authorId, member);
          console.log(`[TRANSCRIPT]: Fetched member ${member.displayName || member.user.username} with status: ${presence?.status || 'unknown'}`);
        } catch (err) {
          console.warn(`[TRANSCRIPT]: Could not fetch member ${authorId}:`, err);
        }
      }
    }
  } catch (error) {
    console.warn('[TRANSCRIPT]: Could not fetch thread/channel members:', error);
    threadMembers = new Map();
  }

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <meta name="description" content="Ticket transcript for ${escapeHtml(channelInfo.name)}">
    <meta name="generator" content="AWPT Discord Bot">
    <title>Ticket Transcript - #${escapeHtml(channelInfo.name)}</title>
    ${style}
</head>
<body${darkMode ? '' : ' class="light-mode"'}>
    <div class="transcript-layout">
        <div class="transcript-sidebar">
            <div class="sidebar-header">
                <div class="sidebar-channel-info">
                    <div class="sidebar-channel-name">#${escapeHtml(channelInfo.name)}</div>
                    <div class="sidebar-info-item">Server: ${escapeHtml(guildInfo.name)}</div>
                    <div class="sidebar-info-item">Generated: ${formatDate(generatedAt)}</div>
                    <div class="sidebar-info-item">Messages: ${messages.length}</div>
                    <div class="sidebar-info-item">Channel ID: ${channelInfo.id}</div>
                </div>
            </div>
            <div class="sidebar-section">Participants — ${threadMembers.size}</div>
            <div class="member-list">
                ${generateSidebarMembers(threadMembers)}
            </div>
        </div>
        <div class="sidebar-overlay"></div>
        <div class="transcript-main">
            <div class="transcript-topbar">
                <div class="topbar-left">
                    <button class="sidebar-toggle" id="sidebarToggle" title="Toggle sidebar">
                        <svg width="16" height="16" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
                        </svg>
                    </button>
                    <span class="channel-hash">#</span>
                    <h1 class="channel-name">${escapeHtml(channelInfo.name)}</h1>
                    ${channelTopic ? `<span class="channel-topic">${escapeHtml(channelTopic)}</span>` : ''}
                </div>
                <div class="topbar-right">
                    ${includeSearch ? `<div class="search-container">
                        <input type="text" id="searchInput" placeholder="Search transcript...">
                        <span id="searchCount"></span>
                    </div>` : ''}
                    <div class="topbar-controls">
                        <button class="topbar-button" id="darkModeToggle" title="Toggle dark/light mode">
                            <svg width="16" height="16" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M12,9c1.65,0,3,1.35,3,3s-1.35,3-3,3s-3-1.35-3-3S10.35,9,12,9 M12,7c-2.76,0-5,2.24-5,5s2.24,5,5,5s5-2.24,5-5 S14.76,7,12,7L12,7z M2,13l2,0c0.55,0,1-0.45,1-1s-0.45-1-1-1l-2,0c-0.55,0-1,0.45-1,1S1.45,13,2,13z M20,13l2,0c0.55,0, 1-0.45,1-1s-0.45-1-1-1l-2,0c-0.55,0,1,0.45,1,1S19.45,13,20,13z M11,2v2c0,0.55,0.45,1,1,1s1-0.45,1-1V2c0-0.55-0.45-1-1-1S11,1.45,11,2z M11,20v2c0,0.55,0.45,1,1,1s1-0.45,1-1v-2c0-0.55-0.45-1-1-1S11,19.45,11,20z M5.99,4.58c-0.39-0.39-1.03-0.39-1.41,0 c-0.39,0.39-0.39,1.03,0,1.41l1.06,1.06c0.39,0.39,1.03,0.39,1.41,0s0.39-1.03,0-1.41L5.99,4.58z M18.36,16.95 c-0.39-0.39-1.03-0.39-1.41,0c-0.39,0.39-0.39,1.03,0,1.41l1.06,1.06c0.39,0.39,1.03,0.39,1.41,0c0.39-0.39,0-1.03,0-1.41 L18.36,16.95z M19.42,5.99c0.39-0.39,0.39-1.03,0-1.41c-0.39-0.39-1.03-0.39-1.41,0l-1.06,1.06c-0.39,0.39-0.39,1.03,0,1.41 s1.03,0.39,1.41,0L19.42,5.99z M7.05,18.36c0.39-0.39,0.39-1.03,0-1.41c-0.39-0.39-1.03-0.39-1.41,0l-1.06,1.06 c-0.39,0.39-0.39,1.03,0,1.41s1.03,0.39,1.41,0L7.05,18.36z"></path>
                            </svg>
                        </button>
                        <button class="topbar-button" id="scrollToTop" title="Scroll to top">
                            <svg width="16" height="16" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z"></path>
                            </svg>
                        </button>
                        <button class="topbar-button" id="scrollToBottom" title="Scroll to bottom">
                            <svg width="16" height="16" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M7.41,8.59L12,13.17L16.59,8.59L18,10L12,16L6,10L7.41,8.59Z"></path>
                            </svg>
                        </button>
                    </div>
                    <span class="member-count">${threadMembers.size} participants</span>
                </div>
            </div>
            <div class="transcript-content">`;

  // Process messages in groups by author
  let currentUser: string | null = null;
  let currentMessages: TranscriptMessage[] = [];

  for (const message of messages) {
    try {
      if (currentUser !== message.author.id) {
        if (currentMessages.length > 0) {
          html += processMessageGroup(currentMessages, channel);
          currentMessages = [];
        }
        currentUser = message.author.id;
      }
      currentMessages.push(message);
    } catch (error) {
      console.error('[TRANSCRIPT]: Error processing message for grouping:', error);
    }
  }

  // Process final group
  if (currentMessages.length > 0) {
    html += processMessageGroup(currentMessages, channel);
  }

  // Add end system message
  html += `<div class="system-message">
            <span>End of transcript • Generated on ${formatDate(generatedAt)}</span>
        </div>
            </div>
        </div>
    </div>`;

  // Jump navigation is now integrated into the topbar, no separate generation needed

  html += '<script>';
  html += generateJavaScript(includeSearch, includeJumpNav);
  html += '</script>';
  html += '</body></html>';

  return html;
}


/**
 * Gets avatar URL with fallback
 */
function getAvatarUrl(author: TranscriptMessage['author']): string {
  try {
    return author.avatar || 'https://archive.org/download/discordprofilepictures/discordblue.png';
  } catch {
    return 'https://archive.org/download/discordprofilepictures/discordblue.png';
  }
}

/**
 * Processes a group of messages and generates HTML
 */
function processMessageGroup(messages: TranscriptMessage[], channel: Channel): string {
  if (!messages.length) return '';

  try {
    const author = messages[0].author;
    const timestamp = messages[0].timestamp;

    if (!author) {
      return `<div class="system-message">[Message with missing author data]</div>`;
    }

    let groupHTML = `<div class="message-group" data-user-id="${escapeHtml(author.id)}" id="msg-${escapeHtml(messages[0].id)}">
        <div class="message-avatar">
            <img src="${getAvatarUrl(author)}" alt="${escapeHtml(author.username || 'Unknown')}'s avatar"
                 onerror="this.onerror=null;this.src='https://discord.com/assets/5fb477ca84edd15d9a2888765a7fe30c.png';">
        </div>
        <div class="message-content-wrapper">
            <div class="message-header">
                <span class="username">${escapeHtml(author.username || 'Unknown User')}</span>`;

    if (author.bot) {
      groupHTML += `<span class="bot-tag">BOT</span>`;
    }

    let dateStr = 'Unknown Date';
    try {
      dateStr = formatDate(timestamp);
    } catch {
      dateStr = 'Unknown Date';
    }

    groupHTML += `
                <span class="timestamp" title="${dateStr}">
                    ${dateStr}
                </span>
            </div>
            <div class="message-content">`;

    for (const message of messages) {
      try {
        if (!message.id) continue;

        if (message.content) {
          groupHTML += `<div class="message-text">${markdownToHtml(message.content, channel)}</div>`;
        }

        if (message.embeds && Array.isArray(message.embeds) && message.embeds.length > 0) {
          for (const embed of message.embeds) {
            try {
              groupHTML += `<div class="embed-wrapper">${generateEmbedHtml(embed)}</div>`;
            } catch (embedError) {
              console.error('[TRANSCRIPT]: Error processing embed:', embedError);
              groupHTML += `<div class="message-text" style="color: #a3a6aa;">[Embed could not be displayed]</div>`;
            }
          }
        }

        if (message.attachments && message.attachments.length > 0) {
          message.attachments.forEach((attachment: TranscriptAttachment) => {
            try {
              groupHTML += generateAttachmentHtml(attachment);
            } catch (attachError) {
              console.error('[TRANSCRIPT]: Error processing attachment:', attachError);
              groupHTML += `<div class="message-text" style="color: #a3a6aa;">[Attachment could not be displayed]</div>`;
            }
          });
        }

        if (message.components && Array.isArray(message.components) && message.components.length > 0) {
          try {
            groupHTML += generateComponentsHtml(message.components);
          } catch (error) {
            console.error('[TRANSCRIPT]: Error processing components:', error);
            groupHTML += '<div class="message-text" style="color:#a3a6aa;">[Components could not be displayed]</div>';
          }
        }

        if (message.reactions && message.reactions.length > 0) {
          groupHTML += generateReactionsHtml(message.reactions);
        }
      } catch (messageError) {
        console.error('[TRANSCRIPT]: Error processing message:', messageError);
        groupHTML += `<div class="message-text" style="color: #ff5555;">[Message processing error]</div>`;
      }
    }

    groupHTML += '</div></div></div>';
    return groupHTML;
  } catch (groupError) {
    console.error('[TRANSCRIPT]: Error processing message group:', groupError);
    return `<div class="system-message">[Error displaying messages]</div>`;
  }
}

/**
 * Generates HTML for message components
 */
function generateComponentsHtml(components: TranscriptComponent[]): string {
  if (!components || !components.length) return '';
  
  try {
    let html = '<div class="message-components">';
    
    // Group components into rows (Discord components are grouped in rows)
    html += '<div class="component-row">';
    
    components.forEach(comp => {
      if (comp.type === 2) { // Button
        let style = '';
        let buttonClass = 'component-button';
        switch (comp.style) {
          case 1: // Secondary
            style = 'background-color:#4f545c;color:#ffffff;border:none;';
            break;
          case 2: // Primary
            style = 'background-color:#5865f2;color:#ffffff;border:none;';
            break;
          case 3: // Success
            style = 'background-color:#43b581;color:#ffffff;border:none;';
            break;
          case 4: // Danger
            style = 'background-color:#f04747;color:#ffffff;border:none;';
            break;
          case 5: // Link
            style = 'background-color:transparent;color:#00aff4;border:1px solid #dcddde;';
            buttonClass += ' component-button-link';
            break;
          default:
            style = 'background-color:#4f545c;color:#ffffff;border:none;';
        }
        
        let emojiHtml = '';
        if (comp.emoji) {
          if (comp.emoji.id) {
            const extension = comp.emoji.animated ? 'gif' : 'png';
            const emojiUrl = `https://cdn.discordapp.com/emojis/${comp.emoji.id}.${extension}`;
            const sanitizedName = comp.emoji.name.replace(/["'<>&]/g, '').replace(/<\/?em>/g, '_').replace(/\s+/g, '_');
            emojiHtml = `<img class="component-emoji" src="${emojiUrl}" alt=":${sanitizedName}:" title=":${sanitizedName}:" data-emoji-name="${sanitizedName}" data-emoji-id="${comp.emoji.id}" data-emoji-animated="${!!comp.emoji.animated}" crossorigin="anonymous" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.style.visibility='hidden';setTimeout(()=>{this.style.visibility='';this.style.display='inline-block';},200);}else{this.style.display='none';}">`;
          } else if (comp.emoji.name) {
            emojiHtml = `<span class="component-emoji-text">${comp.emoji.name} </span>`;
          }
        }
        
        const label = comp.label || 'Button';
        const title = comp.url ? `Opens: ${comp.url}` : label;
        html += `<button class="${buttonClass}" style="${style}" disabled title="${title}">${emojiHtml}${label}</button>`;
        
      } else if (comp.type === 3) { // Select menu
        const placeholder = comp.placeholder || 'Select an option...';
        const optionsText = comp.options && comp.options.length > 0 
          ? `${comp.options.length} option${comp.options.length !== 1 ? 's' : ''} available`
          : 'No options';
        html += `<div class="component-select" title="${optionsText}">
          <span class="component-select-placeholder">${placeholder}</span>
          <span class="component-select-arrow">▼</span>
        </div>`;
        
      } else if (comp.type === 4) { // Text input
        const placeholder = comp.placeholder || 'Enter text...';
        html += `<div class="component-text-input">
          <input type="text" placeholder="${placeholder}" disabled readonly>
        </div>`;
        
      } else {
        // Unknown component type
        html += `<div class="component-unknown">Unknown Component (Type: ${comp.type})</div>`;
      }
    });
    
    html += '</div>';
    html += '</div>';
    return html;
  } catch (error) {
    console.error('[TRANSCRIPT]: Error processing components:', error);
    return '<div class="message-text" style="color:#a3a6aa;">[Components could not be displayed]</div>';
  }
}

/**
 * Generates HTML for message reactions
 */
function generateReactionsHtml(reactions: TranscriptReaction[]): string {
  if (!reactions || !reactions.length) return '';
  
  try {
    let html = '<div class="message-reactions">';
    
    reactions.forEach(reaction => {
      try {
        let emojiHtml;
        if (reaction.emoji.id) {
          const extension = reaction.emoji.animated ? 'gif' : 'png';
          const emojiUrl = `https://cdn.discordapp.com/emojis/${reaction.emoji.id}.${extension}`;
          const sanitizedName = reaction.emoji.name.replace(/["'<>&]/g, '').replace(/<\/?em>/g, '_').replace(/\s+/g, '_');
          emojiHtml = `<img class="reaction-emoji" src="${emojiUrl}" alt=":${sanitizedName}:" title=":${sanitizedName}:" data-emoji-name="${sanitizedName}" data-emoji-id="${reaction.emoji.id}" data-emoji-animated="${!!reaction.emoji.animated}" crossorigin="anonymous" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.style.visibility='hidden';setTimeout(()=>{this.style.visibility='';this.style.display='inline-block';},200);}else{this.style.display='none';this.insertAdjacentText('afterend',':${sanitizedName}:');}">`;
        } else {
          emojiHtml = reaction.emoji.name;
        }
        html += `<div class="reaction"><span>${emojiHtml}</span><span class="reaction-count">${reaction.count}</span></div>`;
      } catch (emojiError) {
        console.error('[TRANSCRIPT]: Error rendering reaction:', emojiError);
      }
    });
    
    html += '</div>';
    return html;
  } catch (error) {
    console.error('[TRANSCRIPT]: Error processing reactions:', error);
    return '';
  }
}
function generateCss(customCss: string = ''): string {
  return `<style>
    :root {
        --discord-topbar: #1E1F22;
        --discord-primary-text: #F2F3F5;
        --discord-secondary-text: #949BA4;
        --discord-muted-text: #B5BAC1;
        --discord-hover: #DBDEE1;
        --discord-button-hover: #3D3E45;
    }
    
    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    }

    body {
        background-color: #36393f;
        color: #dcddde;
        padding: 0;
        margin: 0;
        max-width: 1000px;
        margin: 0 auto;
        font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    }

    .transcript-topbar {
        position: sticky;
        top: 0;
        height: 48px;
        background-color: var(--discord-topbar);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 16px;
        z-index: 1000;
        border-bottom: 1px solid #2B2D31;
        box-shadow: 0 1px 0 rgba(4, 4, 5, 0.2), 0 1.5px 0 rgba(6, 6, 7, 0.05), 0 2px 0 rgba(4, 4, 5, 0.05);
    }
    
    .topbar-left {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    .topbar-right {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    
    .channel-hash {
        color: var(--discord-secondary-text);
        font-size: 20px;
        font-weight: 600;
    }
    
    .channel-name {
        color: var(--discord-primary-text);
        font-size: 16px;
        font-weight: 600;
        margin: 0;
    }
    
    .channel-topic {
        color: var(--discord-secondary-text);
        font-size: 14px;
        margin-left: 8px;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    
    .member-count {
        color: var(--discord-secondary-text);
        font-size: 12px;
        padding: 2px 6px;
        background-color: #2B2D31;
        border-radius: 3px;
    }
    
    .topbar-controls {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    .topbar-button {
        background-color: transparent;
        border: none;
        color: var(--discord-secondary-text);
        padding: 6px;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
    }
    
    .topbar-button:hover {
        color: var(--discord-hover);
        background-color: var(--discord-button-hover);
    }
    
    /* Layout containers */
    .transcript-layout {
        display: flex;
        width: 100%;
        height: 100vh;
    }
    
    .transcript-sidebar {
        width: 240px;
        background-color: #2B2D31;
        overflow-y: auto;
        flex-shrink: 0;
        border-right: 1px solid #1E1F22;
        transition: transform 0.3s ease;
    }
    
    .transcript-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    
    .transcript-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        scroll-behavior: smooth;
    }
    
    /* Sidebar components */
    .sidebar-header {
        padding: 16px;
        border-bottom: 1px solid #1E1F22;
        background-color: #232428;
    }
    
    .sidebar-section {
        padding: 8px 16px;
        font-size: 12px;
        font-weight: 600;
        color: var(--discord-secondary-text);
        text-transform: uppercase;
        letter-spacing: 0.02em;
    }
    
    .member-list {
        padding: 0 8px;
    }
    
    .member-entry {
        display: flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s;
        margin-bottom: 1px;
    }
    
    .member-entry:hover {
        background-color: rgba(79, 84, 92, 0.16);
    }
    
    .member-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        margin-right: 12px;
        position: relative;
        flex-shrink: 0;
    }
    
    .member-avatar img {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        object-fit: cover;
    }
    
    .member-status {
        position: absolute;
        bottom: -2px;
        right: -2px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 2px solid #2B2D31;
    }
    
    .status-online { background-color: #23A55A; }
    .status-idle { background-color: #F0B232; }
    .status-dnd { background-color: #F23F43; }
    .status-offline { background-color: #80848E; }
    
    .member-name {
        font-size: 14px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    
    .sidebar-toggle {
        display: none;
        background: none;
        border: none;
        color: var(--discord-secondary-text);
        padding: 6px;
        border-radius: 4px;
        cursor: pointer;
        margin-right: 8px;
    }
    
    .sidebar-toggle:hover {
        color: var(--discord-hover);
        background-color: var(--discord-button-hover);
    }
    
    .sidebar-channel-info {
        margin-bottom: 12px;
    }
    
    .sidebar-channel-name {
        color: var(--discord-primary-text);
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 4px;
    }
    
    .sidebar-info-item {
        color: var(--discord-secondary-text);
        font-size: 12px;
        margin-bottom: 2px;
    }
    
    .search-container {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    #searchInput {
        background-color: #1E1F22;
        border: 1px solid #2B2D31;
        padding: 6px 12px;
        border-radius: 4px;
        color: var(--discord-primary-text);
        font-size: 14px;
        width: 200px;
        outline: none;
        transition: border-color 0.2s;
    }
    
    #searchInput:focus {
        border-color: #5865F2;
    }
    
    #searchCount {
        color: var(--discord-secondary-text);
        font-size: 12px;
        min-width: 60px;
    }

    .transcript-content {
        padding: 20px;
        overflow-y: auto;
        min-height: calc(100vh - 48px);
        scroll-behavior: smooth;
    }

        border-radius: 50%;
        margin-right: 15px;
    }

    .transcript-header h1 {
        color: white;
        font-size: 24px;
        margin: 0;
    }

    .transcript-header p {
        color: #a3a6aa;
        margin: 5px 0 0 0;
        font-size: 14px;
    }

    .transcript-info {
        color: #a3a6aa;
        margin-bottom: 20px;
    }

    .transcript-info p {
        margin: 5px 0;
        font-size: 14px;
    }

    .message-group {
        display: flex;
        margin-bottom: 16px;
        padding: 2px 16px;
        position: relative;
    }

    .message-group:hover {
        background-color: rgba(4, 4, 5, 0.07);
    }

    .message-avatar {
        width: 40px;
        height: 40px;
        margin-right: 16px;
        flex-shrink: 0;
    }

    .message-avatar img {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        object-fit: cover;
    }

    .message-content-wrapper {
        flex: 1;
        min-width: 0;
    }

    .message-header {
        display: flex;
        align-items: baseline;
        margin-bottom: 4px;
        gap: 8px;
    }

    .username {
        color: white;
        font-weight: 500;
        margin-right: 10px;
    }

    .timestamp {
        color: #a3a6aa;
        font-size: 12px;
    }

    .message-content {
        color: #DBDEE1;
        font-size: 16px;
        line-height: 20px;
        overflow-wrap: break-word;
        word-wrap: break-word;
        white-space: pre-wrap;
        margin-bottom: 0;
        position: relative;
    }

    .message-text {
        margin-bottom: 4px;
        line-height: 1.375;
    }

    .embed-wrapper {
        margin: 4px 0;
    }

    .message-text:not(:last-child) {
        margin-bottom: 4px;
    }

    .message-content p {
        margin: 0;
        line-height: 20px;
    }

    .message-content p:not(:last-child) {
        margin-bottom: 4px;
    }

    .message-attachment {
        padding-left: 55px;
        margin-top: 5px;
        display: block;
    }

    .attachment-image {
        max-width: 400px;
        max-height: 300px;
        border-radius: 4px;
    }
    
    /* Mobile-optimized attachment styles */
    @media (max-width: 768px) {
        .attachment-image {
            max-width: 100%;
            max-height: 250px;
        }
        
        .message-attachment {
            padding-left: 0;
            margin-top: 8px;
        }
        
        .attachment-file {
            padding: 8px;
            font-size: 14px;
            min-height: 44px;
            display: flex;
            align-items: center;
        }
        
        .image-attachment-link {
            padding: 8px;
            margin-top: 8px;
        }
        
        .attachment-note {
            font-size: 12px;
            margin-top: 6px;
        }
    }

    .attachment-file {
        display: inline-block;
        background-color: #2f3136;
        border-radius: 4px;
        padding: 10px;
        margin-top: 5px;
        color: #00aff4;
        text-decoration: none;
    }

    .attachment-note {
        color: #a3a6aa;
        font-size: 11px;
        margin-top: 4px;
        font-style: italic;

    }
    .embed {
        max-width: 520px;
        padding: 8px 10px;
        margin: 8px 0;
        background-color: #2f3136;
        border-left: 4px solid;
        border-radius: 4px;
    }
    
    /* Mobile-optimized embed styles */
    @media (max-width: 768px) {
        .embed {
            max-width: 100%;
            margin: 6px 0;
            padding: 6px 8px;
        }
        
        .embed-image img {
            max-width: 100%;
            max-height: 250px;
        }
        
        .embed-thumbnail img {
            max-width: 60px;
            max-height: 60px;
        }
        
        .embed-fields {
            grid-template-columns: 1fr;
            gap: 6px;
        }
        
        .embed-title {
            font-size: 15px;
            line-height: 1.2;
        }
        
        .embed-description {
            font-size: 14px;
            line-height: 1.3;
        }
    }

    .embed-author {
        display: flex;
        align-items: center;
        margin-bottom: 5px;
    }

    .embed-author img {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        margin-right: 8px;
    }

    .embed-title {
        color: white;
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 8px;
    }

    .embed-description {
        color: #dcddde;
        margin-bottom: 8px;
        font-size: 14px;
    }

    .embed-fields {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin: 8px 0;
    }

    .embed-field {
        margin-bottom: 8px;
    }

    .field-name {
        color: white;
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 2px;
    }

    .field-value {
        color: #dcddde;
        font-size: 14px;
    }

    .embed-footer {
        display: flex;
        align-items: center;
        margin-top: 8px;
        color: #a3a6aa;
        font-size: 12px;
    }

    .embed-footer img {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-right: 8px;
    }

    .embed-image img {
        max-width: 500px;
        max-height: 300px;
        margin-top: 8px;
        border-radius: 4px;
    }

    .embed-thumbnail {
        float: right;
    }

    .embed-thumbnail img {
        max-width: 80px;
        max-height: 80px;
        border-radius: 4px;
    }

    .system-message {
        padding: 8px 12px;
        background-color: #2f3136;
        border-radius: 4px;
        margin-bottom: 15px;
        text-align: center;
        font-size: 14px;
        color: #a3a6aa;
    }

    .bot-tag {
        background-color: #5865f2;
        color: white;
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 10px;
        margin-left: 5px;
        vertical-align: middle;
    }

    ::-webkit-scrollbar {
        width: 8px;
    }

    ::-webkit-scrollbar-track {
        background-color: #2f3136;
    }

    ::-webkit-scrollbar-thumb {
        background-color: #202225;
        border-radius: 4px;
    }

    code {
        background-color: #2f3136;
        padding: 3px 5px;
        border-radius: 3px;
        font-family: Consolas, 'Courier New', monospace;
    }

    pre {
        background-color: #2f3136;
        padding: 8px;
        border-radius: 4px;
        margin: 5px 0;
        font-family: Consolas, 'Courier New', monospace;
        white-space: pre-wrap;
    }

    @media print {
        body {
            background-color: white;
            color: black;
        }
        .embed {
            border: 1px solid #ccc;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
        }
    }

    @media (max-width: 768px) {
        body {
            padding: 0;
            margin: 0;
            max-width: none; /* Remove max-width on mobile */
            width: 100vw; /* Full viewport width */
        }
        .transcript-topbar {
            height: 56px; /* Taller for mobile */
            padding: 0 12px;
            flex-wrap: nowrap;
            width: 100%; /* Full width */
            position: fixed; /* Make it stick to top */
            top: 0;
            left: 0;
            right: 0;
        }
        .transcript-fixed-header {
            padding: 15px;
            box-shadow: 0 2px 15px rgba(0, 0, 0, 0.3);
        }
        .transcript-content {
            padding: 15px;
            margin-top: 56px; /* Account for fixed topbar height */
            padding-bottom: 80px;
        }
        .transcript-nav {
            padding: 8px 0;
        }
        .search-container {
            gap: 6px;
            margin-left: 8px;
            display: flex;
            align-items: center;
        }
        
        .topbar-left {
            min-width: 0; /* Allow shrinking */
            flex: 1;
            gap: 6px;
            display: flex;
            align-items: center;
        }
        
        .topbar-right {
            flex-shrink: 0;
            gap: 6px; /* Smaller gap on mobile */
            display: flex;
            align-items: center;
        }
        
        .sidebar-toggle {
            display: inline-flex !important;
        }
        
        /* Hide participants text on mobile like Discord */
        .sidebar-section {
            display: none;
        }
        
        .channel-hash {
            font-size: 16px;
            display: inline-block;
        }
        
        .channel-name {
            font-size: 14px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 120px; 
            display: inline-block;
        }
        
        .channel-topic {
            display: none;
        }
        
        .topbar-controls {
            display: flex;
            gap: 6px;
        }
        
        .topbar-button {
            width: 32px;
            height: 32px;
            padding: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .topbar-button svg {
            width: 14px;
            height: 14px;
        }
        
        #searchInput {
            width: 120px;
            font-size: 13px;
            padding: 4px 8px;
        }
        
        #searchCount {
            font-size: 11px;
            min-width: 40px;
        }
        
        .transcript-container,
        .message-group,
        .message-content,
        .embed {
            width: 100%;
            max-width: none;
        }
        
        html, body {
            overflow-x: hidden;
            width: 100%;
        }
        
        .transcript-topbar {
            display: flex !important;
            visibility: visible !important;
            z-index: 1002;
        }
        
        /* Make sure sidebar doesn't cover topbar */
        .transcript-sidebar {
            top: 56px;
            z-index: 1001;
        }
        #searchInput {
            width: 150px;
            font-size: 13px;
        }
        .message-content {
            padding-left: 15px;
        }
        .attachment-image {
            max-width: 100%;
        }
    }
    .transcript-nav {
        position: static;
        background-color: transparent;
        padding: 10px 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        z-index: auto;
        border-radius: 0;
        margin-bottom: 0;
        box-shadow: none;
    }
    .transcript-nav .controls {
        display: flex;
        gap: 10px;
    }
    .transcript-nav button {
        background-color: #4f545c;
        border: none;
        color: white;
        padding: 5px;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
    }
    .transcript-nav button:hover {
        background-color: #5d6269;
    }
    .search-container {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
    }
    #searchInput {
        background-color: #40444b;
        border: 1px solid #72767d;
        padding: 6px 12px;
        border-radius: 4px;
        color: white;
        font-size: 14px;
        width: 220px;
        transition: border-color 0.2s ease;
    }
    #searchInput:focus {
        outline: none;
        border-color: #5865f2;
        box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.2);
    }
    #searchCount {
        color: #b9bbbe;
        font-size: 12px;
        margin: 0 5px;
        min-width: 60px;
        text-align: center;
    }
    .search-highlight {
        background-color: rgba(255, 255, 0, 0.3);
        border-radius: 2px;
    }
    .search-highlight-active {
        background-color: rgba(255, 165, 0, 0.5);
        border-radius: 2px;
    }
    /* Light mode styles */
    body.light-mode {
        background-color: #ffffff;
        color: #2e3338;
    }
    body.light-mode .transcript-fixed-header {
        background-color: #ffffff;
        border-bottom: 2px solid #e3e5e8;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        backdrop-filter: blur(10px);
    }
    body.light-mode .transcript-header h1 {
        color: #060607;
    }
    body.light-mode .transcript-header p {
        color: #747f8d;
    }
    body.light-mode .transcript-info {
        color: #747f8d;
    }
    body.light-mode .transcript-info p {
        color: #747f8d;
    }
    body.light-mode .transcript-nav {
        background-color: transparent;
    }
    body.light-mode .transcript-nav button {
        background-color: #e3e5e8;
        color: #4f5660;
    }
    body.light-mode .transcript-nav button:hover {
        background-color: #d4d7dc;
    }
    body.light-mode #searchInput {
        background-color: #e3e5e8;
        color: #2e3338;
        border: 1px solid #c4c9ce;
    }
    body.light-mode .system-message {
        background-color: #f2f3f5;
        color: #747f8d;
    }
    body.light-mode .embed {
        background-color: #f2f3f5;
    }
    body.light-mode code {
        background-color: #e3e5e8;
    }
    body.light-mode pre {
        background-color: #e3e5e8;
    }
    body.light-mode .message-content a {
        color: #00b0f4;
    }
    body.light-mode .image-attachment-link {
        background-color: rgba(242, 243, 245, 0.6);
        border: 1px solid rgba(79, 84, 92, 0.2);
    }
    body.light-mode .attachment-note {
        color: #747f8d;

    }
    /* Timestamp formatting */
    .timestamp-relative {
        font-size: 0.75rem;
        color: #72767d;
        margin-left: 0.5rem;
    }

    .jump-section {
        position: fixed;
        bottom: 20px;
        right: 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        z-index: 500;
    }
    /* Avatar and image hover effects */
    .message-header img:hover {
        transform: scale(1.2);
        transition: transform 0.2s ease;
    }
    .attachment-image:hover {
        opacity: 0.9;
    }
    /* Message hover highlight */
    .message-container:hover {
        background-color: rgba(79, 84, 92, 0.16);
        border-radius: 4px;
    }
    body.light-mode .message-container:hover {
        background-color: rgba(220, 221, 222, 0.3);
    }
    /* Component styling */
    .message-components {
        margin-top: 8px;
        margin-bottom: 4px;
    }
    
    .component-row {
        display: flex;
        gap: 8px;
        margin-bottom: 4px;
        flex-wrap: wrap;
    }
    
    .component-emoji {
        width: 16px;
        height: 16px;
        vertical-align: middle;
        margin-right: 4px;
        display: inline-block;
    }
    
    .component-emoji-text {
        margin-right: 4px;
    }
    
    .component-button {
        display: inline-flex;
        align-items: center;
        padding: 6px 12px;
        border-radius: 3px;
        font-size: 14px;
        font-weight: 500;
        cursor: not-allowed;
        opacity: 0.8;
        border: none;
        min-height: 32px;
        transition: opacity 0.2s ease;
    }
    
    .component-button:hover {
        opacity: 1;
    }
    
    .component-button-link {
        text-decoration: none;
    }
    
    .component-button-link:hover {
        text-decoration: underline;
    }
    
    .component-select {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px;
        border-radius: 3px;
        font-size: 14px;
        background-color: #2f3136;
        color: #dcddde;
        border: 1px solid #72767d;
        cursor: not-allowed;
        opacity: 0.8;
        min-width: 150px;
        min-height: 32px;
    }
    
    .component-select-placeholder {
        flex: 1;
        text-align: left;
    }
    
    .component-select-arrow {
        margin-left: 8px;
        font-size: 12px;
        opacity: 0.7;
    }
    
    .component-text-input {
        display: inline-block;
        min-width: 200px;
    }
    
    .component-text-input input {
        width: 100%;
        padding: 6px 12px;
        border-radius: 3px;
        font-size: 14px;
        background-color: #40444b;
        color: #dcddde;
        border: 1px solid #72767d;
        cursor: not-allowed;
        opacity: 0.8;
        min-height: 32px;
    }
    
    .component-unknown {
        display: inline-flex;
        align-items: center;
        padding: 6px 12px;
        border-radius: 3px;
        font-size: 13px;
        background-color: #f04747;
        color: white;
        opacity: 0.8;
        min-height: 32px;
    }
    
    /* Light mode component styles */
    body.light-mode .component-select {
        background-color: #ffffff;
        color: #2e3338;
        border: 1px solid #c4c9ce;
    }
    
    body.light-mode .component-text-input input {
        background-color: #ffffff;
        color: #2e3338;
        border: 1px solid #c4c9ce;
    }
    
    /* Mobile-optimized component styles */
    @media (max-width: 768px) {
        .message-components {
            margin-top: 4px;
            margin-bottom: 4px;
        }

        .component-row {
            gap: 6px;
            margin-bottom: 4px;
            align-items: stretch;
            justify-content: flex-start;
        }

        .component-button {
            padding: 8px 14px;
            min-height: 44px;
            font-size: 14px;
            flex-shrink: 0;
            touch-action: manipulation;
            user-select: none;
            cursor: pointer;
            box-sizing: border-box;
            transition: all 0.2s ease;
        }

        .component-select {
            min-width: 140px;
            min-height: 44px;
            font-size: 14px;
            box-sizing: border-box;
            transition: all 0.2s ease;
        }

        .component-text-input {
            min-width: 200px;
        }

        .component-text-input input {
            min-height: 44px;
            font-size: 16px; /* Prevent zoom on iOS */
            box-sizing: border-box;
            transition: all 0.2s ease;
        }

        .component-unknown {
            min-height: 44px;
            font-size: 14px;
            box-sizing: border-box;
            transition: all 0.2s ease;
        }
    }

    .attachment-wrapper {
        position: relative;
        display: inline-block;
    }
    .attachment-info {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background-color: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 4px 8px;
        font-size: 12px;
        opacity: 0;
        transition: opacity 0.2s;
    }
    .attachment-wrapper:hover .attachment-info {
        opacity: 1;
    }
    .attachment-name {
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    /* Table of contents */
    .transcript-toc {
        background-color: rgba(47, 49, 54, 0.8);
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 15px;
        max-height: 180px;
        overflow-y: auto;
        border: 1px solid #40444b;
    }
    .transcript-toc h2 {
        color: white;
        font-size: 14px;
        margin-bottom: 8px;
        font-weight: 600;
    }
    .toc-entry {
        margin-bottom: 4px;
    }
    .toc-entry a {
        color: #00aff4;
        text-decoration: none;
        font-size: 13px;
        padding: 2px 4px;
        border-radius: 3px;
        transition: background-color 0.2s ease;
    }
    .toc-entry a:hover {
        background-color: rgba(0, 175, 244, 0.1);
        text-decoration: underline;
    }
    /* Jump section */
    .jump-section {
        position: fixed;
        bottom: 20px;
        right: 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        z-index: 500;
        background: rgba(47, 49, 54, 0.95);
        backdrop-filter: blur(10px);
        border-radius: 12px;
        padding: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .jump-button {
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: #4f545c;
        border-radius: 50%;
        color: white;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        cursor: pointer;
        opacity: 0.8;
        transition: all 0.2s ease;
        border: 2px solid transparent;
    }
    .jump-button:hover {
        opacity: 1;
        background-color: #5865f2;
        transform: scale(1.05);
        border-color: rgba(88, 101, 242, 0.3);
    }

    .spoiler {
        background-color: #202225;
        color: transparent;
        cursor: pointer;
        padding: 0 2px;
        border-radius: 3px;
    }

    .spoiler:hover,
    .spoiler.revealed {
        background-color: rgba(32, 34, 37, 0.5);
        color: #dcddde;
    }

    blockquote {
        border-left: 4px solid #4f545c;
        padding-left: 8px;
        margin: 4px 0;
        color: #b9bbbe;
    }

    pre {
        background-color: #2f3136;
        padding: 8px;
        border-radius: 4px;
        margin: 5px 0;
        font-family: Consolas, 'Courier New', monospace;
        white-space: pre-wrap;
        max-width: 90%;
        overflow-x: auto;
    }

    code {
        background-color: #2f3136;
        padding: 3px 5px;
        border-radius: 3px;
        font-family: Consolas, 'Courier New', monospace;
        font-size: 85%;
        white-space: pre-wrap;
    }

    pre code {
        background-color: transparent;
        padding: 0;
        white-space: pre-wrap;
        display: block;
    }

    .mention {
        background-color: rgba(88, 101, 242, 0.3);
        color: #dee0fc;
        padding: 0 2px;
        border-radius: 3px;
        font-weight: 500;
    }

    .mention:hover {
        background-color: rgba(88, 101, 242, 0.6);
    }

    /* Light mode styles for these elements */
    body.light-mode .spoiler {
        background-color: #e5e5e5;
    }

    body.light-mode .spoiler:hover,
    body.light-mode .spoiler.revealed {
        background-color: rgba(229, 229, 229, 0.5);
        color: #2e3338;
    }

    body.light-mode blockquote {
        border-left-color: #c4c9ce;
        color: #747f8d;
    }

    body.light-mode pre,
    body.light-mode code {
        background-color: #f2f3f5;
    }

    body.light-mode .mention {
        background-color: rgba(88, 101, 242, 0.15);
        color: #5865f2;
    }

    /* Timestamp formatting */
    .timestamp {
        color: #72767d;
        font-size: 0.85em;
    }

    body.light-mode .timestamp {
        color: #747f8d;
    }

    ul {
        margin-left: 20px;
        list-style-type: disc;
    }

    ol {
        margin-left: 20px;
        list-style-type: decimal;
    }
    /* Discord emoji styling */
    .discord-emoji {
        width: 1.375em;
        height: 1.375em;
        vertical-align: bottom;
        object-fit: contain;
    }
    /* Reaction styling */
    .message-reactions {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
    }
    .reaction {
        background-color: rgba(79, 84, 92, 0.16);
        border-radius: 4px;
        display: flex;
        align-items: center;
        padding: 0 6px;
        height: 24px;
    }
    .reaction-emoji {
        width: 16px;
        height: 16px;
        margin-right: 4px;
        vertical-align: bottom;
    }
    .reaction-count {
        font-size: 0.85em;
        color: #b9bbbe;
    }
    body.light-mode .reaction {
        background-color: rgba(79, 84, 92, 0.08);
    }
    body.light-mode .reaction-count {
        color: #4f5660;
    }
    /* Improved Discord emoji styling */
    .discord-emoji {
        width: 1.375em;
        height: 1.375em;
        vertical-align: bottom;
        object-fit: contain;
        display: inline-block;
    }
    .emoji-container {
        display: inline-flex;
        align-items: center;
        position: relative;
    }
    .emoji-fallback {
        display: none;
        color: #dcddde;
        font-style: italic;
    }
    .emoji-failed .emoji-fallback {
        display: inline;
    }
    .animated-emoji {
        width: 1.375em;
        height: 1.375em;
        vertical-align: bottom;
        object-fit: contain;
        display: inline-block;
        box-shadow: 0 0 0 1px rgba(88, 101, 242, 0.2);
        border-radius: 3px;
        transition: transform 0.2s ease;
    }
    img.animated-emoji {
        position: relative;
    }
    img.animated-emoji::after {
        content: "GIF";
        position: absolute;
        bottom: -2px;
        right: -2px;
        font-size: 7px;
        background: rgba(0, 0, 0, 0.5);
        border-radius: 3px;
        padding: 0 2px;
        color: white;
    }

    .reaction {
        background-color: rgba(79, 84, 92, 0.16);
        border-radius: 4px;
        display: flex;
        align-items: center;
        padding: 0 6px;
        height: 24px;
    }
    .reaction-emoji {
        width: 16px;
        height: 16px;
        margin-right: 4px;
        vertical-align: middle;
        display: inline-block;
    }
    .embed-gif a.embed-link:hover {
        text-decoration: underline;
    }

    /*fixed rendering issues */
    .attachment-gif {
        max-width: 400px;
        max-height: 300px;
        border-radius: 4px;
        display: block;
        object-fit: contain;
        background: rgba(0, 0, 0, 0.05); /* Subtle background while loading */
    }
    /* Better GIF handling */
    .embed-gif {
        margin: 8px 0;
        display: block;
        background: rgba(0, 0, 0, 0.03);
        border-radius: 4px;
        padding: 2px;
        max-width: 100%;
    }
    .embed-gif img {
        max-width: 100%;
        max-height: 300px;
        border-radius: 4px;
        display: block;
        object-fit: contain;
        margin: 0 auto;
    }
    .gif-placeholder {
        max-width: 400px;
        transition: all 0.3s ease;
    }
    .embed-gif a.embed-link:hover {
        text-decoration: underline;
    }
    .image-attachment-link {
        display: flex;
        flex-direction: column;
        padding: 10px;
        border-radius: 4px;
        background-color: rgba(47, 49, 54, 0.6);
        border: 1px solid rgba(79, 84, 92, 0.3);
        margin-top: 5px;
    }
    .image-attachment-link a {
        color: #00aff4;
        text-decoration: none;
        font-weight: 500;
    }
    .image-attachment-link a:hover {
        text-decoration: underline;
    }
    body.light-mode .image-attachment-link {
        background-color: rgba(242, 243, 245, 0.6);
        border: 1px solid rgba(79, 84, 92, 0.2);
    }
    body.light-mode .attachment-note {
        color: #747f8d;
    }
    .embed-image-link {
        padding: 10px;
        margin: 5px 0;
        border-radius: 4px;
        background-color: rgba(47, 49, 54, 0.6);
        border: 1px solid rgba(79, 84, 92, 0.3);
    }
    .embed-image-link a {
        color: #00aff4;
        text-decoration: none;
        font-weight: 500;
        display: block;
    }
    .embed-image-link a:hover {
        text-decoration: underline;
    }
    body.light-mode .embed-image-link {
        background-color: rgba(242, 243, 245, 0.6);
        border: 1px solid rgba(79, 84, 92, 0.2);
    }
    
    /* Light mode topbar */
    body.light-mode {
        --discord-topbar: #FFFFFF;
        --discord-primary-text: #2E3338;
        --discord-secondary-text: #4F5660;
        --discord-muted-text: #747F8D;
        --discord-hover: #2E3338;
        --discord-button-hover: #E3E5E8;
    }
    
    body.light-mode .transcript-topbar {
        border-bottom: 1px solid #E3E5E8;
        box-shadow: 0 1px 0 rgba(6, 6, 7, 0.08);
    }
    
    body.light-mode .member-count {
        background-color: #E3E5E8;
    }
    
    body.light-mode #searchInput {
        background-color: #FFFFFF;
        border: 1px solid #E3E5E8;
    }
    
    body.light-mode #searchInput:focus {
        border-color: #5865F2;
    }
    
    /* Mobile light mode background overrides */
    body.light-mode .transcript-topbar {
        background-color: #F2F3F5;
    }
    
    body.light-mode .mobile-bottom-bar {
        background-color: #F2F3F5;
    }
    
    body.light-mode .transcript-sidebar {
        background-color: #F2F3F5;
    }
    
    body.light-mode .sidebar-header {
        background-color: #FFFFFF;
    }
    
    /* ===== COMPREHENSIVE RESPONSIVE DESIGN FOR ALL DEVICES ===== */

    /* Base responsive setup */
    html {
        font-size: 16px; /* Base font size for calculations */
    }

    /* Fluid typography system */
    @media (max-width: 320px) {
        html { font-size: 14px; }
    }

    @media (min-width: 321px) and (max-width: 480px) {
        html { font-size: 15px; }
    }

    @media (min-width: 481px) and (max-width: 768px) {
        html { font-size: 16px; }
    }

    @media (min-width: 769px) and (max-width: 1024px) {
        html { font-size: 17px; }
    }

    @media (min-width: 1025px) and (max-width: 1440px) {
        html { font-size: 18px; }
    }

    @media (min-width: 1441px) {
        html { font-size: 20px; }
    }

    /* ===== DEVICE-SPECIFIC BREAKPOINTS ===== */

    /* 1. Extra Small Devices (Phones < 480px) */
    @media (max-width: 479px) {
        .transcript-layout {
            flex-direction: column;
        }

        .transcript-topbar {
            height: 56px;
            padding: 0 12px;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 1002;
        }

        .transcript-main {
            margin-top: 56px;
            height: calc(100vh - 56px);
        }

        .transcript-content {
            padding: 8px 12px;
            padding-bottom: 100px; /* Extra space for mobile bottom bar */
        }

        .message-group {
            padding: 6px 12px 0 52px;
            min-height: 36px;
        }

        .message-avatar {
            width: 32px;
            height: 32px;
            left: 8px;
        }

        .username {
            font-size: 14px;
            line-height: 18px;
        }

        .message-content {
            font-size: 14px;
            line-height: 16px;
        }

        .timestamp {
            font-size: 10px;
        }

        .topbar-button {
            min-width: 40px;
            min-height: 40px;
            padding: 8px;
            border-radius: 6px;
        }

        .sidebar-toggle {
            display: flex;
            min-width: 40px;
            min-height: 40px;
            align-items: center;
            justify-content: center;
        }

        .channel-name {
            font-size: 13px;
            max-width: 100px;
        }

        .channel-hash {
            font-size: 14px;
        }

        #searchInput {
            width: 120px;
            font-size: 14px;
            padding: 4px 8px;
        }
    }

    /* 2. Small Phones (480px - 575px) */
    @media (min-width: 480px) and (max-width: 575px) {
        .transcript-topbar {
            height: 56px;
            padding: 0 14px;
        }

        .transcript-content {
            padding: 10px 14px;
            padding-bottom: 90px;
        }

        .message-group {
            padding: 8px 14px 0 56px;
        }

        .message-avatar {
            width: 34px;
            height: 34px;
            left: 10px;
        }

        .username {
            font-size: 15px;
        }

        .message-content {
            font-size: 15px;
            line-height: 17px;
        }

        .channel-name {
            font-size: 14px;
            max-width: 120px;
        }

        #searchInput {
            width: 140px;
            font-size: 15px;
        }
    }

    /* 3. Large Phones (576px - 767px) */
    @media (min-width: 576px) and (max-width: 767px) {
        .transcript-topbar {
            height: 58px;
            padding: 0 16px;
        }

        .transcript-main {
            margin-top: 58px;
            height: calc(100vh - 58px);
        }

        .transcript-content {
            padding: 12px 16px;
            padding-bottom: 85px;
        }

        .message-group {
            padding: 8px 16px 0 60px;
        }

        .message-avatar {
            width: 36px;
            height: 36px;
            left: 12px;
        }

        .channel-name {
            font-size: 15px;
            max-width: 140px;
        }

        #searchInput {
            width: 160px;
            font-size: 16px;
        }
    }

    /* 4. Small Tablets (768px - 991px) */
    @media (min-width: 768px) and (max-width: 991px) {
        .transcript-layout {
            flex-direction: row;
        }

        .transcript-topbar {
            height: 50px;
            position: sticky;
            margin-top: 0;
            padding: 0 18px;
        }

        .transcript-main {
            margin-top: 0;
            height: auto;
        }

        .transcript-sidebar {
            width: 220px;
            position: relative;
            transform: translateX(0);
        }

        .sidebar-toggle {
            display: none;
        }

        .transcript-content {
            padding: 16px 18px;
            padding-bottom: 16px;
        }

        .message-group {
            padding: 2px 14px;
            min-height: 42px;
        }

        .message-avatar {
            width: 38px;
            height: 38px;
            left: 14px;
        }

        .channel-name {
            font-size: 16px;
            max-width: 180px;
        }

        #searchInput {
            width: 200px;
        }
    }

    /* 5. Large Tablets (992px - 1199px) */
    @media (min-width: 992px) and (max-width: 1199px) {
        .transcript-sidebar {
            width: 240px;
        }

        .transcript-content {
            padding: 18px 20px;
        }

        .message-group {
            padding: 2px 16px;
        }

        .channel-name {
            max-width: 220px;
        }

        #searchInput {
            width: 220px;
        }

        .channel-topic {
            max-width: 250px;
        }
    }

    /* 6. Small Laptops (1200px - 1439px) */
    @media (min-width: 1200px) and (max-width: 1439px) {
        .transcript-sidebar {
            width: 260px;
        }

        .transcript-content {
            padding: 20px 24px;
        }

        .channel-name {
            max-width: 280px;
        }

        #searchInput {
            width: 240px;
        }

        .channel-topic {
            max-width: 320px;
        }

        .member-count {
            display: block;
        }
    }

    /* 7. Standard Desktops (1440px - 1919px) */
    @media (min-width: 1440px) and (max-width: 1919px) {
        .transcript-sidebar {
            width: 280px;
        }

        .transcript-content {
            padding: 24px 28px;
        }

        .channel-name {
            max-width: 350px;
        }

        #searchInput {
            width: 280px;
        }

        .channel-topic {
            max-width: 400px;
        }
    }

    /* 8. Large Desktops/Ultra-wide (1920px+) */
    @media (min-width: 1920px) {
        .transcript-layout {
            max-width: 1800px;
            margin: 0 auto;
        }

        .transcript-sidebar {
            width: 320px;
        }

        .transcript-content {
            padding: 28px 32px;
        }

        .channel-name {
            max-width: 450px;
        }

        #searchInput {
            width: 320px;
        }

        .channel-topic {
            max-width: 500px;
        }

        .message-group {
            padding: 4px 20px;
        }
    }

    /* ===== MOBILE-SPECIFIC ENHANCEMENTS ===== */

    /* Mobile sidebar behavior */
    @media (max-width: 767px) {
        .transcript-sidebar {
            position: fixed;
            top: 56px;
            left: 0;
            height: calc(100vh - 56px);
            width: 280px;
            z-index: 1001;
            transform: translateX(-280px);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        }

        .transcript-sidebar.open {
            transform: translateX(0);
        }

        .sidebar-overlay {
            position: fixed;
            top: 56px;
            left: 0;
            width: 100%;
            height: calc(100vh - 56px);
            background-color: rgba(0, 0, 0, 0.6);
            z-index: 1000;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s ease, visibility 0.3s ease;
        }

        .sidebar-overlay.show {
            opacity: 1;
            visibility: visible;
        }

        /* Mobile bottom action bar */
        .mobile-bottom-bar {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: 64px;
            background-color: var(--discord-topbar);
            border-top: 1px solid #2B2D31;
            display: flex;
            align-items: center;
            justify-content: space-around;
            z-index: 1001;
            padding: 8px 16px;
        }

        .mobile-action-button {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-width: 48px;
            min-height: 48px;
            background: none;
            border: none;
            color: var(--discord-secondary-text);
            font-size: 11px;
            cursor: pointer;
            border-radius: 8px;
            transition: all 0.2s ease;
            touch-action: manipulation;
        }

        .mobile-action-button:active {
            background-color: var(--discord-button-hover);
            transform: scale(0.95);
        }

        .mobile-action-button.active {
            color: var(--discord-primary-text);
        }
    }

    /* ===== TABLET-SPECIFIC OPTIMIZATIONS ===== */

    /* Medium tablets in portrait */
    @media (min-width: 768px) and (max-width: 991px) and (orientation: portrait) {
        .transcript-sidebar {
            width: 200px;
        }

        .transcript-content {
            padding: 14px 16px;
        }
    }

    /* Large tablets in landscape */
    @media (min-width: 992px) and (max-width: 1199px) and (orientation: landscape) {
        .transcript-sidebar {
            width: 220px;
        }

        .transcript-content {
            padding: 16px 18px;
        }
    }

    /* ===== TOUCH AND GESTURE OPTIMIZATIONS ===== */

    /* Touch devices */
    @media (hover: none) and (pointer: coarse) {
        /* Remove hover effects on touch devices */
        .message-group:hover {
            background-color: transparent;
        }

        .topbar-button:hover,
        .member-entry:hover,
        .mobile-action-button:hover {
            background-color: transparent;
        }

        .topbar-button:active,
        .member-entry:active,
        .mobile-action-button:active {
            background-color: var(--discord-button-hover);
            transform: scale(0.95);
        }

        .message-group:active {
            background-color: rgba(4, 4, 5, 0.1);
        }

        /* Larger touch targets */
        .topbar-button,
        .mobile-action-button {
            min-width: 44px;
            min-height: 44px;
        }

        /* Better spacing for touch */
        .message-group {
            padding-top: 8px;
            padding-bottom: 8px;
        }
    }

    /* ===== ORIENTATION HANDLING ===== */

    /* Landscape phones */
    @media (max-width: 767px) and (orientation: landscape) {
        .transcript-topbar {
            height: 48px;
        }

        .transcript-main {
            margin-top: 48px;
            height: calc(100vh - 48px);
        }

        .mobile-bottom-bar {
            height: 56px;
            padding: 6px 16px;
        }

        .transcript-content {
            padding-bottom: 70px;
        }

        .message-group {
            min-height: 32px;
        }

        .message-avatar {
            width: 28px;
            height: 28px;
        }

        .username {
            font-size: 13px;
        }

        .message-content {
            font-size: 13px;
            line-height: 15px;
        }
    }

    /* Landscape tablets */
    @media (min-width: 768px) and (max-width: 1199px) and (orientation: landscape) {
        .transcript-sidebar {
            width: 200px;
        }

        .transcript-content {
            padding: 14px 16px;
        }
    }

    /* ===== HIGH-DPI DISPLAYS ===== */

    /* Retina and high-DPI displays */
    @media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {
        .message-avatar img,
        .member-avatar img,
        .embed-thumbnail img,
        .embed-image img {
            image-rendering: -webkit-optimize-contrast;
            image-rendering: crisp-edges;
        }

        /* Sharper borders on high-DPI */
        .transcript-topbar,
        .transcript-sidebar,
        .mobile-bottom-bar {
            border-width: 0.5px;
        }
    }

    /* ===== ACCESSIBILITY AND USABILITY ===== */

    /* Reduced motion preferences */
    @media (prefers-reduced-motion: reduce) {
        .transcript-sidebar,
        .sidebar-overlay,
        .mobile-action-button,
        .topbar-button {
            transition: none;
        }

        .transcript-content {
            scroll-behavior: auto;
        }
    }

    /* High contrast mode */
    @media (prefers-contrast: high) {
        .transcript-topbar {
            border-bottom-width: 2px;
        }

        .message-group:hover {
            background-color: rgba(79, 84, 92, 0.2);
        }
    }

    /* ===== PRINT STYLES ===== */

    @media print {
        .transcript-layout {
            flex-direction: column;
        }

        .transcript-sidebar {
            display: none;
        }

        .transcript-topbar {
            position: static;
            border-bottom: 2px solid #000;
        }

        .transcript-content {
            padding: 20px;
        }

        .mobile-bottom-bar {
            display: none;
        }
    }
    
    ${customCss}
  </style>`;
}

/**
 * Helper function to get backup image URL
 */
function getBackupImageUrl(originalUrl: string, proxyUrl?: string): string | null {
    if (!originalUrl) return null;
    if (proxyUrl) {
        return `${proxyUrl}`;
    }
    return originalUrl;
}

function generateEmbedHtml(embed: TranscriptEmbed): string {
    if (!embed) return '<div class="embed">[Empty Embed]</div>';
    try {
        let colorHex = '#5865F2';
        if (embed.color) {
            colorHex = `#${embed.color.toString(16).padStart(6, '0')}`;
        }
        let isSpecialEmbed = false;
        let specialEmbedType = '';
        if (embed.type) {
            if (embed.type === 'rich') {
                // rich embeds are handled below
            } else if (embed.type === 'image' && embed.url) {
                isSpecialEmbed = true;
                specialEmbedType = 'image';
            } else if (embed.type === 'video' && embed.url) {
                isSpecialEmbed = true;
                specialEmbedType = 'video';
            } else if (embed.type === 'gifv' && embed.url) {
                isSpecialEmbed = true;
                specialEmbedType = 'gif';
            } else if (['link', 'article'].includes(embed.type)) {
                isSpecialEmbed = true;
                specialEmbedType = 'link';
            }
        }
        let embedHTML = `<div class="embed" style="border-left-color: ${colorHex};">`;
        if (isSpecialEmbed) {
            switch (specialEmbedType) {
                case 'image':
                    if (embed.thumbnail && embed.thumbnail.url) {
                        embedHTML += `
                            <div class="embed-image-link">
                                <a href="${embed.url || embed.thumbnail.url}" target="_blank" rel="noopener">
                                    🖼️ View Original Image
                                </a>
                                <div class="attachment-note">Image may no longer be available in closed tickets</div>
                            </div>`;
                    }
                    break;
                case 'video':
                    embedHTML += `
                        <div class="embed-rich-link">
                            <div class="embed-title">${embed.title ? markdownToHtml(embed.title) : 'Video'}</div>
                            ${embed.description ? `<div class="embed-description">${markdownToHtml(embed.description)}</div>` : ''}
                            <div class="embed-video-container">
                                <div class="embed-video-placeholder">
                                    ${embed.thumbnail ? `<img src="${getBackupImageUrl(embed.thumbnail.url, embed.thumbnail.proxyURL)}" alt="Video thumbnail" onerror="this.onerror=null;this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEABAMAAACuXLVVAAAAMFBMVEUzMzM+Pj5VVVVAQEA6OjoAAAA3NzfR0dFKSkpNTU3d3d1SUlJERERYWFhra2s0NDTKimD7AAAFLUlEQVR42u3dTW/bNhgAYFt2bCVZlqZ16wf2hXVbD9mEAT30J+wQrD10t6Jde+lP35eUZMmJDdTJegqCxg0gSnxIPqRIWuTm5ubm5ubm5ubm5jj99a9X/Sut3uz/+79XvX/6u1//qT1P/f0hWk9Rv/vwaQpN/QPAmFG/++Nb0bSgn+BHsl706VsMGvS7P3/A6lO/lfK19P0ZXP+Zufpa+Cr8Ap9w0O9++gZeP7KfJCr1k5Px/KDf/fIVvX5wu0XlJL0P4PXjH+D6yXBfnTLSTOMvwPWTwPptFpKtTF5BvwDrV4Q0htWvM4nLLwyuv2vAJuq3Z22C9ZOhlM86UL/95I5R9euMlk9A/ShnQPVXCRjXN9A5Bvrd7y+g+oexSS6A+mGB+lmWrYH1r+75tQHU37fYg+AAt1HtyabaEQzgNqq/C8Edwr5ZAvXTAOjWQw6TQJddgOsfN+EaTCfddQt0Q6H+Pp9K2IfAIKA7j/X302GbDUPgNwr1DzfoGuoQ2ILqH28B5ynZbJxW8OmkFz2RBIW3PQqmBXwi7cbNj7YI9y3VcANAFyQ0UXObYB9sj2HCNARGt1ENbxDgm2jSgt1izKbZZWiA7jao4Q0CbBfVGNOCcD0KhkOg/SYKDQLtNtFhnrgcBpuhvoG2m+huRkA3gxfPAPTLIUQGQR8Cs2VsExwEfQjMMFUcvuEeBAcBwd+8P9hvopuhn7Abv+EaBH0ITPAM3unHXv0b3s+h+gU0BIY3UU9f4Nto/QyuGa0/Syb4Bqo9MQTG12h9na8V1E4QvMcGQe0J0APoz3XiLzXUTrJfozfR+hk0BBrehvLsCAr7GD1G65cfQQOuAZYT0/bcUNnTG/b8H0KPr/B/oWmhY7T+UgDJ2hZ6jNdfiiQpW2iI118tgT3XQppSAJssuwBa6LO0+Oa5JEHQEvScJmRo/cUAOpiNQ+ubInULPUbrL++4npeFgz5nr3BloNPc3ECHpWQpy7HjQOCR6zqNefjKwl9yLwQs+Z8sLV7S4vtNljqb1+9ekx93W9DhZULQznKfIFn0CQc22V0Eem8vmcpVuvpmk4FOr+HmyVKulkkCqaBH68Bfy9k6kElwacKmBSjTArQPTNzrQaT+KJfo5FsH/CwHvlM35Ec0XyQQaK0DxcsSHU3TyYXIj0COAdkVggakG0QMZPjTSgGiKwQNZGsJhD1IBAyUGSzTVpBc2oAcmjcZgYCBH0omraCB4g5Ffh8MQHKHgLqPCB2A2jQcAPuXGuJPd8AYoFLowcg3bgDa0wnGQFYzIYCr8u4GMm3gyyI9uAFcGnUDuUhybyAUGykHVhVnYFVZEgD1514Z6Y8ZYFJ5vTLSLzFQcUDm9kC/xACRAyr2Z/SLDNDLHzob0C81MF+FDQzXIQOLVdDAch00sFoHDCxqfsmXiQLG++IrcTr7oE7nAwZUPmgg9/rFx6lmHzKged3AZF94rB4UNGDyoLbcShjQvDYgK0EDGtcGZB4yYHNtIBP26fdnppABiWgDTk8ZMHRiQO4iBoyaMhD07P+xgSxgwOZhA1arDFi7l5ABQ/e1AbMOGbB0YkDuAgasnDJg1KQBWxsD432xgXwfMmDohIFMSQtd149yfoYyfmbKQJSnDORRzk9Tfp7287QbaO5PUobOErbQ9PuYZfhM5ecp39+FzlOerwuf53xfHzxPer5BcJ70fZPwPO37NvF54uc2g++iwfeNwvO075vF58l/twvP8/9uGJ5n+N00PM/xu2143Tc3Nzc3Nzc3N7f/Af4HYsoSvpYpIKMAAAAASUVORK5CYII=';">` : ''}
                                    <div class="embed-video-play-button">▶</div>
                                </div>
                                <a href="${embed.url}" target="_blank" rel="noopener" class="embed-link">Video Link</a>
                            </div>
                        </div>`;
                    break;
                case 'gif':
                    embedHTML += `
                        <div class="embed-gif">
                            <img src="${embed.url || embed.thumbnail?.url}" alt="Animated GIF" data-is-gif="true" style="max-width:100%;">
                            <a href="${embed.url}" target="_blank" rel="noopener" class="embed-link">
                                🎞️ View Original GIF
                            </a>
                            <div class="attachment-note">GIF may no longer be available in closed tickets</div>
                        </div>`;
                    break;
                case 'link':
                    embedHTML += `
                        <div class="embed-rich-link">
                            ${embed.provider?.name ? `<div class="embed-provider">${escapeHtml(embed.provider.name)}</div>` : ''}
                            ${embed.author?.name ? `<div class="embed-author">${escapeHtml(embed.author.name)}</div>` : ''}
                            <a href="${embed.url}" target="_blank" rel="noopener" class="embed-title-link">
                                ${embed.title ? markdownToHtml(embed.title) : embed.url}
                            </a>
                            ${embed.description ? `<div class="embed-description">${markdownToHtml(embed.description)}</div>` : ''}
                            ${embed.thumbnail?.url ? `
                                <div class="embed-thumbnail">
                                    <img src="${getBackupImageUrl(embed.thumbnail.url, embed.thumbnail.proxyURL)}" alt="Link thumbnail" onerror="this.style.display='none';">
                                </div>` : ''}
                        </div>`;
                    break;
                default:
                    isSpecialEmbed = false;
            }
        }
        if (isSpecialEmbed) {
            embedHTML += '</div>';
            return embedHTML;
        } else {
            if (embed.author) {
                embedHTML += '<div class="embed-author">';
                if (embed.author.iconURL) {
                    const iconUrl = getBackupImageUrl(embed.author.iconURL);
                    embedHTML += `<img src="${iconUrl}" alt="Author Icon" onerror="this.style.display='none';">`;
                }
                embedHTML += `<span style="color: white;">${escapeHtml(embed.author.name || '')}</span>`;
                embedHTML += '</div>';
            }
            if (embed.title) {
                if (embed.url) {
                    embedHTML += `<a href="${embed.url}" target="_blank" rel="noopener" class="embed-title-link">
                                     <div class="embed-title">${markdownToHtml(embed.title)}</div>
                                 </a>`;
                } else {
                    embedHTML += `<div class="embed-title">${markdownToHtml(embed.title)}</div>`;
                }
            }
            if (embed.description) {
                embedHTML += `<div class="embed-description">${markdownToHtml(embed.description)}</div>`;
            }
            if (embed.thumbnail && embed.thumbnail.url) {
                const thumbUrl = getBackupImageUrl(embed.thumbnail.url, embed.thumbnail.proxyURL);
                embedHTML += `<div class="embed-thumbnail">
                                <img src="${thumbUrl}" alt="Thumbnail" onerror="this.onerror=null;this.style.display='none';">
                              </div>`;
            }
            if (embed.fields && Array.isArray(embed.fields) && embed.fields.length > 0) {
                const allInline = embed.fields.every(f => f && f.inline === true);
                embedHTML += `<div class="embed-fields" style="grid-template-columns: ${allInline ? 'repeat(3, 1fr)' : 'repeat(1, 1fr)'}">`;
                embed.fields.forEach(field => {
                    if (!field || !field.name) return;
                    embedHTML += `<div class="embed-field" ${field.inline === false ? 'style="grid-column: 1 / -1;"' : ''}>`;
                    embedHTML += `<div class="field-name">${markdownToHtml(field.name)}</div>`;
                    embedHTML += `<div class="field-value">${markdownToHtml(field.value || '')}</div>`;
                    embedHTML += '</div>';
                });
                embedHTML += '</div>';
            }
            if (embed.image && embed.image.url) {
                const imageUrl = getBackupImageUrl(embed.image.url, embed.image.proxyURL);
                embedHTML += `<div class="embed-image">
                                <img src="${imageUrl}" alt="Embed Image" onerror="this.onerror=null;this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEABAMAAACuXLVVAAAAMFBMVEUzMzM+Pj5VVVVAQEA6OjoAAAA3NzfR0dFKSkpNTU3d3d1SUlJERERYWFhra2s0NDTKimD7AAAFLUlEQVR42u3dTW/bNhgAYFt2bCVZlqZ16wf2hXVbD9mEAT30J+wQrD10t6Jde+lP35eUZMmJDdTJegqCxg0gSnxIPqRIWuTm5ubm5ubm5ubm5jj99a9X/Sut3uz/+79XvX/6u1//qT1P/f0hWk9Rv/vwaQpN/QPAmFG/++Nb0bSgn+BHsl706VsMGvS7P3/A6lO/lfK19P0ZXP+Zufpa+Cr8Ap9w0O9++gZeP7KfJCr1k5Px/KDf/fIVvX5wu0XlJL0P4PXjH+D6yXBfnTLSTOMvwPWTwPptFpKtTF5BvwDrV4Q0htWvM4nLLwyuv2vAJuq3Z22C9ZOhlM86UL/95I5R9euMlk9A/ShnQPVXCRjXN9A5Bvrd7y+g+oexSS6A+mGB+lmWrYH1r+75tQHU37fYg+AAt1HtyabaEQzgNqq/C8Edwr5ZAvXTAOjWQw6TQJddgOsfN+EaTCfddQt0Q6H+Pp9K2IfAIKA7j/X302GbDUPgNwr1DzfoGuoQ2ILqH28B5ynZbJxW8OmkFz2RBIW3PQqmBXwi7cbNj7YI9y3VcANAFyQ0UXObYB9sj2HCNARGt1ENbxDgm2jSgt1izKbZZWiA7jao4Q0CbBfVGNOCcD0KhkOg/SYKDQLtNtFhnrgcBpuhvoG2m+huRkA3gxfPAPTLIUQGQR8Cs2VsExwEfQjMMFUcvuEeBAcBwd+8P9hvopuhn7Abv+EaBH0ITPAM3unHXv0b3s+h+gU0BIY3UU9f4Nto/QyuGa0/Syb4Bqo9MQTG12h9na8V1E4QvMcGQe0J0APoz3XiLzXUTrJfozfR+hk0BBrehvLsCAr7GD1G65cfQQOuAZYT0/bcUNnTG/b8H0KPr/B/oWmhY7T+UgDJ2hZ6jNdfiiQpW2iI118tgT3XQppSAJssuwBa6LO0+Oa5JEHQEvScJmRo/cUAOpiNQ+ubInULPUbrL++4npeFgz5nr3BloNPc3ECHpWQpy7HjQOCR6zqNefjKwl9yLwQs+Z8sLV7S4vtNljqb1+9ekx93W9DhZULQznKfIFn0CQc22V0Eem8vmcpVuvpmk4FOr+HmyVKulkkCqaBH68Bfy9k6kElwacKmBSjTArQPTNzrQaT+KJfo5FsH/CwHvlM35Ec0XyQQaK0DxcsSHU3TyYXIj0COAdkVggakG0QMZPjTSgGiKwQNZGsJhD1IBAyUGSzTVpBc2oAcmjcZgYCBH0omraCB4g5Ffh8MQHKHgLqPCB2A2jQcAPuXGuJPd8AYoFLowcg3bgDa0wnGQFYzIYCr8u4GMm3gyyI9uAFcGnUDuUhybyAUGykHVhVnYFVZEgD1514Z6Y8ZYFJ5vTLSLzFQcUDm9kC/xACRAyr2Z/SLDNDLHzob0C81MF+FDQzXIQOLVdDAch00sFoHDCxqfsmXiQLG++IrcTr7oE7nAwZUPmgg9/rFx6lmHzKged3AZF94rB4UNGDyoLbcShjQvDYgK0EDGtcGZB4yYHNtIBP26fdnppABiWgDTk8ZMHRiQO4iBoyaMhD07P+xgSxgwOZhA1arDFi7l5ABQ/e1AbMOGbB0YkDuAgasnDJg1KQBWxsD432xgXwfMmDohIFMSQtd149yfoYyfmbKQJSnDORRzk9Tfp7287QbaO5PUobOErbQ9PuYZfhM5ecp39+FzlOerwuf53xfHzxPer5BcJ70fZPwPO37NvF54uc2g++iwfeNwvO075vF58l/twvP8/9uGJ5n+N00PM/xu2143Tc3Nzc3Nzc3N7f/Af4HYsoSvpYpIKMAAAAASUVORK5CYII='">
                              </div>`;
            }
            if (embed.footer) {
                embedHTML += '<div class="embed-footer">';
                if (embed.footer.iconURL) {
                    embedHTML += `<img src="${embed.footer.iconURL}" alt="Footer Icon" onerror="this.style.display='none';">`;
                }
                embedHTML += `<span>${escapeHtml(embed.footer.text || '')}</span>`;
                if (embed.timestamp) {
                    try {
                        const date = new Date(embed.timestamp);
                        embedHTML += ` • ${date.toLocaleString()}`;
                    } catch {
                        /* ignore */
                    }
                }
                embedHTML += '</div>';
            } else if (embed.timestamp) {
                try {
                    const date = new Date(embed.timestamp);
                    embedHTML += `<div class="embed-footer">${date.toLocaleString()}</div>`;
                } catch {
                    /* ignore */
                }
            }
            embedHTML += '</div>';
            return embedHTML;
        }
    } catch (error) {
        console.error('[TRANSCRIPT]: Error creating embed HTML:', error);
        return '<div class="embed" style="border-left-color: #ff0000;">[Error displaying embed]</div>';
    }
}

/**
 * Generates attachment HTML
 */
function generateAttachmentHtml(attachment: TranscriptAttachment): string {
  let html = '<div class="message-attachment">';
  
  if (attachment.isImage) {
    html += `<div class="attachment-file image-attachment-link">
      <a href="${attachment.url}" target="_blank" rel="noopener">🖼️ ${escapeHtml(attachment.name)} (${formatFileSize(attachment.size)})</a>
      <div class="attachment-note">Image may no longer be available in closed tickets</div>
    </div>`;
  } else {
    const icon = getFileIcon(attachment.name);
    html += `<a class="attachment-file" href="${attachment.url}" target="_blank">${icon} ${escapeHtml(attachment.name)} (${formatFileSize(attachment.size)})</a>`;
  }
  
  html += '</div>';
  return html;
}

/**
 * Generates JavaScript for interactive features
 */
function generateJavaScript(includeSearch: boolean, includeJumpNav: boolean): string {
  let js = `document.addEventListener('DOMContentLoaded', function() {
    // Container scrolling utilities
    function getContentContainer() {
      return document.querySelector('.transcript-content');
    }

    function getFixedHeaderHeight() {
      const header = document.querySelector('.transcript-fixed-header');
      return header ? header.offsetHeight : 0;
    }

    function scrollToElement(element, offset = 0) {
      const container = getContentContainer();
      if (!container || !element) return;

      const elementRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;
      const targetScrollTop = scrollTop + elementRect.top - containerRect.top - offset;

      container.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
      });
    }

    function scrollToTop() {
      const container = getContentContainer();
      if (container) {
        container.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    function scrollToBottom() {
      const container = getContentContainer();
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }
    }

    // Mobile navigation and gesture support
    function initializeMobileFeatures() {
        const sidebar = document.querySelector('.transcript-sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        const sidebarToggle = document.getElementById('sidebarToggle');
        const body = document.body;
        
        // Create overlay if it doesn't exist
        if (!overlay) {
            const newOverlay = document.createElement('div');
            newOverlay.className = 'sidebar-overlay';
            newOverlay.addEventListener('click', closeSidebar);
            document.body.appendChild(newOverlay);
        }
        
        // Sidebar toggle functionality
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', toggleSidebar);
        }
        
        // Touch gesture support for sidebar
        let startX = 0;
        let currentX = 0;
        let isDragging = false;
        
        document.addEventListener('touchstart', (e) => {
            if (window.innerWidth > 768) return;
            startX = e.touches[0].clientX;
            
            // Enable swipe from left edge to open sidebar
            if (startX < 20 && !sidebar.classList.contains('open')) {
                isDragging = true;
            }
            // Enable swipe from sidebar to close
            else if (sidebar.classList.contains('open') && startX > 240) {
                isDragging = true;
            }
        });
        
        document.addEventListener('touchmove', (e) => {
            if (!isDragging || window.innerWidth > 768) return;
            
            currentX = e.touches[0].clientX;
            const deltaX = currentX - startX;
            
            if (sidebar.classList.contains('open')) {
                // Closing gesture
                if (deltaX < -50) {
                    e.preventDefault();
                }
            } else {
                // Opening gesture
                if (deltaX > 50) {
                    e.preventDefault();
                }
            }
        });
        
        document.addEventListener('touchend', (e) => {
            if (!isDragging || window.innerWidth > 768) return;
            
            const deltaX = currentX - startX;
            
            if (sidebar.classList.contains('open')) {
                // Close if swiped left significantly
                if (deltaX < -80) {
                    closeSidebar();
                }
            } else {
                // Open if swiped right significantly
                if (deltaX > 80) {
                    openSidebar();
                }
            }
            
            isDragging = false;
            startX = 0;
            currentX = 0;
        });
        
        // Handle window resize
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                closeSidebar();
            }
        });
    }
    
    function toggleSidebar() {
        const sidebar = document.querySelector('.transcript-sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        
        if (sidebar.classList.contains('open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    }
    
    function openSidebar() {
        const sidebar = document.querySelector('.transcript-sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        
        sidebar.classList.add('open');
        if (overlay) overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
    
    function closeSidebar() {
        const sidebar = document.querySelector('.transcript-sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.style.overflow = '';
    }
    
    function createMobileBottomBar() {
        if (document.querySelector('.mobile-bottom-bar')) return;
        
        const bottomBar = document.createElement('div');
        bottomBar.className = 'mobile-bottom-bar';
        bottomBar.innerHTML = \`
            <button class="mobile-action-button" onclick="scrollToTop()">
                <span style="font-size: 18px;">⬆️</span>
                <span>Top</span>
            </button>
            <button class="mobile-action-button" onclick="toggleSearch()">
                <span style="font-size: 18px;">🔍</span>
                <span>Search</span>
            </button>
            <button class="mobile-action-button" onclick="toggleTheme()">
                <span style="font-size: 18px;" id="mobileThemeIcon">🌙</span>
                <span>Theme</span>
            </button>
            <button class="mobile-action-button" onclick="scrollToBottom()">
                <span style="font-size: 18px;">⬇️</span>
                <span>Bottom</span>
            </button>
        \`;
        
        document.body.appendChild(bottomBar);
    }
    
    function removeMobileBottomBar() {
        const bottomBar = document.querySelector('.mobile-bottom-bar');
        if (bottomBar) {
            bottomBar.remove();
        }
    }
    
    function toggleSearch() {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.focus();
            searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    function toggleTheme() {
        document.body.classList.toggle('light-mode');
        const mobileThemeIcon = document.getElementById('mobileThemeIcon');
        if (mobileThemeIcon) {
            mobileThemeIcon.textContent = document.body.classList.contains('light-mode') ? '☀️' : '🌙';
        }
    }
    
    // Initialize mobile features
    initializeMobileFeatures();`;

  if (includeSearch) {
    js += `
      const searchInput = document.getElementById('searchInput');
      const searchCount = document.getElementById('searchCount');
      if (searchInput && searchCount) {
        let searchResults = [];
        let currentResultIndex = -1;

        searchInput.addEventListener('input', performSearch);
        searchInput.addEventListener('keydown', handleSearchKeydown);

        function performSearch() {
          const searchText = searchInput.value.trim();
          if (!searchText) {
            clearSearch();
            return;
          }

          clearSearch();

          const contents = document.querySelectorAll('.message-text, .embed-title, .embed-description, .embed-field, .field-name, .field-value, .embed-footer');
          searchResults = [];

          contents.forEach(content => {
            const textContent = content.textContent || '';
            if (textContent.toLowerCase().includes(searchText.toLowerCase())) {
              searchResults.push(content);
              highlightTextInElement(content, searchText);
            }
          });

          // Start with first result if any found
          if (searchResults.length > 0) {
            currentResultIndex = 0;
            // Scroll to first result
            const headerHeight = getFixedHeaderHeight();
            scrollToElement(searchResults[0], headerHeight + 20);
          } else {
            currentResultIndex = -1;
          }
          
          updateSearchCount();
        }

        function highlightTextInElement(element, searchText) {
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
          );
          
          const textNodes = [];
          let node;
          while (node = walker.nextNode()) {
            if (node.textContent && node.textContent.toLowerCase().includes(searchText.toLowerCase())) {
              textNodes.push(node);
            }
          }
          
          textNodes.forEach(textNode => {
            const text = textNode.textContent;
            const regex = new RegExp(searchText, 'gi');
            if (regex.test(text)) {
              const highlightedText = text.replace(regex, '<span class="search-highlight">$&</span>');
              const span = document.createElement('span');
              span.innerHTML = highlightedText;
              
              const fragment = document.createDocumentFragment();
              while (span.firstChild) {
                fragment.appendChild(span.firstChild);
              }
              
              textNode.parentNode.replaceChild(fragment, textNode);
            }
          });
        }

        function clearSearch() {
          searchResults = [];
          currentResultIndex = -1;
          searchCount.textContent = '';
          document.querySelectorAll('.search-highlight').forEach(el => {
            const parent = el.parentNode;
            parent.replaceChild(document.createTextNode(el.textContent), el);
            parent.normalize();
          });
        }

        function handleSearchKeydown(event) {
          if (searchResults.length === 0) return;

          if (event.key === 'Enter') {
            event.preventDefault();
            navigateToNextResult();
          } else if (event.key === 'Escape') {
            clearSearch();
          }
        }

        function navigateToNextResult() {
          if (searchResults.length === 0) return;

          currentResultIndex = (currentResultIndex + 1) % searchResults.length;
          const result = searchResults[currentResultIndex];
          const headerHeight = getFixedHeaderHeight();
          scrollToElement(result, headerHeight + 20);
          updateSearchCount();
        }

        function updateSearchCount() {
          if (searchResults.length === 0) {
            searchCount.textContent = 'No results';
          } else {
            const current = currentResultIndex + 1;
            searchCount.textContent = \`\${current} of \${searchResults.length} found\`;
          }
        }
      }

      // Dark mode toggle
      document.getElementById('darkModeToggle')?.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
      });

      // Scroll controls
      document.getElementById('scrollToTop')?.addEventListener('click', scrollToTop);
      document.getElementById('scrollToBottom')?.addEventListener('click', scrollToBottom);`;
  }

  if (includeJumpNav) {
    js += `
      // Jump navigation
      document.getElementById('jumpToTop')?.addEventListener('click', scrollToTop);
      document.getElementById('jumpToBottom')?.addEventListener('click', scrollToBottom);`;
  }

  js += `
  });`;

  return js;
}

/**
 * Generates plain text transcript
 */


/**
 * Utility functions
 */
function formatDate(date: Date): string {
  return date.toLocaleString();
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function markdownToHtml(text: string, channel?: Channel): string {
  if (!text) return '';

  try {
    const emojiPlaceholders: string[] = [];
    let protectedText = text.replace(
      /&lt;a?:[^:]+:\d+&gt;/g,
      (_match, emojiCode) => {
        const placeholder = `EMOJI_PLACEHOLDER_${emojiPlaceholders.length}`;
        emojiPlaceholders.push(emojiCode);
        return placeholder;
      }
    );

    protectedText = protectedText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    let html = protectedText;

    // Code blocks
    html = html.replace(
      /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
      (_match, language, code) => {
        const lang = language ? ` class="language-${language.trim()}"` : '';
        return `<pre><code${lang}>${code}</code></pre>`;
      }
    );

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Blockquotes
    html = html.replace(
      /(^|\\n)&gt; ([^\n]+)/gm,
      (_match, start, content) => {
        return `${start}<blockquote>${content}</blockquote>`;
      }
    );

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Underline (with emoji placeholder protection)
    html = html.replace(
      /(?<!EMOJI_PLACEHOLDER_\d+[^_]*)__(.+?)__(?![^_]*EMOJI_PLACEHOLDER_\d+)/g,
      '<u>$1</u>'
    );

    // Italic
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

    // Italic underscore (with emoji placeholder protection)
    html = html.replace(
      /(?<!EMOJI_PLACEHOLDER_\d+[^_]*)_(.+?)_(?![^_]*EMOJI_PLACEHOLDER_\d+)/g,
      '<em>$1</em>'
    );

    // Strikethrough
    html = html.replace(/~~(.*?)~~/g, '<s>$1</s>');

    // Spoilers
    html = html.replace(
      /\|\|(.*?)\|\|/g,
      '<span class="spoiler">$1</span>'
    );

    // Restore emoji placeholders
    emojiPlaceholders.forEach((emojiCode, index) => {
      html = html.replace(`EMOJI_PLACEHOLDER_${index}`, emojiCode);
    });

    // Process Discord emojis
    html = processDiscordEmoji(html);

    // User mentions
    html = html.replace(/&lt;@!?(\d+)&gt;/g, (_match, userId) => {
      try {
        const username = channel ? getUsernameFromId(userId, channel) : null;
        if (username) {
          return `<span class="mention user-mention" data-user-id="${userId}">@${username}</span>`;
        }
        return `<span class="mention user-mention" data-user-id="${userId}">@User</span>`;
      } catch (err) {
        console.error('[TRANSCRIPT]: Error processing user mention:', err);
        return `<span class="mention user-mention" data-user-id="${userId}">@User</span>`;
      }
    });

    // Channel mentions
    html = html.replace(/&lt;#(\d+)&gt;/g, (_match, channelId) => {
      try {
        const channelName = channel ? getChannelNameFromId(channelId, channel) : null;
        if (channelName) {
          return `<span class="mention channel-mention" data-channel-id="${channelId}">#${channelName}</span>`;
        }
        return `<span class="mention channel-mention" data-channel-id="${channelId}">#channel</span>`;
      } catch (err) {
        console.error('[TRANSCRIPT]: Error processing channel mention:', err);
        return `<span class="mention channel-mention" data-channel-id="${channelId}">#channel</span>`;
      }
    });

    // Role mentions
    html = html.replace(/&lt;@&(\d+)&gt;/g, (_match, roleId) => {
      const roleName = channel ? getRoleNameFromId(roleId, channel) : null;
      return `<span class="mention role-mention" data-role-id="${roleId}">@${roleName || 'role'}</span>`;
    });

    // Timestamps
    html = html.replace(
      /&lt;t:(\d+):[tTdDfFR]&gt;/g,
      (_match, timestamp) => {
        try {
          const date = new Date(parseInt(timestamp) * 1000);
          return `<span class="timestamp" title="${date.toLocaleString()}">${date.toLocaleString()}</span>`;
        } catch {
          return _match;
        }
      }
    );

    // Links
    html = html.replace(
      /(https?:\/\/[^\s<]+)(?![^<]*>|[^<>]*<\/a>)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    // Headers
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');

    return html;
  } catch (error) {
    console.error('[TRANSCRIPT]: Error processing markdown:', error);
    return text ? escapeHtml(text) : '';
  }
}

function processDiscordEmoji(content: string): string {
  try {
    let processedContent = content;
    processedContent = processedContent.replace(
      /<img[^>]*?src="(?:<a href=")?([^"]+)"[^>]*?>/g,
      (_match, url) => {
        const cleanUrl = url.split(/["'\s]/)[0].trim();
        return `<img class="discord-emoji" src="${cleanUrl}" crossorigin="anonymous">`;
      }
    );
    return processedContent.replace(
      /&lt;(a?):([^:]+):(\d+)&gt;/g,
      (_match, animated, name, id) => {
        try {
          const sanitizedName = name
            .replace(/<\/?[^>]+(>|$)/g, '')
            .replace(/<em>|<\/em>/g, '')
            .replace(/&lt;|&gt;|&amp;|&quot;|&#39;/g, '')
            .replace(/\*|\||~|`/g, '')
            .replace(/\s+/g, '_')
            .replace(/[^\w\d_-]/g, '');
          const isAnimated = !!animated;
          const extension = isAnimated ? 'gif' : 'png';
          const emojiUrl = `https://cdn.discordapp.com/emojis/${id}.${extension}`;
          if (isAnimated) {
            return `<span class="emoji-container"><img class="discord-emoji animated-emoji" src="${emojiUrl}" alt=":${sanitizedName}:" title=":${sanitizedName}:" data-emoji-name="${sanitizedName}" data-emoji-id="${id}" data-emoji-animated="true" crossorigin="anonymous" loading="lazy" onload="if(this.complete && this.naturalHeight > 0){this.parentNode.classList.remove('emoji-failed');const fallback=this.parentNode.querySelector('.emoji-fallback');if(fallback)fallback.remove();this.style.visibility='';this.style.display='inline-block';const next=this.nextSibling;if(next && next.nodeType===Node.TEXT_NODE && next.textContent.includes(':${sanitizedName}:')){next.remove();}}" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.style.visibility='hidden';setTimeout(()=>{this.style.visibility='';this.style.display='inline-block';if(this.parentNode.classList.contains('emoji-failed')){this.parentNode.classList.remove('emoji-failed');}},200);}else if(!this.dataset.retry2){this.dataset.retry2='1';setTimeout(()=>{this.style.visibility='';this.style.display='inline-block';if(this.parentNode.classList.contains('emoji-failed')){this.parentNode.classList.remove('emoji-failed');}},500);}else{this.style.display='none';this.parentNode.classList.add('emoji-failed');if(!this.parentNode.querySelector('.emoji-fallback')){const fallback=document.createElement('span');fallback.textContent=':${sanitizedName}:';fallback.className='emoji-fallback';this.parentNode.appendChild(fallback);}}"><span class="emoji-fallback" style="display:none">:${sanitizedName}:</span></span>`;
          } else {
            return `<img class="discord-emoji" src="${emojiUrl}" alt=":${sanitizedName}:" title=":${sanitizedName}:" data-emoji-name="${sanitizedName}" data-emoji-animated="false" crossorigin="anonymous" onload="if(this.nextSibling && this.nextSibling.nodeType===Node.TEXT_NODE && this.nextSibling.textContent.includes(':${sanitizedName}:')){this.nextSibling.remove();}" onerror="this.onerror=null;if(!this.dataset.retry){this.dataset.retry='1';this.style.visibility='hidden';setTimeout(()=>{this.style.visibility='';this.style.display='inline-block';},200);}else{this.style.display='none';let hasText=false;let next=this.nextSibling;while(next){if(next.nodeType===Node.TEXT_NODE && next.textContent.includes(':${sanitizedName}:')){hasText=true;break;}next=next.nextSibling;}if(!hasText){this.insertAdjacentText('afterend',':${sanitizedName}:');}}">`;
          }
        } catch (emojiError) {
          console.error('[TRANSCRIPT]: Error processing emoji:', emojiError);
          return _match;
        }
      }
    );
  } catch (error) {
    console.error('[TRANSCRIPT]: Error in processDiscordEmoji:', error);
    return content;
  }
}

function formatFileSize(bytes: number): string {
  if (!bytes || isNaN(bytes)) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

function getFileIcon(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'pdf': return '📕';
    case 'doc':
    case 'docx': return '📘';
    case 'xls':
    case 'xlsx': return '📗';
    case 'ppt':
    case 'pptx': return '📙';
    case 'txt':
    case 'md': return '📝';
    case 'js':
    case 'ts':
    case 'py':
    case 'java':
    case 'c':
    case 'cpp':
    case 'cs':
    case 'html':
    case 'css':
    case 'php': return '💻';
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz': return '🗜️';
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'm4a': return '🎵';
    case 'mp4':
    case 'webm':
    case 'mov':
    case 'avi': return '🎬';
    default: return '📄';
  }
}

/**
 * Custom error class for transcript operations
 */
export class TranscriptError extends Error {
  public readonly code: string;
  public readonly details?: any;
  public readonly timestamp: Date;

  constructor(code: string, message: string, details?: any, timestamp?: Date) {
    super(message);
    this.name = 'TranscriptError';
    this.code = code;
    this.details = details;
    this.timestamp = timestamp || new Date();
  }
}