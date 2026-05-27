import { existsSync, mkdirSync } from 'fs';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const LIB_DIR = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(LIB_DIR, '..');
export const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class UserContextError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserContextError';
  }
}

function stripUserArgs(args) {
  const cleaned = [];
  let userId = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--user' || arg === '-u') {
      userId = args[i + 1] || '';
      i++;
      continue;
    }
    if (arg.startsWith('--user=')) {
      userId = arg.slice('--user='.length);
      continue;
    }
    cleaned.push(arg);
  }

  return { args: cleaned, userId };
}

export function validateUserId(userId) {
  if (!userId || typeof userId !== 'string') {
    throw new UserContextError(
      'No career-ops user selected. Specify one with --user <id> or set CAREER_OPS_USER.',
    );
  }
  if (!USER_ID_PATTERN.test(userId)) {
    throw new UserContextError(
      `Invalid career-ops user "${userId}". Use letters, numbers, dots, underscores, or hyphens; do not include paths.`,
    );
  }
  return userId;
}

export function getUsersDir() {
  const configured = process.env.CAREER_OPS_USERS_DIR;
  if (!configured) return join(PROJECT_ROOT, 'users');
  return isAbsolute(configured) ? configured : resolve(PROJECT_ROOT, configured);
}

export function getUserContext(argv = process.argv.slice(2), { requireUser = true } = {}) {
  const parsed = stripUserArgs(argv);
  const userId = parsed.userId || process.env.CAREER_OPS_USER || '';

  if (!userId && !requireUser) {
    return {
      args: parsed.args,
      projectRoot: PROJECT_ROOT,
      usersDir: getUsersDir(),
      userId: '',
      userRoot: '',
    };
  }

  const validatedUser = validateUserId(userId);
  const usersDir = getUsersDir();
  const userRoot = join(usersDir, validatedUser);

  return {
    args: parsed.args,
    projectRoot: PROJECT_ROOT,
    usersDir,
    userId: validatedUser,
    userRoot,
  };
}

export function userPath(ctx, relativePath) {
  return join(ctx.userRoot, relativePath);
}

export function systemPath(...segments) {
  return join(PROJECT_ROOT, ...segments);
}

export function ensureUserDirs(ctx, relativeDirs) {
  for (const dir of relativeDirs) {
    mkdirSync(userPath(ctx, dir), { recursive: true });
  }
}

export function existingUserDataPath(ctx, preferredRelative, legacyRelative = null) {
  const preferred = userPath(ctx, preferredRelative);
  if (existsSync(preferred) || legacyRelative === null) return preferred;
  return systemPath(legacyRelative);
}

export function printUserContextErrorAndExit(err) {
  if (err instanceof UserContextError) {
    const scriptName = process.argv[1] ? basename(process.argv[1]) : 'script.mjs';
    console.error(`Error: ${err.message}`);
    console.error(`Example: node ${scriptName} --user <username>`);
    process.exit(1);
  }
  throw err;
}
