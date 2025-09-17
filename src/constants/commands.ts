/**
 * Constants for Discord bot commands and messages.
 */

export const EMBED_COLORS = {
  PRIMARY: 0x5865F2,
  SUPPORT: 0x00D166,
  WARNING: 0xFEE75C,
  ERROR: 0xED4245,
  INFO: 0x5865F2,
  SUCCESS: 0x57F287
};

export const STATUS_EMOJIS = {
  online: '🟢',
  idle: '🟡', 
  dnd: '🔴',
  offline: '⚫'
};

export const SUPPORT_MESSAGES = {
  TITLE: '🎫 Support Ticket System',
  DESCRIPTION: 'Click the button below to create a support ticket. Our staff will assist you as soon as possible.',
  WELCOME_MESSAGE: 'Welcome! Please describe your issue and our staff will help you.',
  FOOTER_TEXT: 'Xploits Support System',
  HEADER_TEXT: {
    WITH_PRESENCE: (onlineCount: number, totalCount: number) => 
      `**Staff Online:** ${onlineCount}/${totalCount} staff members available`,
    WITHOUT_PRESENCE: (totalCount: number) => 
      `**Staff Available:** ${totalCount} staff members`
  }
};

export const ERROR_MESSAGES = {
  UNKNOWN_COMMAND: '❌ Unknown command.',
  GUILD_ONLY: '❌ This command can only be used in a server.',
  MISSING_PERMISSIONS: '❌ You do not have permission to use this command.',
  INVALID_CHANNEL: '❌ Please specify a valid text channel.',
  STAFF_NOT_FOUND: '❌ User is not a staff member.',
  TICKET_NOT_FOUND: '❌ Ticket not found.',
  ALREADY_STAFF: '❌ User is already a staff member.',
  NOT_STAFF: '❌ User is not a staff member.',
  NO_STAFF_CONFIGURED: '❌ No staff members have been configured for this server.'
};

export const SUCCESS_MESSAGES = {
  STAFF_ADDED: (username: string) => `✅ ${username} has been added as a staff member.`,
  STAFF_REMOVED: (username: string) => `✅ ${username} has been removed from staff.`,
  SUPPORT_SETUP: (channel: string, category?: string) => 
    `✅ Support system has been set up in ${channel}${category ? ` with category: ${category}` : ''}.`,
  PRESENCE_ENABLED: '✅ Presence tracking has been enabled.',
  PRESENCE_DISABLED: '✅ Presence tracking has been disabled.',
  TICKET_CREATED: 'Your support ticket has been created.',
  TICKET_CLOSED: 'Support ticket has been closed.',
  TICKET_CLAIMED: 'Ticket has been claimed.',
  TICKET_UNCLAIMED: 'Ticket has been unclaimed.'
};

export const VALID_PRESENCE_STATUSES = ['online', 'idle', 'dnd', 'offline'] as const;

export type ValidPresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';

export const DEFAULT_CATEGORIES = {
  TICKETS: undefined as string | undefined,
  ARCHIVED: undefined as string | undefined
};