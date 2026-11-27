import type { AgentMap } from "./agent-session";

/**
 * Text for a model: everything as compact JSON except the map, which reads
 * better as lines. Shared by the in-game agent; the MCP server has the same
 * format (scripts/mcp/headless-server.mjs).
 */
export function formatForModel(value: unknown): string {
  if (!value || typeof value !== "object" || !("map" in value) || !(value as { map?: AgentMap }).map) {
    return JSON.stringify(value);
  }
  const { map, ...rest } = value as { map: AgentMap } & Record<string, unknown>;
  const lines = map.rows.length ? [map.ruler, ...map.rows].join("\n") : "(nothing seen yet)";
  return `${JSON.stringify(rest)}\n\nMap (row label = y, ruler = x mod 10, x starts at ${map.x0}):\n${lines}`;
}
