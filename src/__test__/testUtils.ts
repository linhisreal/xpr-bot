import { ChannelManager, Client } from 'discord.js';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export function createMockClient(): Client {
  const channelsMock: any = {
    fetch: jest.fn().mockResolvedValue({ isThread: () => true, archived: false })
  };

  const client: Partial<Client> = {
    channels: channelsMock as unknown as ChannelManager
  };

  return client as Client;
}

export async function createTempDataFile(prefix = 'xploits-test-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const filePath = path.join(dir, 'staff.json');
  return { dir, filePath };
}
