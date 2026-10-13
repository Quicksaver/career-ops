import path from "node:path";

/** Resolve system code independently of the selected user's data. */
export function careerOpsSystemRoot() {
  const configured = process.env.CAREER_OPS_CODE_ROOT?.trim() || process.env.CAREER_OPS_ROOT?.trim();
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), "..");
}

/** Require the same user-ID format as the core CLI resolver. */
export function careerOpsUserId() {
  const id = process.env.CAREER_OPS_USER?.trim();
  if (!id) {
    throw new Error("No career-ops user selected. Set CAREER_OPS_USER=<username> in web/.env.local before starting the web app.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new Error("Invalid CAREER_OPS_USER. Use 1-64 characters, starting with a letter or number, followed by letters, numbers, dots, underscores, or hyphens.");
  }
  return id;
}

export function careerOpsUsersRoot() {
  const configured = process.env.CAREER_OPS_USERS_DIR?.trim();
  return configured ? path.resolve(careerOpsSystemRoot(), configured) : path.join(/* turbopackIgnore: true */ careerOpsSystemRoot(), "users");
}

export function careerOpsRoot() {
  const id = careerOpsUserId();
  const data = process.env.CAREER_OPS_DATA_DIR?.trim();
  return data ? path.resolve(careerOpsSystemRoot(), data) : path.join(careerOpsUsersRoot(), id);
}

/** @returns {NodeJS.ProcessEnv} */
export function careerOpsCoreEnv() {
  return { ...process.env, CAREER_OPS_USER: careerOpsUserId(), CAREER_OPS_USERS_DIR: careerOpsUsersRoot(), CAREER_OPS_CODE_ROOT: careerOpsSystemRoot(), CAREER_OPS_ROOT: careerOpsRoot(), CAREER_OPS_DATA_DIR: careerOpsRoot() };
}
