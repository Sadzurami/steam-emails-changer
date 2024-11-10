import closeWithGrace from 'close-with-grace';
import { program as app } from 'commander';
import setProcessTitle from 'console-title';
import PQueue from 'p-queue';
import path from 'path';
import readPackageJson from 'read-pkg-up';
import { setTimeout as delay } from 'timers/promises';

import { Kopeechka } from '@sadzurami/kopeechka-store';
import { Logger } from '@sadzurami/logger';

import { Bot } from './bot';
import { moveSession, parseMessage, readConfig, readProxies, readResults, readSessions, saveResults } from './helpers';

const queues: PQueue[] = [];

init()
  .then(() => main())
  .then(() => exit({}, true))
  .catch((error) => exit({ error }, true));

async function init() {
  const logger = new Logger('init');
  const { packageJson } = await readPackageJson({ cwd: __dirname });

  const appName = packageJson.name
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('-');
  const appVersion = packageJson.version;
  const appDescription = packageJson.description;

  await app
    .name(appName)
    .version(appVersion)
    .description(appDescription)
    .option('-c, --config <path>', 'path to config file', './config.json')
    .option('-p, --proxies <path>', 'path to proxies file', './proxies.txt')
    .option('-r, --results <path>', 'path to results file', './results.txt')
    .option('-s, --sessions <path>', 'path to sessions directory', './sessions')
    .option('--silent-exit', 'exit process automatically on finish')
    .option('--concurrency <number>', 'concurrency limit for global operations')
    .parseAsync();

  logger.info(`${appName}`);
  logger.info(`Version: ${appVersion}`);

  setProcessTitle(`${appName} v${appVersion}`);
  closeWithGrace({ delay: false, logger: false }, ({ signal, err: error }) => exit({ signal, error }, !signal));
}

async function main() {
  const logger = new Logger('main');
  logger.info('-'.repeat(40));

  const config = await readConfig(path.resolve(app.opts().config));
  logger.info(`Config: ${config.origin}`);

  const proxies = await readProxies(path.resolve(app.opts().proxies));
  logger.info(`Proxies: ${proxies.length}`);

  const resultsFile = path.resolve(app.opts().results);
  const results = await readResults(resultsFile);
  logger.info(`Results: ${results.size}`);

  const sessionsDir = path.resolve(app.opts().sessions);
  const sessions = await readSessions(sessionsDir);
  logger.info(`Sessions: ${sessions.length}`);

  const concurrency = ~~app.opts().concurrency || proxies.length || 1;
  logger.info(`Concurrency: ${concurrency}`);

  if (sessions.length === 0) return;
  if (config.KopeechkaApiKey.length === 0) throw new Error('Kopeechka api key not found');
  if (config.KopeechkaDomains.length === 0) throw new Error('Kopeechka domains not found');

  logger.info('-'.repeat(40));
  logger.info('Starting tasks');
  logger.info('-'.repeat(40));

  // prettier-ignore
  const getNextProxy = ((i = 0) => () => proxies[i++ % proxies.length])();

  const queue = new PQueue({ concurrency, interval: 1, intervalCap: 1 });
  queues.push(queue);

  const kopeechka = new Kopeechka({ key: config.KopeechkaApiKey });

  for (const session of sessions) {
    queue.add(async () => {
      const proxy = session.Proxy || getNextProxy();
      const bot = new Bot({ name: session.Username, session }, proxy);

      let email: string | null = null;

      try {
        email = await kopeechka.orderEmail('steam.com', { domains: config.KopeechkaDomains });

        await bot.start();
        await bot.startEmailChange();
        await bot.applyEmailChange(email);

        const message = await kopeechka.waitMessage(email, { full: true, timeout: config.WaitMessageSeconds * 1000 });
        const messageCode = parseMessage(message);
        await bot.finishEmailChange(email, messageCode);

        results.set(session.Username, email);
        await saveResults(resultsFile, results);
        await moveSession(sessionsDir, path.join(sessionsDir, 'success'), session);

        logger.info(`${session.Username} | success | left ${queue.size + queue.pending}`);
      } catch (error) {
        const message = `${error.message}${error.cause ? ` (${error.cause.message})` : ''}`;
        logger.warn(`${session.Username} | ${message.toLowerCase()} | left ${queue.size + queue.pending}`);
      } finally {
        await Promise.all([bot.stop(), delay(1000)]);
        if (email) await kopeechka.cancelEmail(email).catch(() => {});
      }
    });
  }

  await queue.onIdle();

  logger.info('-'.repeat(40));
  logger.info('All tasks completed');
}

async function exit(options: { signal?: string; error?: Error } = {}, awaitKeyAction = false) {
  const logger = new Logger('exit');
  const promises: Promise<any>[] = [];

  for (const queue of queues) {
    queue.pause();
    queue.clear();

    promises.push(queue.onIdle());
  }

  await Promise.all(promises).then(() => new Promise((resolve) => process.nextTick(resolve)));
  logger.info('-'.repeat(40));

  if (options.error) logger.warn(`Error: ${options.error.message}`);

  if (options.signal) logger.info(`Shutdown signal: ${options.signal}`);

  if (awaitKeyAction && !app.opts().silentExit) {
    logger.info('Press any key to exit');
    process.stdin.setRawMode(true).resume();

    await new Promise((resolve) => process.stdin.once('data', resolve));
    process.stdin.setRawMode(false).resume();
  }

  process.exit(options.error ? 1 : 0);
}
