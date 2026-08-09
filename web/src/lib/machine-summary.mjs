import yaml from "js-yaml";

/**
 * @typedef {{
 *   nextAction: string | null;
 *   hardStops: string[];
 *   softGaps: string[];
 *   topStrengths: string[];
 * }} MachineSummarySignals
 */

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Read the user-facing verdict and decision-signal lists from the fenced YAML
 * under a Machine Summary heading. Invalid, missing, or differently shaped
 * machine data is ignored so legacy reports continue to render normally.
 *
 * @param {string} markdown
 * @returns {MachineSummarySignals | null}
 */
export function parseMachineSummarySignals(markdown) {
  const heading = /^#{2,6}\s+Machine Summary\s*$/im.exec(markdown);
  if (!heading) return null;

  const tail = markdown.slice(heading.index + heading[0].length);
  const nextHeading = tail.search(/^#{1,6}\s+/m);
  const section = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
  const fence = section.match(/```(?:ya?ml)?[ \t]*\r?\n([\s\S]*?)```/i);
  if (!fence) return null;

  try {
    const parsed = yaml.load(fence[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const nextAction = optionalString(parsed.next_action);
    const hardStops = stringList(parsed.hard_stops);
    const softGaps = stringList(parsed.soft_gaps);
    const topStrengths = stringList(parsed.top_strengths);
    if (!nextAction && hardStops.length + softGaps.length + topStrengths.length === 0) return null;

    return { nextAction, hardStops, softGaps, topStrengths };
  } catch {
    return null;
  }
}
