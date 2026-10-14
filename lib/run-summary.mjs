function compactTerminalValue(value, fallback, maxLength) {
  const text = String(value ?? fallback)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function runUnresolvedFindingLines(findings) {
  const items = Array.isArray(findings) ? findings : [];
  if (items.length === 0) return [];

  return [
    `[run] unresolved issues (${items.length}):`,
    ...items.map((finding) => {
      const level = compactTerminalValue(finding?.finding_level, 'unknown', 40);
      const code = compactTerminalValue(finding?.finding_code, 'unknown_finding', 120);
      const detail = compactTerminalValue(
        finding?.message || finding?.finding_id,
        'No details provided.',
        500,
      );
      return `[run] unresolved ${level}, ${code}: ${detail}`;
    }),
  ];
}
