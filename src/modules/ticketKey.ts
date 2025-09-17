/**
 * Lightweight Map key usage.
 */

import type { Ticket } from '../bot/ticketManager';

/**
 * Generate a canonical ticket key from channel ID and optional thread ID.
 * For thread tickets, returns the thread ID. For channel tickets, returns the channel ID.
 */
export function getTicketKeyFromIds(channelId: string, threadId?: string): string {
  return threadId || channelId;
}

/**
 * Generate a canonical ticket key from a ticket object.
 * Uses the same logic as getTicketKeyFromIds for consistency.
 */
export function getTicketKeyFromTicket(ticket: Ticket): string {
  return getTicketKeyFromIds(ticket.channelId, ticket.threadId);
}
