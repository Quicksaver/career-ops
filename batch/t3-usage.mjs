import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { collectCodexSessions, recordCodexUsage, syncBatchUsage } from '../lib/t3-usage.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: node batch/t3-usage.mjs record|sync --user ID [--log FILE|--logs DIR] [--sessions DIR]');
    return;
  }
  const [command, ...flags] = args;
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    if (!['--user', '--log', '--logs', '--sessions'].includes(flags[i]) || !flags[i + 1] || flags[i + 1].startsWith('--')) throw new Error('Expected record|sync --user ID [--log FILE|--logs DIR] [--sessions DIR].');
    options[flags[i]] = flags[i + 1];
  }
  if (!['record', 'sync'].includes(command) || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(options['--user'] || '')) throw new Error('A command and explicit --user are required.');
  if (process.env.CAREER_OPS_T3_USAGE === '0') return;
  process.env.CAREER_OPS_USER = options['--user'];
  const root = getCareerOpsRoot();
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (command === 'record') {
    if (!options['--log']) throw new Error('record requires --log.');
    recordCodexUsage({ root, projectRoot, logFile: options['--log'] });
    return;
  }
  if (options['--sessions']) {
    const matched = await collectCodexSessions({ root, projectRoot, user: options['--user'], sessionsDir: options['--sessions'] });
    console.error(`T3 usage: found ${matched} saved batch sessions for ${options['--user']}.`);
  }
  const result = await syncBatchUsage({ root, projectRoot, logsDir: options['--logs'] });
  if (result.archived) console.error(`T3 usage: linked and archived ${result.archived} batch sessions.`);
  if (result.protected) console.error(`T3 usage: left ${result.protected} existing conversations unchanged.`);
  if (result.status === 'offline' || result.remaining) console.error('T3 usage: sessions remain queued for a later sync.');
  return result;
}

if (isMainModule(import.meta.url)) {
  main().catch(() => { console.error('WARN: T3 usage sync failed; batch results are unchanged. Retry batch/t3-usage.mjs sync --user <id>.'); process.exitCode = 1; });
}
