/** An explicit empty object form asks for a decision, with no fields to answer. */
export function emptyApprovalForm(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const form = value as Record<string, any>, schema = form.requestedSchema;
  if (form.mode !== "form" || !schema || schema.type !== "object" || !schema.properties ||
      typeof schema.properties !== "object" || Array.isArray(schema.properties) || Object.keys(schema.properties).length) return false;
  const supported = new Set(["type", "properties", "required", "additionalProperties", "title", "description", "$schema", "minProperties", "maxProperties"]);
  return Object.keys(schema).every(key => supported.has(key)) &&
    (schema.required === undefined || Array.isArray(schema.required) && schema.required.length === 0) &&
    (schema.minProperties === undefined || schema.minProperties === 0);
}
/** Compatibility for a worker already waiting on an empty MCP approval form. Never grants a decision. */
export function approvalWireAnswer(row: {tool: string; details: string; decision?: string; answer?: string}): string | undefined {
  if (row.decision !== "allow" || row.answer !== undefined || row.tool !== "MCP user input") return row.answer;
  try { return emptyApprovalForm(JSON.parse(row.details)) ? "{}" : undefined; } catch { return undefined; }
}
