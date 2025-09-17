import { BaseInteraction, ButtonInteraction, ModalSubmitInteraction, ChatInputCommandInteraction } from 'discord.js';

/**
 * Interface representing the state of an interaction
 */
interface InteractionState {
  id: string;
  replied: boolean;
  deferred: boolean;
  timestamp: number;
  type: 'button' | 'modal' | 'command';
  userId: string;
}

/**
 * Manages Discord interaction states to prevent duplicate replies and handle errors
 */
export class InteractionManager {
  private interactions: Map<string, InteractionState> = new Map();
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000;
  private readonly MAX_INTERACTION_AGE = 15 * 60 * 1000;
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredInteractions();
    }, this.CLEANUP_INTERVAL).unref();
  }

  /**
   * Tracks a new interaction
   */
  trackInteraction(interaction: BaseInteraction): void {
    const state: InteractionState = {
      id: interaction.id,
      replied: this.getInteractionRepliedState(interaction),
      deferred: this.getInteractionDeferredState(interaction),
      timestamp: Date.now(),
      type: this.getInteractionType(interaction),
      userId: interaction.user.id
    };

    this.interactions.set(interaction.id, state);
    console.log(`InteractionManager: Tracking interaction ${interaction.id} (${state.type}) for user ${state.userId}`);
  }

  /**
   * Safely replies to an interaction if not already replied
   */
  async safeReply(
    interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction,
    options: any
  ): Promise<boolean> {
    const state = this.interactions.get(interaction.id);
    
    if (!state) {
      console.warn(`InteractionManager: No state found for interaction ${interaction.id}, tracking now`);
      this.trackInteraction(interaction);
    }

    
    if (this.isInteractionExpired(interaction.id)) {
      console.error(`InteractionManager: Interaction ${interaction.id} has expired`);
      return false;
    }

    if (interaction.replied) {
      console.warn(`InteractionManager: Interaction ${interaction.id} already replied`);
      return false;
    }

    try {
      await interaction.reply(options);
      this.updateInteractionState(interaction.id, { replied: true });
      console.log(`InteractionManager: Successfully replied to interaction ${interaction.id}`);
      return true;
    } catch (error: any) {
      console.error(`InteractionManager: Failed to reply to interaction ${interaction.id}:`, error);
      
      if (error.code === 10062) {
        console.warn(`InteractionManager: Cannot reply to expired interaction ${interaction.id}`);
        return false;
      }
      
      if (error instanceof Error && error.message.includes('InteractionAlreadyReplied')) {
        return await this.safeFollowUp(interaction, options);
      }
      
      return false;
    }
  }

  /**
   * Safely responds to an interaction (reply if not replied, edit if deferred)
   */
  async safeRespond(
    interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction,
    options: any
  ): Promise<boolean> {
    try {
      if (interaction.deferred) {
        return await this.safeEditReply(interaction, options);
      } else if (!interaction.replied) {
        return await this.safeReply(interaction, { ...options, ephemeral: true });
      } else {
        return await this.safeFollowUp(interaction, options);
      }
    } catch (error: any) {
      if (error.code === 10062) {
        console.warn(`InteractionManager: Cannot respond to expired interaction ${interaction.id} - operation completed silently`);
        return false;
      }
      console.error(`InteractionManager: Failed to respond to interaction ${interaction.id}:`, error);
      return false;
    }
  }

  /**
   * Safely defers an interaction reply with enhanced error handling for deferred workflows
   */
  async safeDefer(
    interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction,
    options?: { ephemeral?: boolean }
  ): Promise<boolean> {
    const state = this.interactions.get(interaction.id);
    
    if (!state) {
      console.warn(`InteractionManager: No state found for interaction ${interaction.id}, tracking now`);
      this.trackInteraction(interaction);
    }

    if (this.isInteractionExpired(interaction.id)) {
      console.error(`InteractionManager: Interaction ${interaction.id} has expired`);
      return false;
    }

    if (interaction.deferred || interaction.replied) {
      console.warn(`InteractionManager: Interaction ${interaction.id} already deferred/replied`);
      return false;
    }

    try {
      await interaction.deferReply(options || { ephemeral: true });
      this.updateInteractionState(interaction.id, { deferred: true });
      console.log(`InteractionManager: Successfully deferred interaction ${interaction.id}`);
      return true;
    } catch (error: any) {
      if (error.code === 10062) {
        console.warn(`InteractionManager: Interaction ${interaction.id} expired (10062) - operation will continue in background`);
        return false;
      }
      if (error.code === 40060) {
        console.warn(`InteractionManager: Interaction ${interaction.id} already acknowledged (40060) - skipping defer`);
        return false;
      }
      console.error(`InteractionManager: Failed to defer interaction ${interaction.id}:`, error);
      return false;
    }
  }

  /**
   * Immediately defers interaction and provides fallback for urgent operations
   * This method prioritizes immediate deferral to avoid Discord's 3-second timeout
   */
  async immediateDefer(
    interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction,
    options?: { ephemeral?: boolean }
  ): Promise<boolean> {
    this.trackInteraction(interaction);

    try {
      await interaction.deferReply(options || { ephemeral: true });
      this.updateInteractionState(interaction.id, { deferred: true });
      console.log(`InteractionManager: Immediate defer successful for interaction ${interaction.id}`);
      return true;
    } catch (error: any) {
      if (error.code === 10062) {
        console.warn(`InteractionManager: Immediate defer failed - interaction ${interaction.id} expired (10062)`);
        return false;
      }
      if (error.code === 40060) {
        console.warn(`InteractionManager: Immediate defer failed - interaction ${interaction.id} already acknowledged (40060)`);
        return false;
      }
      console.error(`InteractionManager: Immediate defer failed for interaction ${interaction.id}:`, error);
      return false;
    }
  }

  /**
   * Safely sends a follow-up message
   */
  async safeFollowUp(
    interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction,
    options: any
  ): Promise<boolean> {
    if (this.isInteractionExpired(interaction.id)) {
      console.error(`InteractionManager: Interaction ${interaction.id} has expired`);
      return false;
    }

    if (!interaction.replied && !interaction.deferred) {
      console.error(`InteractionManager: Cannot follow up on interaction ${interaction.id} that hasn't been replied/deferred`);
      return false;
    }

    try {
      await interaction.followUp(options);
      console.log(`InteractionManager: Successfully sent follow-up for interaction ${interaction.id}`);
      return true;
    } catch (error) {
      console.error(`InteractionManager: Failed to send follow-up for interaction ${interaction.id}:`, error);
      return false;
    }
  }

  /**
   * Safely edits a deferred reply
   */
  async safeEditReply(
    interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction,
    options: any
  ): Promise<boolean> {
    if (this.isInteractionExpired(interaction.id)) {
      console.error(`InteractionManager: Interaction ${interaction.id} has expired`);
      return false;
    }

    if (!interaction.deferred) {
      console.error(`InteractionManager: Cannot edit reply for interaction ${interaction.id} that hasn't been deferred`);
      return false;
    }

    try {
      await interaction.editReply(options);
      console.log(`InteractionManager: Successfully edited reply for interaction ${interaction.id}`);
      return true;
    } catch (error) {
      console.error(`InteractionManager: Failed to edit reply for interaction ${interaction.id}:`, error);
      return false;
    }
  }

  /**
   * Checks if an interaction has expired
   */
  private isInteractionExpired(interactionId: string): boolean {
    const state = this.interactions.get(interactionId);
    if (!state) return true;

    const age = Date.now() - state.timestamp;
    return age > this.MAX_INTERACTION_AGE;
  }

  /**
   * Updates the state of a tracked interaction
   */
  private updateInteractionState(interactionId: string, updates: Partial<InteractionState>): void {
    const state = this.interactions.get(interactionId);
    if (state) {
      Object.assign(state, updates);
      this.interactions.set(interactionId, state);
    }
  }

  /**
   * Determines the type of interaction
   */
  private getInteractionType(interaction: BaseInteraction): 'button' | 'modal' | 'command' {
    if (interaction.isButton()) return 'button';
    if (interaction.isModalSubmit()) return 'modal';
    if (interaction.isChatInputCommand()) return 'command';
    return 'button';
  }

  /**
   * Gets the replied state for any interaction type
   */
  private getInteractionRepliedState(interaction: BaseInteraction): boolean {
    if (interaction.isRepliable()) {
      return interaction.replied;
    }
    return false;
  }

  /**
   * Gets the deferred state for any interaction type
   */
  private getInteractionDeferredState(interaction: BaseInteraction): boolean {
    if (interaction.isRepliable()) {
      return interaction.deferred;
    }
    return false;
  }

  /**
   * Cleans up expired interactions
   */
  private cleanupExpiredInteractions(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [id, state] of this.interactions.entries()) {
      if (now - state.timestamp > this.MAX_INTERACTION_AGE) {
        this.interactions.delete(id);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`InteractionManager: Cleaned up ${cleanedCount} expired interactions`);
    }
  }

  /**
   * Gets current interaction statistics
   */
  getStats(): { total: number; byType: Record<string, number>; oldestAge: number } {
    const stats = {
      total: this.interactions.size,
      byType: { button: 0, modal: 0, command: 0 },
      oldestAge: 0
    };

    const now = Date.now();
    let oldestTimestamp = now;

    for (const state of this.interactions.values()) {
      stats.byType[state.type]++;
      if (state.timestamp < oldestTimestamp) {
        oldestTimestamp = state.timestamp;
      }
    }

    stats.oldestAge = now - oldestTimestamp;
    return stats;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.interactions.clear();
    console.log('InteractionManager: Destroyed and cleaned up resources');
  }
}