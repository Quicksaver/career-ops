/** Active-user data resolution; code/data environment aliases cannot select a root user. */
export function resolveDataRoot(coreRoot, readMarker, env, resolve, join) {
  const id = env.CAREER_OPS_USER?.trim();
  if (!id) throw new Error('No career-ops user selected. Set CAREER_OPS_USER=<username>.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error('Invalid CAREER_OPS_USER.');
  const data = env.CAREER_OPS_DATA_DIR?.trim();
  if (data) return resolve(coreRoot, data);
  const users = env.CAREER_OPS_USERS_DIR?.trim();
  if (!users) {
    const marker = readMarker()?.trim();
    if (marker) return resolve(coreRoot, marker);
  }
  return join(resolve(coreRoot, users || 'users'), id);
}
