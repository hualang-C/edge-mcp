// Shared wrapper for tool handlers, used by every tool module.
//
// Tool bodies return plain values (strings or JSON-serializable objects);
// this wrapper turns them into MCP content blocks and converts thrown
// errors into isError responses instead of letting them escape as protocol
// errors.

/**
 * Run a tool body and wrap the result as an MCP tool result. Never throws.
 *
 * JSON.stringify(undefined) returns undefined (not a string), which would
 * produce an invalid `text: undefined` content block that the SDK rejects;
 * the String() fallback keeps undefined/null results serializable.
 */
export async function runTool(fn) {
  try {
    const result = await fn();
    const text =
      typeof result === "string"
        ? result
        : (JSON.stringify(result, null, 2) ?? String(result));
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
}
