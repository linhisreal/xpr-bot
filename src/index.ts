import {Client, GatewayIntentBits} from 'discord.js';
import dotenv from 'dotenv';
import {TicketBot} from './bot/ticketBot.js';

dotenv.config();

/**
 * Main entry point for the Discord ticket bot.
 * Initializes the bot with required intents and starts the connection.
 */
async function main(): Promise<void> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
    ],
  });

  const bot = new TicketBot(client);
  await bot.start();
}

main().catch(error => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});