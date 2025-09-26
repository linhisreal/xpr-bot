import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Client, EmbedBuilder } from 'discord.js';
import { getTicketKeyFromIds, getTicketKeyFromTicket } from '../modules/ticketKey.js';
import { generateTranscript, TranscriptOptions, TranscriptResult } from '../utils/transcriptGenerator.js';
import { sendTicketSummary, TicketSendResult } from '../utils/transcriptSender.js';

/**
 * Interface for ticket summary data
 */
export interface TicketSummary {
  embed: EmbedBuilder;
  ticketData: Ticket;
  duration: string;
  staffHandler: string;
  /** Optional transcript result for enhanced DM sending */
  transcriptResult?: TranscriptResult;
}

/**
 * Presence status types from Discord.js
 */
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';

/**
 * Interface for tracking staff member presence.
 */
export interface StaffPresence {
  userId: string;
  status: PresenceStatus;
  lastSeen: Date;
  lastUpdated: Date;
}

/**
 * Interface for queued ticket notifications when staff are offline
 */
export interface QueuedTicketNotification {
  ticketId: string;
  guildId: string;
  channelId: string;
  userId: string;
  description: string;
  createdAt: Date;
  priority: 'normal' | 'high' | 'urgent';
}

/**
 * Interface for smart ping configuration.
 */
export interface SmartPingConfig {
  enabled: boolean;
  idleDelayMinutes: number; 
  dndMentionOnly: boolean; 
  offlineQueueing: boolean; 
}

/**
 * Interface representing a ticket.
 */
export interface Ticket {
  readonly guildId: string;
  readonly userId: string;
  readonly channelId: string; 
  readonly threadId?: string; 
  readonly ticketNumber: number;
  readonly createdAt: Date;
  description?: string;
  claimedBy?: string;
  isLocked: boolean;
  channelName: string;
  isThread: boolean; 
  notes?: string; 
  escalationLevel?: number; 
  whitelistedUsers?: string[]; 
}

/**
 * Interface for guild configuration.
 */
export interface GuildConfig {
  supportChannelId?: string;
  presenceTracking?: {
    enabled: boolean;
    smartPing: SmartPingConfig;
    showInEmbeds: boolean;
  };
}

/**
 * Interface for staff management per guild.
 */
export interface GuildStaff {
  staffMembers: Set<string>;
  presences: Map<string, StaffPresence>;
  offlineQueue: QueuedTicketNotification[];
}

/**
 * Interface for encrypted guild data storage.
 */
interface EncryptedGuildData {
  encryptedStaff: EncryptedStaffData;
  config: GuildConfig;
}

/**
 * Interface for encrypted staff data storage.
 */
interface EncryptedStaffData {
  encryptedData: string;
  iv: string;
  authTag?: string;
}

/**
 * Interface for staff file structure.
 */
interface StaffFile {
  guilds: Record<string, EncryptedGuildData>;
}

/**
 * Interface for encrypted ticket data storage.
 */
interface EncryptedTicketData {
  encryptedData: string;
  iv: string;
  authTag?: string;
}

/**
 * Interface for ticket file structure.
 */
interface TicketFile {
  guilds: Record<string, {
    encryptedTickets: EncryptedTicketData;
    ticketCounter: number;
  }>;
}

/**
 * Manages ticket data and operations.
 */
export class TicketManager {
  public readonly ready: Promise<void>;
  private readonly tickets: Map<string, Map<string, Ticket>> = new Map();
  private readonly ticketCounters: Map<string, number> = new Map();
  private readonly guildStaff: Map<string, GuildStaff> = new Map();
  private readonly guildConfigs: Map<string, GuildConfig> = new Map();
  private ticketSaveTimer: NodeJS.Timeout | null = null;
  private readonly staffFilePath: string;
  private readonly ticketsFilePath: string;
  private readonly encryptionKey: Buffer;
  private readonly client?: Client;


  /**
   * Ensure guild maps exist for a guildId.
   */
  private ensureGuildState(guildId: string): void {
    if (!this.tickets.has(guildId)) this.tickets.set(guildId, new Map());
    if (!this.guildStaff.has(guildId)) this.guildStaff.set(guildId, { staffMembers: new Set(), presences: new Map(), offlineQueue: [] });
    if (!this.guildConfigs.has(guildId)) this.guildConfigs.set(guildId, {});
    if (!this.ticketCounters.has(guildId)) this.ticketCounters.set(guildId, 0);
  }

  /**
   * Debounced save for ticket data to avoid excessive disk I/O.
   */
  private scheduleSaveTicketData(delayMs = 200): void {
    if (this.ticketSaveTimer) clearTimeout(this.ticketSaveTimer);
    this.ticketSaveTimer = setTimeout(() => {
      this.saveTicketData().catch(err => console.error('Failed to save ticket data (scheduled):', err));
      this.ticketSaveTimer = null;
    }, delayMs);
  }

  /**
   * Atomically increment and persist ticket counter for a guild.
   */
  private incrementAndScheduleTicketCounter(guildId: string): number {
    this.ensureGuildState(guildId);
    const current = this.ticketCounters.get(guildId) || 0;
    const next = current + 1;
    this.ticketCounters.set(guildId, next);
    this.scheduleSaveTicketData();
    return next;
  }

  constructor(client?: Client, testFilePath?: string) {
    this.client = client;
    this.staffFilePath = testFilePath || path.join(process.cwd(), 'data', 'staff.json');
    this.ticketsFilePath = testFilePath ? 
      testFilePath.replace('staff.json', 'tickets.json') : 
      path.join(process.cwd(), 'data', 'tickets.json');
    
    const keyString = process.env.STAFF_ENCRYPTION_KEY;
    if (keyString) {
      try {
        
        const keyBuffer = Buffer.from(keyString, 'hex');
        if (keyBuffer.length === 32) {
          
          this.encryptionKey = keyBuffer;
        } else {
          if (process.env.DEBUG_STAFF_KEY === '1') {
            console.warn('STAFF_ENCRYPTION_KEY has invalid hex length. Deriving 32-byte key from provided string.');
          }
          const salt = process.env.STAFF_ENCRYPTION_SALT || 'xploits-salt';
          this.encryptionKey = crypto.scryptSync(keyString, salt, 32);
        }
      } catch (error) {
        
        if (process.env.DEBUG_STAFF_KEY === '1') {
          console.warn('STAFF_ENCRYPTION_KEY is not valid hex. Deriving 32-byte key from provided string.');
        }
        const salt = process.env.STAFF_ENCRYPTION_SALT || 'xploits-salt';
        this.encryptionKey = crypto.scryptSync(keyString, salt, 32);
      }
    } else {
      const generated = crypto.randomBytes(32);
      this.encryptionKey = generated;
      if (process.env.DEBUG_STAFF_KEY === '1') {
        console.log('STAFF_ENCRYPTION_KEY not found in environment. Generated a random key (DEBUG enabled). Key length:', this.encryptionKey.length, 'bytes');
      } else {
        console.log('STAFF_ENCRYPTION_KEY not found in environment. Generating a random key. Set STAFF_ENCRYPTION_KEY to persist staff data across restarts.');
      }
    }
    
    if (this.encryptionKey.length !== 32) {
      throw new Error(`Invalid encryption key length: ${this.encryptionKey.length}. Expected 32 bytes for AES-256.`);
    }
    this.ready = (async () => {
      try {
        await this.loadStaffData();
      } catch (error) {
        console.error('Failed to load staff data:', error);
      }
      try {
        await this.loadTicketData();
      } catch (error) {
        console.error('Failed to load ticket data:', error);
      }
    })();
  }

  /**
   * Encrypts staff data using AES-256-CBC.
   */
  private encryptStaffData(staffMembers: string[]): EncryptedStaffData {
    try {
      if (this.encryptionKey.length !== 32) {
        throw new Error(`Encryption key has invalid length: ${this.encryptionKey.length} bytes. AES-256 requires 32 bytes.`);
      }

      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
      const data = JSON.stringify(staffMembers);
      const encryptedBuffer = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const combined = Buffer.concat([encryptedBuffer, authTag]);
      return {
        encryptedData: combined.toString('hex'),
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      console.error('Encryption error details:', {
        keyLength: this.encryptionKey.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Test helper: expose encrypted payload generation for tests without accessing private members.
   * This is intentionally small-surface and only returns primitive-friendly data.
   */
  public encryptStaffDataForTest(staffMembers: string[]): { encryptedData: string; iv: string; authTag?: string } {
    const enc = this.encryptStaffData(staffMembers);
    return { encryptedData: enc.encryptedData, iv: enc.iv, authTag: enc.authTag };
  }

  /**
   * Decrypts staff data using AES-256-CBC.
   */
  private decryptStaffData(encryptedData: EncryptedStaffData): string[] {
    try {
      const iv = Buffer.from(encryptedData.iv, 'hex');

      const combined = Buffer.from(encryptedData.encryptedData, 'hex');

      if (process.env.DEBUG_STAFF_KEY === '1') {
        console.log('decryptStaffData debug:', {
          ivLength: iv.length,
          combinedLength: combined.length,
          hasAuthTagField: !!encryptedData.authTag,
          combinedHex: combined.toString('hex'),
          ivHex: encryptedData.iv
        });
      }

      let cipherText: Buffer;
      let authTagBuf: Buffer | undefined;

      if (encryptedData.authTag) {
        const providedTag = Buffer.from(encryptedData.authTag, 'hex');
        authTagBuf = providedTag;
        if (combined.length > 16) {
          cipherText = combined.slice(0, combined.length - 16);
        } else {
          cipherText = combined;
        }
      } else if (combined.length > 16) {
        authTagBuf = combined.slice(combined.length - 16);
        cipherText = combined.slice(0, combined.length - 16);
      } else {
        cipherText = combined;
        authTagBuf = undefined;
      }

      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
        if (authTagBuf) {
          decipher.setAuthTag(authTagBuf);
        }
        const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
        if (process.env.DEBUG_STAFF_KEY === '1') console.log('GCM decrypted (staff):', decrypted);
        try {
          return JSON.parse(decrypted);
        } catch (parseErr) {
          if (process.env.DEBUG_STAFF_KEY === '1') console.warn('Failed to JSON.parse GCM-decrypted staff payload:', { decrypted, parseErr });
          throw parseErr;
        }
      } catch (gcmErr) {
        try {
          const cbcIv = iv.length === 16 ? iv : Buffer.from(encryptedData.iv, 'hex').slice(0, 16);
          const decipherCbc = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, cbcIv);
          const decryptedCbc = Buffer.concat([decipherCbc.update(combined), decipherCbc.final()]).toString('utf8');
          if (process.env.DEBUG_STAFF_KEY === '1') console.log('CBC decrypted (staff):', decryptedCbc);
          const parsed = JSON.parse(decryptedCbc);

          try {
            const migrated = this.encryptStaffData(parsed);
            (async () => {
              try {
                await this.ensureDataDirectory();
                const fileContent = await fs.readFile(this.staffFilePath, 'utf8');
                const staffFile: StaffFile = fileContent.trim() ? JSON.parse(fileContent) : { guilds: {} };
                for (const gData of Object.values(staffFile.guilds)) {
                  const maybe = gData as any;
                  if (maybe.encryptedStaff && maybe.encryptedStaff.encryptedData === encryptedData.encryptedData) {
                    maybe.encryptedStaff = migrated;
                  }
                }
                await this.backupFile(this.staffFilePath);
                await fs.writeFile(this.staffFilePath, JSON.stringify(staffFile, null, 2), 'utf8');
                if (!process.env.JEST_WORKER_ID) console.log('Migrated staff data from CBC->GCM for one or more guilds');
              } catch (writeErr) {
                if (process.env.DEBUG_STAFF_KEY === '1') console.warn('Failed to persist migrated staff data:', writeErr);
              }
            })();
          } catch (migrateErr) {
            if (process.env.DEBUG_STAFF_KEY === '1') console.warn('Failed to migrate staff data to GCM format:', migrateErr);
          }

          return parsed;
        } catch (cbcErr) {
          if (process.env.DEBUG_STAFF_KEY === '1') console.warn('Staff data decryption failed for both GCM and CBC:', { gcmErr, cbcErr });
          return [];
        }
      }
    } catch (error) {
      console.error('Failed to decrypt staff data:', error);
      return [];
    }
  }

  /**
   * Ensures the data directory exists.
   */
  private async ensureDataDirectory(): Promise<void> {
    const dataDir = path.dirname(this.staffFilePath);
    try {
      await fs.access(dataDir);
    } catch {
      await fs.mkdir(dataDir, { recursive: true });
    }
  }

  /**
   * Create a simple .bak copy of a file (best-effort). Overwrites existing .bak.
   */
  private async backupFile(filePath: string): Promise<void> {
    try {
      await fs.copyFile(filePath, filePath + '.bak');
      if (!process.env.JEST_WORKER_ID && process.env.DEBUG_STAFF_KEY !== '1') {
        console.log(`Created backup of ${path.basename(filePath)} -> ${path.basename(filePath)}.bak`);
      } else if (process.env.DEBUG_STAFF_KEY === '1') {
        console.log(`Backup created for ${filePath} -> ${filePath}.bak`);
      }
    } catch (err) {
      if (process.env.DEBUG_STAFF_KEY === '1') console.warn('Failed to create backup file:', { filePath, err });
    }
  }

  /**
   * Loads staff data from encrypted file.
   */
  private async loadStaffData(): Promise<void> {
    try {
      await this.ensureDataDirectory();
      const fileContent = await fs.readFile(this.staffFilePath, 'utf8');
      
      if (!fileContent.trim()) {
        console.log('Staff file is empty, starting with empty staff data');
        return;
      }
      
      const staffFile: StaffFile = JSON.parse(fileContent);
      
      
      this.guildStaff.clear();
      this.guildConfigs.clear();

      let migrated = false;

      for (const [guildId, guildData] of Object.entries(staffFile.guilds)) {
        if ('encryptedData' in guildData) {
          const staffMembers = this.decryptStaffData(guildData as unknown as EncryptedStaffData);
          if (process.env.DEBUG_STAFF_KEY === '1') console.log(`Loaded staffMembers for guild ${guildId}:`, staffMembers);
          this.guildStaff.set(guildId, {
            staffMembers: new Set(staffMembers),
            presences: new Map(),
            offlineQueue: []
          });
          this.guildConfigs.set(guildId, {});
        } else {
          const staffMembers = this.decryptStaffData(guildData.encryptedStaff);
          if (process.env.DEBUG_STAFF_KEY === '1') console.log(`Loaded staffMembers for guild ${guildId}:`, staffMembers);
          this.guildStaff.set(guildId, {
            staffMembers: new Set(staffMembers),
            presences: new Map(),
            offlineQueue: []
          });
          this.guildConfigs.set(guildId, guildData.config || {});

          try {
            const enc = (guildData as any).encryptedStaff;
            if (enc && !enc.authTag) {
              const migratedEnc = this.encryptStaffData(Array.from((this.guildStaff.get(guildId)!.staffMembers)));
              staffFile.guilds[guildId].encryptedStaff = migratedEnc as any;
              migrated = true;
            }
          } catch (migrateErr) {
            if (process.env.DEBUG_STAFF_KEY === '1') console.warn('Failed to migrate staff guild to GCM during load:', migrateErr);
          }
        }
      }

      if (migrated) {
        try {
          await this.backupFile(this.staffFilePath);
          await fs.writeFile(this.staffFilePath, JSON.stringify(staffFile, null, 2), 'utf8');
          if (!process.env.JEST_WORKER_ID) console.log('Persisted migrated staff data to GCM format');
        } catch (writeErr) {
          if (process.env.DEBUG_STAFF_KEY === '1') console.warn('Failed to persist migrated staff data during load:', writeErr);
        }
      }

      console.log('Staff data loaded successfully');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('Staff file does not exist, starting with empty staff data');
      } else if (error instanceof SyntaxError) {
        console.warn('Staff file contains invalid JSON, resetting to empty staff data');
        this.guildStaff.clear();
        this.guildConfigs.clear();
        await this.saveStaffData().catch(() => {});
      } else {
        console.error('Failed to load staff data:', error);
      }
    }
  }

  /**
   * Saves staff data to encrypted file.
   */
  private async saveStaffData(): Promise<void> {
    try {
      await this.ensureDataDirectory();
      
      const staffFile: StaffFile = {
        guilds: {}
      };
      
      for (const [guildId, guildStaff] of this.guildStaff.entries()) {
        const staffMembers = Array.from(guildStaff.staffMembers);
        const config = this.guildConfigs.get(guildId) || {};
        
        staffFile.guilds[guildId] = {
          encryptedStaff: this.encryptStaffData(staffMembers),
          config: config
        };
      }
      
      const dir = path.dirname(this.staffFilePath);
      await fs.mkdir(dir, { recursive: true });
      
      const fileContent = JSON.stringify(staffFile, null, 2);
      
      try {
        await fs.writeFile(this.staffFilePath, fileContent, 'utf8');
        if (!process.env.JEST_WORKER_ID) console.log('Staff data saved successfully');
      } catch (writeError) {
        console.error('Failed to write staff data:', writeError);
        throw writeError;
      }
    } catch (error) {
      console.error('Failed to save staff data:', error);
      throw error;
    }
  }

  /**
   * Encrypts ticket data using AES-256-CBC.
   */
  private encryptTicketData(tickets: Record<string, Ticket>): EncryptedTicketData {
    try {
      if (this.encryptionKey.length !== 32) {
        throw new Error(`Encryption key has invalid length: ${this.encryptionKey.length} bytes. AES-256 requires 32 bytes.`);
      }

      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
      const data = JSON.stringify(tickets);
      const encryptedBuffer = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const combined = Buffer.concat([encryptedBuffer, authTag]);
      return {
        encryptedData: combined.toString('hex'),
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      console.error('Ticket encryption error details:', {
        keyLength: this.encryptionKey.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Decrypts ticket data using AES-256-CBC.
   */
  private decryptTicketData(encryptedData: EncryptedTicketData): Record<string, Ticket> {
    try {
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const combined = Buffer.from(encryptedData.encryptedData, 'hex');

      let cipherText: Buffer;
      let authTagBuf: Buffer | undefined;

      if (encryptedData.authTag) {
        const providedTag = Buffer.from(encryptedData.authTag, 'hex');
        authTagBuf = providedTag;
        if (combined.length > 16) {
          cipherText = combined.slice(0, combined.length - 16);
        } else {
          cipherText = combined;
        }
      } else if (combined.length > 16) {
        authTagBuf = combined.slice(combined.length - 16);
        cipherText = combined.slice(0, combined.length - 16);
      } else {
        cipherText = combined;
        authTagBuf = undefined;
      }

      let parsedData: Record<string, Ticket>;
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
        if (authTagBuf) decipher.setAuthTag(authTagBuf);
        const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
        parsedData = JSON.parse(decrypted);
      } catch (gcmErr) {
        try {
          const cbcIv = iv.length === 16 ? iv : Buffer.from(encryptedData.iv, 'hex').slice(0, 16);
          const decipherCbc = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, cbcIv);
          const decryptedCbc = Buffer.concat([decipherCbc.update(combined), decipherCbc.final()]).toString('utf8');
          parsedData = JSON.parse(decryptedCbc);

          (async () => {
            try {
              await this.ensureDataDirectory();
              const fileContent = await fs.readFile(this.ticketsFilePath, 'utf8');
              const ticketFile: TicketFile = fileContent.trim() ? JSON.parse(fileContent) : { guilds: {} };
              for (const gData of Object.values(ticketFile.guilds)) {
                const maybe = gData as any;
                if (maybe.encryptedTickets && maybe.encryptedTickets.encryptedData === encryptedData.encryptedData) {
                  maybe.encryptedTickets = this.encryptTicketData(parsedData);
                }
              }
              await this.backupFile(this.ticketsFilePath);
              await fs.writeFile(this.ticketsFilePath, JSON.stringify(ticketFile, null, 2), 'utf8');
              if (!process.env.JEST_WORKER_ID) console.log('Migrated ticket data from CBC->GCM for one or more guilds');
            } catch (writeErr) {
              if (process.env.DEBUG_STAFF_KEY === '1') console.warn('Failed to persist migrated ticket data:', writeErr);
            }
          })();
        } catch (cbcErr) {
          console.error('Ticket decryption error:', {
            error: (cbcErr as Error).message || cbcErr,
          });
          throw cbcErr;
        }
      }
      
      for (const ticket of Object.values(parsedData) as Ticket[]) {
        (ticket as any).createdAt = new Date(ticket.createdAt);
        
        if (ticket.isThread) {
          if (!ticket.threadId) {
            console.warn(`Thread ticket missing threadId during decryption:`, {
              ticketNumber: ticket.ticketNumber,
              channelId: ticket.channelId,
              userId: ticket.userId
            });
            if (ticket.channelId && ticket.channelId.match(/^\d+$/)) {
              (ticket as any).threadId = ticket.channelId;
              console.log(`Auto-fixed thread ticket threadId: ${ticket.channelId}`);
            }
          }
          
          if (ticket.threadId && !ticket.isThread) {
            console.log(`Auto-fixing isThread flag for ticket with threadId: ${ticket.threadId}`);
            ticket.isThread = true;
          }
        }
      }
      
      return parsedData;
    } catch (error) {
      console.error('Ticket decryption error:', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Loads ticket data from encrypted file.
   */
  private async loadTicketData(): Promise<void> {
    try {
      await this.ensureDataDirectory();
      const fileContent = await fs.readFile(this.ticketsFilePath, 'utf8');
      
      if (!fileContent.trim()) {
        console.log('Ticket file is empty, starting with empty ticket data');
        return;
      }
      
      const ticketFile: TicketFile = JSON.parse(fileContent);
      
      this.tickets.clear();
      this.ticketCounters.clear();

      let migrated = false;
      let threadTicketsRecovered = 0;
      let totalTicketsRecovered = 0;
      
      for (const [guildId, guildData] of Object.entries(ticketFile.guilds)) {
        const decryptedTickets = this.decryptTicketData(guildData.encryptedTickets);
        const guildTickets = new Map<string, Ticket>();
        let guildThreadTickets = 0;

        for (const [ticketId, ticket] of Object.entries(decryptedTickets)) {
          if (ticket.isThread) {
            guildThreadTickets++;
            
            if (!ticket.threadId) {
              console.log(`Recovering thread ticket threadId from key: ${ticketId}`);
              (ticket as any).threadId = ticketId;
              migrated = true;
            }
            
            const expectedKey = ticket.threadId!;
            if (ticketId !== expectedKey) {
              console.warn(`Thread ticket key mismatch during load: stored as ${ticketId}, expected ${expectedKey}`);
              guildTickets.set(expectedKey, ticket);
              migrated = true;
              continue;
            }
          }
          
          guildTickets.set(ticketId, ticket);
          totalTicketsRecovered++;
        }
        
        threadTicketsRecovered += guildThreadTickets;
        console.log(`Guild ${guildId}: Recovered ${Object.keys(decryptedTickets).length} tickets (${guildThreadTickets} thread tickets)`);

        this.tickets.set(guildId, guildTickets);
        this.ticketCounters.set(guildId, guildData.ticketCounter);

        try {
          const enc = (guildData as any).encryptedTickets;
          if (enc && !enc.authTag) {
            (ticketFile.guilds[guildId] as any).encryptedTickets = this.encryptTicketData(decryptedTickets) as any;
            migrated = true;
          }
        } catch (migrateErr) {
          if (process.env.DEBUG_STAFF_KEY === '1') console.warn('Failed to migrate tickets guild to GCM during load:', migrateErr);
        }
      }

      if (migrated) {
        try {
          await this.backupFile(this.ticketsFilePath);
          await fs.writeFile(this.ticketsFilePath, JSON.stringify(ticketFile, null, 2), 'utf8');
          if (!process.env.JEST_WORKER_ID) {
            console.log('Persisted migrated ticket data to GCM format');
            console.log(`Migration completed: ${totalTicketsRecovered} tickets (${threadTicketsRecovered} thread tickets)`);
          }
        } catch (writeErr) {
          if (process.env.DEBUG_STAFF_KEY === '1') console.warn('Failed to persist migrated ticket data during load:', writeErr);
        }
      }

      console.log('Ticket data loaded successfully');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('Ticket file does not exist, starting with empty ticket data');
      } else if (error instanceof SyntaxError) {
        console.warn('Ticket file contains invalid JSON, resetting to empty ticket data');
        this.tickets.clear();
        this.ticketCounters.clear();
        await this.saveTicketData().catch(() => {});
      } else {
        console.error('Failed to load ticket data:', error);
      }
    }
  }

  /**
   * Saves ticket data to encrypted file.
   */
  private async saveTicketData(): Promise<void> {
    try {
      await this.ensureDataDirectory();
      
      const ticketFile: TicketFile = {
        guilds: {}
      };
      
      for (const [guildId, guildTickets] of this.tickets.entries()) {
        const ticketsObject: Record<string, Ticket> = {};
        for (const [ticketId, ticket] of guildTickets.entries()) {
          ticketsObject[ticketId] = ticket;
        }
        
        const ticketCounter = this.ticketCounters.get(guildId) || 0;
        
        ticketFile.guilds[guildId] = {
          encryptedTickets: this.encryptTicketData(ticketsObject),
          ticketCounter: ticketCounter
        };
      }
      
      const dir = path.dirname(this.ticketsFilePath);
      await fs.mkdir(dir, { recursive: true });
      
      const fileContent = JSON.stringify(ticketFile, null, 2);
      
      try {
        await fs.writeFile(this.ticketsFilePath, fileContent, 'utf8');
        if (!process.env.JEST_WORKER_ID) console.log('Ticket data saved successfully');
      } catch (writeError) {
        console.error('Failed to write ticket data:', writeError);
        throw writeError;
      }
    } catch (error) {
      console.error('Failed to save ticket data:', error);
      throw error;
    }
  }

  /**
   * Creates a new ticket.
   */
  createTicket(
    guildId: string,
    userId: string,
    channelId: string,
    ticketNumber: number,
    channelName: string,
    description?: string,
    threadId?: string
  ): Ticket {
    const validatedDescription = description && description.trim() 
      ? description.trim() 
      : undefined;

    const ticket: Ticket = {
      guildId,
      userId,
      channelId,
      threadId,
      ticketNumber,
      createdAt: new Date(),
      description: validatedDescription,
      isLocked: false,
      channelName,
      isThread: !!threadId,
    };

    this.ensureGuildState(guildId);
    const ticketKey = getTicketKeyFromIds(channelId, threadId);
    
    if (threadId && ticketKey !== threadId) {
      console.error(`Thread ticket key generation error: expected ${threadId}, got ${ticketKey}`);
    }
    
    const existingTicket = this.tickets.get(guildId)!.get(ticketKey);
    if (existingTicket) {
      console.warn(`Ticket key collision detected: ${ticketKey}`, {
        existing: {
          userId: existingTicket.userId,
          isThread: existingTicket.isThread,
          threadId: existingTicket.threadId,
          channelId: existingTicket.channelId
        },
        new: {
          userId: ticket.userId,
          isThread: ticket.isThread,
          threadId: ticket.threadId,
          channelId: ticket.channelId
        }
      });
    }
    
    if (threadId) {
      console.log(`Creating thread ticket:`, {
        guildId,
        userId,
        ticketNumber,
        channelId,
        threadId,
        ticketKey,
        description: validatedDescription?.substring(0, 50) + '...'
      });
    }
    
    this.tickets.get(guildId)!.set(ticketKey, ticket);
    this.scheduleSaveTicketData();
    
    return ticket;
  }

  /**
   * Helper method to retrieve ticket description for display purposes
   */
  getTicketDescription(guildId: string, id: string): string | null {
    const ticket = this.getTicket(guildId, id);
    if (!ticket) {
      return null;
    }
    
    return ticket.description || null;
  }

  /**
   * Sets the support channel for a guild.
   */
  async setSupportChannel(guildId: string, channelId: string): Promise<void> {
    this.ensureGuildState(guildId);
    const config = this.guildConfigs.get(guildId)!;
    config.supportChannelId = channelId;
    
    
    if (!this.guildStaff.has(guildId)) {
      this.guildStaff.set(guildId, { 
        staffMembers: new Set(),
        presences: new Map(),
        offlineQueue: []
      });
    }
    
    try {
      await this.saveStaffData();
      console.log(`Support channel set to ${channelId} for guild ${guildId}`);
    } catch (error) {
      
      if (config.supportChannelId === channelId) {
        delete config.supportChannelId;
      }
      throw error;
    }
  }

  /**
   * Gets the support channel for a guild.
   */
  getSupportChannel(guildId: string): string | undefined {
    return this.guildConfigs.get(guildId)?.supportChannelId;
  }

  /**
   * Removes the support channel for a guild.
   */
  async removeSupportChannel(guildId: string): Promise<boolean> {
    const config = this.guildConfigs.get(guildId);
    if (!config || !config.supportChannelId) {
      return false;
    }
    
    const oldChannelId = config.supportChannelId;
    delete config.supportChannelId;
    
    try {
      await this.saveStaffData();
      console.log(`Support channel removed for guild ${guildId}`);
      return true;
    } catch (error) {
      
      config.supportChannelId = oldChannelId;
      throw error;
    }
  }
  async addStaff(guildId: string, userId: string): Promise<boolean> {
    this.ensureGuildState(guildId);
    const staff = this.guildStaff.get(guildId)!;
    const wasAdded = !staff.staffMembers.has(userId);
    staff.staffMembers.add(userId);
    
    if (wasAdded) {
      try {
        await this.saveStaffData();
        console.log(`Staff member ${userId} added to guild ${guildId}`);
      } catch (error) {
        
        staff.staffMembers.delete(userId);
        throw error;
      }
    }
    
    return wasAdded;
  }

  /**
   * Removes a staff member from a guild.
   */
  async removeStaff(guildId: string, userId: string): Promise<boolean> {
    const staff = this.guildStaff.get(guildId);
    if (!staff) return false;
    const wasRemoved = staff.staffMembers.delete(userId);
    
    if (wasRemoved) {
      try {
        await this.saveStaffData();
        console.log(`Staff member ${userId} removed from guild ${guildId}`);
      } catch (error) {
        
        staff.staffMembers.add(userId);
        throw error;
      }
    }
    
    return wasRemoved;
  }

  /**
   * Gets all staff members for a guild.
   */
  getStaffList(guildId: string): string[] {
    const staff = this.guildStaff.get(guildId);
    return staff ? Array.from(staff.staffMembers) : [];
  }

  /**
   * Checks if a user is staff in a guild.
   */
  isStaff(guildId: string, userId: string): boolean {
    const staff = this.guildStaff.get(guildId);
    return staff ? staff.staffMembers.has(userId) : false;
  }

  /**
   * Claims a ticket for a staff member.
   */
  claimTicket(guildId: string, id: string, staffId: string): boolean {
    const ticket = this.getTicket(guildId, id);
    if (!ticket || ticket.claimedBy) return false;
    
    
    const updatedTicket: Ticket = {
      ...ticket,
      claimedBy: staffId,
    };
    
  const ticketKey = getTicketKeyFromTicket(ticket);
    this.tickets.get(guildId)!.set(ticketKey, updatedTicket);
    this.scheduleSaveTicketData();
    
    return true;
  }

  /**
   * Unclaims a ticket.
   */
  unclaimTicket(guildId: string, id: string, staffId: string): boolean {
    const ticket = this.getTicket(guildId, id);
    if (!ticket || !ticket.claimedBy) return false;
    
    
    if (ticket.claimedBy !== staffId) return false;
    
    
    const updatedTicket: Ticket = {
      ...ticket,
      claimedBy: undefined,
    };
    
  const ticketKey = getTicketKeyFromTicket(ticket);
    this.tickets.get(guildId)!.set(ticketKey, updatedTicket);
    this.scheduleSaveTicketData();
    
    return true;
  }

  /**
   * Locks a ticket.
   */
  lockTicket(guildId: string, id: string, staffId: string): boolean {
    if (!this.isStaff(guildId, staffId)) return false;
    
    const ticket = this.getTicket(guildId, id);
    if (!ticket || ticket.isLocked) return false;
    
    
    if (ticket.claimedBy && ticket.claimedBy !== staffId) {
      return false;
    }
    
    const updatedTicket: Ticket = {
      ...ticket,
      isLocked: true,
    };
    
  const ticketKey = getTicketKeyFromTicket(ticket);
    this.tickets.get(guildId)!.set(ticketKey, updatedTicket);
    this.scheduleSaveTicketData();
    
    return true;
  }

  /**
   * Unlocks a ticket.
   */
  unlockTicket(guildId: string, id: string, staffId: string): boolean {
    if (!this.isStaff(guildId, staffId)) return false;
    
    const ticket = this.getTicket(guildId, id);
    if (!ticket || !ticket.isLocked) return false;

    if (ticket.claimedBy && ticket.claimedBy !== staffId) return false;

    const updatedTicket: Ticket = {
      ...ticket,
      isLocked: false,
    };

    const ticketKey = getTicketKeyFromTicket(ticket);
    this.tickets.get(guildId)!.set(ticketKey, updatedTicket);
    this.scheduleSaveTicketData();

    return true;
  }

  /**
   * Updates ticket description.
   */
  updateTicketDescription(guildId: string, id: string, description: string): boolean {
    const ticket = this.getTicket(guildId, id);
    if (!ticket) return false;
    
    const updatedTicket: Ticket = {
      ...ticket,
      description,
    };
    
  const ticketKey = getTicketKeyFromTicket(ticket);
    this.tickets.get(guildId)!.set(ticketKey, updatedTicket);
    this.scheduleSaveTicketData();
    return true;
  }

  /**
   * Generates a comprehensive ticket summary
   */
  generateTicketSummary(guildId: string, id: string): TicketSummary | null {
    const ticket = this.getTicket(guildId, id);
    if (!ticket) {
      console.error(`Cannot generate summary: Ticket ${id} not found in guild ${guildId}`);
      return null;
    }

    try {
      const now = new Date();
      const createdAt = new Date(ticket.createdAt);
      const durationMs = now.getTime() - createdAt.getTime();
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      const duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

      let staffHandler = 'Unassigned';
      if (ticket.claimedBy) {
        staffHandler = `<@${ticket.claimedBy}>`;
      }

      const embed = new EmbedBuilder()
        .setTitle(`🎫 Ticket #${ticket.ticketNumber} - Closed`)
        .setDescription(ticket.description || 'No description provided')
        .addFields(
          {
            name: '📝 Ticket Information',
            value: [
              `**Ticket ID:** ${ticket.ticketNumber}`,
              `**Channel:** ${ticket.isThread ? 'Thread' : 'Channel'}`,
              `**Created:** <t:${Math.floor(createdAt.getTime() / 1000)}:F>`,
              `**Duration:** ${duration}`,
              `**Staff Handler:** ${staffHandler}`
            ].join('\n'),
            inline: false
          }
        )
        .setColor(0xff6b35)
        .setTimestamp()
        .setFooter({ text: 'Ticket closed' });

      if (ticket.notes && ticket.notes.trim()) {
        embed.addFields({
          name: '📋 Staff Notes',
          value: ticket.notes.length > 1024 ? ticket.notes.substring(0, 1021) + '...' : ticket.notes,
          inline: false
        });
      }

      if (ticket.escalationLevel && ticket.escalationLevel > 0) {
        embed.addFields({
          name: '⚠️ Escalation Level',
          value: `Level ${ticket.escalationLevel}`,
          inline: true
        });
      }

      if (ticket.whitelistedUsers && ticket.whitelistedUsers.length > 0) {
        const whitelistText = ticket.whitelistedUsers.map(userId => `<@${userId}>`).join(', ');
        embed.addFields({
          name: '👥 Whitelisted Users',
          value: whitelistText.length > 1024 ? whitelistText.substring(0, 1021) + '...' : whitelistText,
          inline: false
        });
      }

      console.log(`Generated summary for ticket ${ticket.ticketNumber} in guild ${guildId}`);
      
      return {
        embed,
        ticketData: ticket,
        duration,
        staffHandler
      };
    } catch (error) {
      console.error(`Failed to generate ticket summary for ${id}:`, error);
      return null;
    }
  }

  /**
   * Sends ticket summary via DM to the ticket creator
   */
  async sendTicketSummaryDM(ticketSummary: TicketSummary): Promise<boolean>;
  async sendTicketSummaryDM(ticketSummary: TicketSummary, reason?: string): Promise<TicketSendResult>;
  async sendTicketSummaryDM(ticketSummary: TicketSummary, reason?: string): Promise<boolean | TicketSendResult> {
    if (ticketSummary.transcriptResult) {
      const result = await sendTicketSummary(ticketSummary, this.client!, reason || '');
      return result.wasSent;
    }

    if (!this.client) {
      console.error('Client not available for sending DM');
      return false;
    }

    try {
      const user = await this.client.users.fetch(ticketSummary.ticketData.userId);

      const dmMessage = [
        `Hi ${user.username}! Your support ticket has been closed.`,
        '',
        'Here\'s a summary of your ticket:'
      ].join('\n');

      await user.send({
        content: dmMessage,
        embeds: [ticketSummary.embed]
      });

      console.log(`Successfully sent ticket summary DM to user ${ticketSummary.ticketData.userId} for ticket #${ticketSummary.ticketData.ticketNumber}`);
      return true;
    } catch (error) {
      console.log(`Failed to send ticket summary DM to user ${ticketSummary.ticketData.userId}:`, error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Closes a ticket by channel ID or thread ID.
   */
  closeTicket(guildId: string, id: string): boolean {
    const guildTickets = this.tickets.get(guildId);
    if (!guildTickets) {
      return false;
    }

    const result = guildTickets.delete(id);
    if (result) {
      this.scheduleSaveTicketData();
    }
    return result;
  }

  /**
   * Gets a ticket by channel ID (for channel tickets) or thread ID (for thread tickets).
   */
  getTicketByChannel(guildId: string, channelId: string): Ticket | undefined {
    return this.tickets.get(guildId)?.get(channelId);
  }

  /**
   * Gets a ticket by thread ID.
   */
  getTicketByThread(guildId: string, threadId: string): Ticket | undefined {
    const ticket = this.tickets.get(guildId)?.get(threadId);
    
    if (ticket && ticket.isThread && ticket.threadId !== threadId) {
      console.warn(`Thread ticket validation failed: expected threadId ${threadId}, got ${ticket.threadId}`);
      return undefined;
    }
    
    return ticket;
  }

  /**
   * Gets a ticket by either channel ID or thread ID.
   */
  getTicket(guildId: string, id: string): Ticket | undefined {
    const guildTickets = this.tickets.get(guildId);
    if (!guildTickets) {
      return undefined;
    }
    
    const ticket = guildTickets.get(id);
    if (!ticket) {
      return undefined;
    }
    
    if (ticket.isThread && ticket.threadId !== id) {
      console.warn(`Ticket key mismatch: key=${id}, ticket.threadId=${ticket.threadId}`);
      return undefined;
    }
    
    if (!ticket.isThread && ticket.channelId !== id) {
      console.warn(`Ticket key mismatch: key=${id}, ticket.channelId=${ticket.channelId}`);
      return undefined;
    }
    
    return ticket;
  }

  getUserTicket(guildId: string, userId: string): Ticket | undefined {
    const guildTickets = this.tickets.get(guildId);
    if (!guildTickets) {
      return undefined;
    }

    for (const ticket of guildTickets.values()) {
      if (ticket.userId === userId) {
        
        if (ticket.isThread && ticket.threadId && this.client && !process.env.JEST_WORKER_ID) {
          this.validateTicketThread(guildId, ticket.threadId).then(exists => {
            if (!exists) {
              console.log(`Auto-cleaning stale ticket ${getTicketKeyFromTicket(ticket)} - thread no longer exists`);
              this.closeTicket(guildId, getTicketKeyFromTicket(ticket));
            }
          }).catch(error => {
            console.error('Error during async thread validation:', error);
          });
        }
        return ticket;
      }
    }

    return undefined;
  }

  /**
   * Gets all tickets for a guild.
   */
  getGuildTickets(guildId: string): Ticket[] {
    const guildTickets = this.tickets.get(guildId);
    return guildTickets ? Array.from(guildTickets.values()) : [];
  }

  /**
   * Gets the next ticket number for a guild.
   */
  getNextTicketNumber(guildId: string): number {
    return this.incrementAndScheduleTicketCounter(guildId);
  }

  /**
   * Gets the total number of tickets created in a guild.
   */
  getTotalTickets(guildId: string): number {
    return this.ticketCounters.get(guildId) || 0;
  }

  /**
   * Updates a staff member's presence information.
   * Returns information about status transitions for offline queue processing.
   */
  updateStaffPresence(guildId: string, userId: string, status: PresenceStatus): { wasOffline: boolean; isNowAvailable: boolean } {
    const staff = this.guildStaff.get(guildId);
    if (!staff || !staff.staffMembers.has(userId)) {
      return { wasOffline: false, isNowAvailable: false }; 
    }

    
    const config = this.guildConfigs.get(guildId);
    if (!config?.presenceTracking?.enabled) {
      return { wasOffline: false, isNowAvailable: false }; 
    }

    const now = new Date();
    const currentPresence = staff.presences.get(userId);
    const wasOffline = !currentPresence || currentPresence.status === 'offline';
    const isNowAvailable = status === 'online' || status === 'idle';
    
    const newPresence: StaffPresence = {
      userId,
      status,
      lastSeen: status === 'offline' ? (currentPresence?.lastSeen || now) : now,
      lastUpdated: now
    };

    staff.presences.set(userId, newPresence);
    
    return { wasOffline, isNowAvailable };
  }

  /**
   * Gets a staff member's current presence.
   */
  getStaffPresence(guildId: string, userId: string): StaffPresence | undefined {
    const staff = this.guildStaff.get(guildId);
    return staff?.presences.get(userId);
  }

  /**
   * Gets all staff members' presence information for a guild.
   */
  getAllStaffPresences(guildId: string): StaffPresence[] {
    const staff = this.guildStaff.get(guildId);
    if (!staff) return [];

    return Array.from(staff.presences.values());
  }

  /**
   * Gets staff members filtered by their current status.
   */
  getStaffByStatus(guildId: string, status: PresenceStatus): string[] {
    const staff = this.guildStaff.get(guildId);
    if (!staff) return [];

    const result: string[] = [];
    for (const [userId, presence] of staff.presences) {
      if (presence.status === status) {
        result.push(userId);
      }
    }
    return result;
  }

  /**
   * Adds a ticket to the offline queue when no staff are available
   */
  queueOfflineTicket(notification: QueuedTicketNotification): boolean {
    try {
      const staff = this.guildStaff.get(notification.guildId);
      if (!staff) return false;

      const existingIndex = staff.offlineQueue.findIndex(
        item => item.ticketId === notification.ticketId
      );
      
      if (existingIndex >= 0) {
        staff.offlineQueue[existingIndex] = notification;
      } else {
        staff.offlineQueue.push(notification);
      }

      console.log(`Queued offline ticket ${notification.ticketId} for guild ${notification.guildId}`);
      return true;
    } catch (error) {
      console.error('Failed to queue offline ticket:', error);
      return false;
    }
  }

  /**
   * Gets all queued tickets for a guild
   */
  getOfflineQueue(guildId: string): QueuedTicketNotification[] {
    const staff = this.guildStaff.get(guildId);
    return staff ? [...staff.offlineQueue] : [];
  }

  /**
   * Removes a ticket from the offline queue
   */
  removeFromOfflineQueue(guildId: string, ticketId: string): boolean {
    const staff = this.guildStaff.get(guildId);
    if (!staff) return false;

    const index = staff.offlineQueue.findIndex(item => item.ticketId === ticketId);
    if (index >= 0) {
      staff.offlineQueue.splice(index, 1);
      console.log(`Removed ticket ${ticketId} from offline queue for guild ${guildId}`);
      return true;
    }
    return false;
  }

  /**
   * Clears the entire offline queue for a guild
   */
  clearOfflineQueue(guildId: string): number {
    const staff = this.guildStaff.get(guildId);
    if (!staff) return 0;

    const count = staff.offlineQueue.length;
    staff.offlineQueue.length = 0;
    console.log(`Cleared ${count} tickets from offline queue for guild ${guildId}`);
    return count;
  }

  /**
   * Checks if all staff are currently offline
   */
  areAllStaffOffline(guildId: string): boolean {
    const onlineStaff = this.getStaffByStatus(guildId, 'online');
    const idleStaff = this.getStaffByStatus(guildId, 'idle');
    const dndStaff = this.getStaffByStatus(guildId, 'dnd');
    
    return onlineStaff.length === 0 && idleStaff.length === 0 && dndStaff.length === 0;
  }

  /**
   * Gets staff members who recently came online (for notification purposes)
   */
  getRecentlyOnlineStaff(guildId: string, withinMinutes: number = 5): string[] {
    const staff = this.guildStaff.get(guildId);
    if (!staff) return [];

    const cutoffTime = new Date(Date.now() - withinMinutes * 60 * 1000);
    const recentlyOnline: string[] = [];

    for (const [userId, presence] of staff.presences) {
      if ((presence.status === 'online' || presence.status === 'idle') && 
          presence.lastUpdated > cutoffTime) {
        recentlyOnline.push(userId);
      }
    }

    return recentlyOnline;
  }

  /**
   * Gets online staff (online or idle status).
   */
  getOnlineStaff(guildId: string): string[] {
    const staff = this.guildStaff.get(guildId);
    if (!staff) return [];

    const result: string[] = [];
    for (const [userId, presence] of staff.presences) {
      if (presence.status === 'online' || presence.status === 'idle') {
        result.push(userId);
      }
    }
    return result;
  }

  /**
   * Enables or disables presence tracking for a guild.
   */
  async setPresenceTracking(guildId: string, enabled: boolean): Promise<void> {
    if (!this.guildConfigs.has(guildId)) {
      this.guildConfigs.set(guildId, {});
    }

    const config = this.guildConfigs.get(guildId)!;
    if (!config.presenceTracking) {
      config.presenceTracking = {
        enabled: false,
        smartPing: {
          enabled: true,
          idleDelayMinutes: 2,
          dndMentionOnly: true,
          offlineQueueing: false
        },
        showInEmbeds: true
      };
    }

    config.presenceTracking.enabled = enabled;

    
    if (!enabled) {
      const staff = this.guildStaff.get(guildId);
      if (staff) {
        staff.presences.clear();
      }
    }

    try {
      await this.saveStaffData();
      console.log(`Presence tracking ${enabled ? 'enabled' : 'disabled'} for guild ${guildId}`);
    } catch (error) {
      
      config.presenceTracking.enabled = !enabled;
      throw error;
    }
  }

  /**
   * Gets the presence tracking configuration for a guild.
   */
  getPresenceConfig(guildId: string): { enabled: boolean; smartPing: SmartPingConfig; showInEmbeds: boolean } {
    const config = this.guildConfigs.get(guildId);
    return config?.presenceTracking || {
      enabled: false,
      smartPing: {
        enabled: true,
        idleDelayMinutes: 2,
        dndMentionOnly: true,
        offlineQueueing: false
      },
      showInEmbeds: true
    };
  }

  /**
   * Validates if a ticket thread actually exists
   */
  async validateTicketThread(guildId: string, ticketKey: string): Promise<boolean> {
    try {
      if (!this.client) {
        console.warn('TicketManager: No client available for thread validation');
        return true; 
      }

  const ticket = this.getTicket(guildId, ticketKey);
  if (!ticket || !ticket.isThread || !ticket.threadId) return false;

      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) return false;

      const thread = await guild.channels.fetch(ticket.threadId).catch(() => null);
      return thread !== null && thread.isThread();
    } catch (error) {
      console.error('Error validating ticket thread:', error);
      return false;
    }
  }

  /**
   * Auto-cleanup tickets with deleted threads
   */
  async cleanupStaleTickets(guildId: string): Promise<number> {
    if (!this.client) {
      console.warn('TicketManager: No client available for ticket cleanup');
      return 0;
    }

    const tickets = this.getGuildTickets(guildId);
    let cleanupCount = 0;
    
    for (const ticket of tickets) {
      if (ticket.isThread && ticket.threadId) {
  const ticketKey = getTicketKeyFromTicket(ticket);
        const threadExists = await this.validateTicketThread(guildId, ticketKey);
        if (!threadExists) {
          console.log(`Auto-cleaning stale ticket ${ticket.channelId} - thread no longer exists`);
          this.closeTicket(guildId, ticket.channelId);
          cleanupCount++;
        }
      }
    }
    
    console.log(`Cleaned up ${cleanupCount} stale tickets in guild ${guildId}`);
    return cleanupCount;
  }

  /**
   * Updates ticket notes
   */
  updateTicketNotes(guildId: string, id: string, notes: string, staffId: string): boolean {
    const ticket = this.getTicket(guildId, id);
    if (!ticket) return false;

    if (!this.isStaff(guildId, staffId)) return false;

    const updatedTicket: Ticket = {
      ...ticket,
      notes: notes.trim() || undefined,
    };

  const ticketKey = getTicketKeyFromTicket(ticket);
    this.tickets.get(guildId)!.set(ticketKey, updatedTicket);
    this.scheduleSaveTicketData();
    return true;
  }

  /**
   * Escalates a ticket to the next level
   */
  escalateTicket(guildId: string, id: string, staffId: string): { success: boolean; newLevel?: number } {
    const ticket = this.getTicket(guildId, id);
    if (!ticket) return { success: false };
    if (!this.isStaff(guildId, staffId)) return { success: false };

    const currentLevel = ticket.escalationLevel || 0;
    const newLevel = Math.min(currentLevel + 1, 3); 

    if (newLevel === currentLevel) {
      return { success: false }; 
    }

    const updatedTicket: Ticket = {
      ...ticket,
      escalationLevel: newLevel,
    };

  const ticketKey = getTicketKeyFromTicket(ticket);
    this.tickets.get(guildId)!.set(ticketKey, updatedTicket);
    this.scheduleSaveTicketData();
    return { success: true, newLevel };
  }

  /**
   * Closes a ticket with staff verification and returns ticket summary
   */
  closeTicketWithAuth(guildId: string, id: string, staffId: string): Promise<{ success: boolean; summary: TicketSummary | null }>;
  closeTicketWithAuth(guildId: string, id: string, staffId: string, generateTranscript: boolean): Promise<{ success: boolean; summary: TicketSummary | null; transcript?: TranscriptResult | null }>;
  async closeTicketWithAuth(guildId: string, id: string, staffId: string, generateTranscript: boolean = false): Promise<{ success: boolean; summary: TicketSummary | null; transcript?: TranscriptResult | null }> {
    if (!this.isStaff(guildId, staffId)) {
      return { success: false, summary: null };
    }

    let transcript: TranscriptResult | null = null;
    if (generateTranscript) {
      transcript = await this.generateTicketTranscript(guildId, id);
      if (!transcript || !transcript.success) {
        console.warn(`Failed to generate transcript for ticket ${id}, proceeding with summary only`);
      }
    }

    const summary = this.generateTicketSummary(guildId, id);
    
    if (summary && transcript && transcript.success) {
      summary.transcriptResult = transcript;
    }
    
    const closed = this.closeTicket(guildId, id);

    return { success: closed, summary, transcript };
  }  /**
   * Adds a user to the ticket whitelist
   */
  addUserToWhitelist(guildId: string, ticketId: string, userId: string, staffId: string): boolean {
    const ticket = this.getTicket(guildId, ticketId);
    if (!ticket) return false;

    if (!this.isStaff(guildId, staffId)) return false;

    
    if (!ticket.whitelistedUsers) {
      ticket.whitelistedUsers = [];
    }

    
    if (!ticket.whitelistedUsers.includes(userId)) {
      ticket.whitelistedUsers.push(userId);
      
      
  const ticketKey = getTicketKeyFromTicket(ticket);
      this.tickets.get(guildId)!.set(ticketKey, ticket);
      this.scheduleSaveTicketData();
      return true;
    }

    return false; 
  }

  /**
   * Removes a user from the ticket whitelist
   */
  removeUserFromWhitelist(guildId: string, ticketId: string, userId: string, staffId: string): boolean {
    const ticket = this.getTicket(guildId, ticketId);
    if (!ticket) return false;

    if (!this.isStaff(guildId, staffId)) return false;

    if (ticket.whitelistedUsers) {
      const index = ticket.whitelistedUsers.indexOf(userId);
      if (index > -1) {
        ticket.whitelistedUsers.splice(index, 1);
        
  const ticketKey = getTicketKeyFromTicket(ticket);
        this.tickets.get(guildId)!.set(ticketKey, ticket);
        this.scheduleSaveTicketData();
        return true;
      }
    }

    return false;
  }

  /**
   * Gets the whitelist for a ticket
   */
  getTicketWhitelist(guildId: string, ticketId: string): string[] {
    const ticket = this.getTicket(guildId, ticketId);
    return ticket?.whitelistedUsers || [];
  }

  /**
   * Checks if a user is whitelisted for a ticket
   */
  isUserWhitelisted(guildId: string, ticketId: string, userId: string): boolean {
    const ticket = this.getTicket(guildId, ticketId);
    return ticket?.whitelistedUsers?.includes(userId) || false;
  }

  /**
   * Generates a transcript for a ticket channel
   */
  async generateTicketTranscript(guildId: string, ticketId: string, options: Partial<TranscriptOptions> = {}): Promise<TranscriptResult | null> {
    if (!this.client) {
      console.error('TicketManager: No client available for transcript generation');
      return null;
    }

    const ticket = this.getTicket(guildId, ticketId);
    if (!ticket) {
      console.error(`Cannot generate transcript: Ticket ${ticketId} not found in guild ${guildId}`);
      return null;
    }

    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        console.error(`Cannot generate transcript: Guild ${guildId} not found`);
        return null;
      }

      let channel;
      if (ticket.isThread && ticket.threadId) {
        channel = await guild.channels.fetch(ticket.threadId).catch(() => null);
        if (!channel || !channel.isThread()) {
          console.error(`Cannot generate transcript: Thread ${ticket.threadId} not found or not accessible`);
          return null;
        }
      } else {
        channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
          console.error(`Cannot generate transcript: Channel ${ticket.channelId} not found or not text-based`);
          return null;
        }
      }

      const transcriptOptions: TranscriptOptions = {
        channel,
        darkMode: true,
        limit: 500,
        includeReactions: true,
        includeComponents: true,
        includeToc: true,
        includeSearch: true,
        includeJumpNav: true,
        ...options
      };

      const result = await generateTranscript(transcriptOptions);
      console.log(`Generated transcript for ticket #${ticket.ticketNumber} in guild ${guildId}`);
      return result;

    } catch (error) {
      console.error(`Failed to generate transcript for ticket ${ticketId}:`, error);
      return null;
    }
  }

  /**
   * Generates and saves a transcript file for a ticket
   */
  async generateAndSaveTicketTranscript(guildId: string, ticketId: string, outputPath?: string): Promise<{ success: boolean; filePath?: string; transcript?: TranscriptResult }> {
    const transcript = await this.generateTicketTranscript(guildId, ticketId);
    if (!transcript || !transcript.success) {
      return { success: false };
    }

    try {
      const ticket = this.getTicket(guildId, ticketId);
      if (!ticket) {
        return { success: false };
      }

      const fileName = `ticket-${ticket.ticketNumber}-transcript.html`;
      const filePath = outputPath || path.join(process.cwd(), 'transcripts', fileName);

      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, transcript.html, 'utf8');

      console.log(`Saved transcript for ticket #${ticket.ticketNumber} to ${filePath}`);
      return { success: true, filePath, transcript };

    } catch (error) {
      console.error('Failed to save transcript file:', error);
      return { success: false };
    }
  }

  /**
   * Closes a ticket with transcript generation
   */
  async closeTicketWithTranscript(guildId: string, ticketId: string, staffId: string, saveTranscript: boolean = true): Promise<{ 
    success: boolean; 
    summary: TicketSummary | null; 
    transcript?: TranscriptResult | null;
    transcriptPath?: string 
  }> {
    if (!this.isStaff(guildId, staffId)) {
      return { success: false, summary: null };
    }

    let transcript: TranscriptResult | null = null;
    let transcriptPath: string | undefined;

    if (saveTranscript) {
      const transcriptResult = await this.generateAndSaveTicketTranscript(guildId, ticketId);
      if (transcriptResult.success && transcriptResult.transcript) {
        transcript = transcriptResult.transcript;
        transcriptPath = transcriptResult.filePath;
      }
    } else {
      transcript = await this.generateTicketTranscript(guildId, ticketId);
    }

    const summary = this.generateTicketSummary(guildId, ticketId);
    const closed = this.closeTicket(guildId, ticketId);

    return { 
      success: closed, 
      summary, 
      transcript,
      transcriptPath 
    };
  }

  /**
   * Cleanup all resources and timers to prevent handle leaks.
   */
  destroy(): void {
    if (this.ticketSaveTimer) {
      clearTimeout(this.ticketSaveTimer);
      this.ticketSaveTimer = null;
    }
  }

  /**
   * Test helper: cleanup test data files (only available in test environment)
   */
  public async cleanupTestData(): Promise<void> {
    if (!process.env.JEST_WORKER_ID) {
      throw new Error('cleanupTestData can only be called in test environment');
    }

    try {
      const staffDir = path.dirname(this.staffFilePath);
      const staffFiles = await fs.readdir(staffDir).catch(() => []);
      for (const file of staffFiles) {
        if (file.startsWith('test-staff-') && file.endsWith('.json')) {
          try {
            await fs.unlink(path.join(staffDir, file));
          } catch (error) {
          }
        }
      }

      const ticketsDir = path.dirname(this.ticketsFilePath);
      const ticketFiles = await fs.readdir(ticketsDir).catch(() => []);
      for (const file of ticketFiles) {
        if (file.startsWith('test-tickets-') && file.endsWith('.json')) {
          try {
            await fs.unlink(path.join(ticketsDir, file));
          } catch (error) {
          }
        }
      }
    } catch (error) {
    }
  }
}