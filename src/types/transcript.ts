import { Channel } from 'discord.js';

/**
 * Configuration options for transcript generation
 */
export interface TranscriptOptions {
  /** The Discord channel to generate transcript for */
  channel: Channel;
  /** Whether to include dark mode styling */
  darkMode?: boolean;
  /** Maximum number of messages to fetch */
  limit?: number;
  /** Whether to include message reactions */
  includeReactions?: boolean;
  /** Whether to include message components */
  includeComponents?: boolean;
  /** Whether to include table of contents */
  includeToc?: boolean;
  /** Custom CSS to append to the transcript */
  customCss?: string;
  /** Whether to include search functionality */
  includeSearch?: boolean;
  /** Whether to include jump navigation */
  includeJumpNav?: boolean;
  /** File name for the transcript (without extension) */
  fileName?: string;
  /** Minimum message ID to start from */
  after?: string;
  /** Maximum message ID to end at */
  before?: string;
}

/**
 * Result of transcript generation
 */
export interface TranscriptResult {
  /** The generated HTML content */
  html: string;
  /** Plain text fallback version */
  text: string;
  /** Metadata about the transcript */
  metadata: {
    /** Total number of messages included */
    messageCount: number;
    /** Date range of messages */
    dateRange: {
      start: Date;
      end: Date;
    };
    /** List of participants (user IDs) */
    participants: string[];
    /** Channel information */
    channel: {
      id: string;
      name: string;
      type: string;
    };
    /** Guild information */
    guild: {
      id: string;
      name: string;
    };
  };
  /** Generation timestamp */
  generatedAt: Date;
  /** Success status */
  success: boolean;
  /** Error message if generation failed */
  error?: string;
}

/**
 * Typed representation of a Discord message for transcript processing
 */
export interface TranscriptMessage {
  /** Message ID */
  id: string;
  /** Message content */
  content: string;
  /** Message author */
  author: {
    id: string;
    username: string;
    discriminator?: string;
    avatar?: string;
    bot?: boolean;
  };
  /** Message timestamp */
  timestamp: Date;
  /** Message embeds */
  embeds: TranscriptEmbed[];
  /** Message attachments */
  attachments: TranscriptAttachment[];
  /** Message reactions */
  reactions: TranscriptReaction[];
  /** Message components */
  components: TranscriptComponent[];
  /** Whether the message was edited */
  edited?: boolean;
  /** Edit timestamp */
  editedTimestamp?: Date;
  /** Whether the message mentions everyone */
  mentionEveryone?: boolean;
  /** User mentions in the message */
  mentions: {
    users: string[];
    roles: string[];
    channels: string[];
  };
  /** Reference to replied message */
  referencedMessage?: string;
  /** Message type */
  type: number;
  /** Message flags */
  flags?: number;
}

/**
 * Typed representation of a Discord embed for HTML rendering
 */
export interface TranscriptEmbed {
  /** Embed title */
  title?: string;
  /** Embed type */
  type?: string;
  /** Embed description */
  description?: string;
  /** Embed URL */
  url?: string;
  /** Embed timestamp */
  timestamp?: Date;
  /** Embed color */
  color?: number;
  /** Embed footer */
  footer?: {
    text: string;
    iconURL?: string;
  };
  /** Embed image */
  image?: {
    url: string;
    proxyURL?: string;
    height?: number;
    width?: number;
  };
  /** Embed thumbnail */
  thumbnail?: {
    url: string;
    proxyURL?: string;
    height?: number;
    width?: number;
  };
  /** Embed author */
  author?: {
    name: string;
    url?: string;
    iconURL?: string;
  };
  /** Embed fields */
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  /** Embed provider */
  provider?: {
    name: string;
    url?: string;
  };
  /** Embed video */
  video?: {
    url: string;
    proxyURL?: string;
    height?: number;
    width?: number;
  };
}

/**
 * Typed representation of a file attachment
 */
export interface TranscriptAttachment {
  /** Attachment ID */
  id: string;
  /** Attachment filename */
  name: string;
  /** Attachment size in bytes */
  size: number;
  /** Attachment URL */
  url: string;
  /** Proxy URL */
  proxyURL?: string;
  /** Content type */
  contentType?: string;
  /** Image height (if image) */
  height?: number;
  /** Image width (if image) */
  width?: number;
  /** Whether this is an image */
  isImage: boolean;
  /** Whether this is a video */
  isVideo: boolean;
  /** Whether this is an audio file */
  isAudio: boolean;
}

/**
 * Typed representation of message reactions
 */
export interface TranscriptReaction {
  /** Reaction emoji */
  emoji: {
    id?: string;
    name: string;
    animated?: boolean;
  };
  /** Number of users who reacted */
  count: number;
  /** Whether the current user reacted */
  me: boolean;
}

/**
 * Typed representation of message components
 */
export interface TranscriptComponent {
  /** Component type */
  type: number;
  /** Component style (for buttons) */
  style?: number;
  /** Component label */
  label?: string;
  /** Component emoji */
  emoji?: {
    id?: string;
    name: string;
    animated?: boolean;
  };
  /** Component URL (for links) */
  url?: string;
  /** Component custom ID */
  customId?: string;
  /** Whether component is disabled */
  disabled?: boolean;
  /** Component options (for select menus) */
  options?: Array<{
    label: string;
    value: string;
    description?: string;
    emoji?: {
      id?: string;
      name: string;
      animated?: boolean;
    };
    default?: boolean;
  }>;
  /** Component placeholder (for select menus) */
  placeholder?: string;
  /** Minimum values (for select menus) */
  minValues?: number;
  /** Maximum values (for select menus) */
  maxValues?: number;
}

/**
 * Error types for transcript generation failures
 */
export interface TranscriptError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Additional error details */
  details?: any;
  /** Timestamp of error */
  timestamp: Date;
}

/**
 * Cache for user and channel information
 */
export interface TranscriptCache {
  /** User information cache */
  users: Map<string, {
    id: string;
    username: string;
    discriminator?: string;
    avatar?: string;
    bot?: boolean;
  }>;
  /** Channel information cache */
  channels: Map<string, {
    id: string;
    name: string;
    type: string;
  }>;
  /** Role information cache */
  roles: Map<string, {
    id: string;
    name: string;
    color?: number;
  }>;
}

/**
 * HTML generation options
 */
export interface HtmlGenerationOptions {
  /** Whether to include dark mode styles */
  darkMode: boolean;
  /** Whether to include search functionality */
  includeSearch: boolean;
  /** Whether to include jump navigation */
  includeJumpNav: boolean;
  /** Custom CSS to append */
  customCss?: string;
  /** Channel information for header */
  channelInfo: {
    id: string;
    name: string;
    type: string;
  };
  /** Guild information for header */
  guildInfo: {
    id: string;
    name: string;
    iconURL?: string;
  };
  /** Generation timestamp */
  generatedAt: Date;
}