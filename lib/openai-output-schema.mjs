const UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS = new Set([
  'uniqueItems',
]);

/**
 * Fail locally when a response schema uses a JSON Schema keyword that the
 * OpenAI Structured Outputs subset rejects before model inference.
 *
 * Keep semantic constraints that are outside that subset in the deterministic
 * post-response validator instead of weakening the application contract.
 */
export function assertOpenAIStructuredOutputSchema(schema, source = 'output schema') {
  function visit(value, path) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS.has(key)) {
        throw new Error(`${source} uses unsupported OpenAI Structured Outputs keyword ${key} at ${childPath}`);
      }
      visit(child, childPath);
    }
  }

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`${source} must be a JSON object`);
  }
  visit(schema, '$');
  return schema;
}

export function assertUniqueArrayValues(values, label) {
  if (!Array.isArray(values) || new Set(values).size !== values.length) {
    throw new Error(`${label} must contain unique values`);
  }
}
