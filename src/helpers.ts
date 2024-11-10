import fs from 'fs-extra';
import PQueue from 'p-queue';
import path from 'path';

import { Config } from './interfaces/config.interface';
import { Session } from './interfaces/session.interface';

export async function readConfig(file: string): Promise<Config & { origin: string }> {
  const config: Config & { origin?: string } = {
    KopeechkaApiKey: '',
    KopeechkaDomains: [],
    WaitMessageSeconds: 100,
  };

  try {
    await fs.ensureDir(path.dirname(file));
    if (!(await fs.exists(file))) await fs.writeFile(file, JSON.stringify(config, null, 2));

    const content = await fs.readFile(file, 'utf-8').then((content) => content.trim());
    config.origin = content === JSON.stringify(config, null, 2) ? 'default' : 'custom';

    const candidate = JSON.parse(content) as Record<string, any>;
    for (const key of Object.keys(config)) {
      if (!Object.hasOwn(candidate, key)) continue;
      if (config[key] === candidate[key]) continue;

      config[key] = candidate[key];
    }
  } catch (error) {}

  return { ...config, origin: config.origin || 'default' };
}

export async function readProxies(file: string): Promise<string[]> {
  const proxies: Set<string> = new Set();

  // prettier-ignore
  const content = await fs.ensureFile(file).then(() => fs.readFile(file, 'utf-8')).catch(() => '');

  for (const line of content.split(/\r?\n/)) {
    let proxy: string;

    try {
      proxy = new URL(line.trim()).toString().slice(0, -1);
    } catch (error) {
      continue;
    }

    proxies.add(proxy);
  }

  return [...proxies.values()];
}

export async function readSessions(dir: string): Promise<Session[]> {
  // prettier-ignore
  let paths: string[] = await fs.ensureDir(dir).then(() => fs.readdir(dir)).catch(() => []);

  paths = paths.filter((file) => file.endsWith('.steamsession')).map((file) => path.join(dir, file));
  if (paths.length === 0) return [];

  const sessions: Map<string, Session> = new Map();

  const queue = new PQueue({ concurrency: 512 });
  await queue.addAll(
    paths.map((file) => async () => {
      try {
        const content = await fs.readFile(file, 'utf8').catch(() => '');
        const session = JSON.parse(content) as Session;

        if (typeof session !== 'object') return;
        if (typeof session.SchemaVersion !== 'number' || session.SchemaVersion < 2) return;
        if (typeof session.ExpiryDate && new Date(session.ExpiryDate) < new Date()) return;

        sessions.set(session.Username.toLowerCase(), session);
      } catch (error) {}
    }),
  );

  return [...sessions.values()];
}

export async function moveSession(src: string, dest: string, session: Session) {
  try {
    await fs.ensureDir(dest);

    src = path.join(src, `${session.Username}.steamsession`);
    dest = path.join(dest, `${session.Username}.steamsession`);

    await fs.move(src, dest);
  } catch (error) {
    throw new Error('Failed to move session', { cause: error });
  }
}

export async function readResults(file: string): Promise<Map<string, string>> {
  const results: Map<string, string> = new Map();

  // prettier-ignore
  const content = await fs.ensureFile(file).then(() => fs.readFile(file, 'utf-8')).catch(() => '');

  for (let line of content.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;

    const [username, email] = line.split(':');
    if (!username || !email) continue;

    results.set(username, email);
  }

  return results;
}

export async function saveResults(file: string, results: Map<string, string>) {
  try {
    const content = [...results.entries()].map(([username, email]) => `${username}:${email}`).join('\n');

    await fs.writeFile(file, content);
  } catch (error) {
    throw new Error('Failed to save results', { cause: error });
  }
}

export function parseMessage(message: string) {
  try {
    const code = message.match(/>\s*([A-Z0-9]{5})\s*</)?.[1];

    if (!code) throw new Error('Code not found');

    return code;
  } catch (error) {
    throw new Error('Failed to parse message', { cause: error });
  }
}
