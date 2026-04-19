import { inspectTool } from './inspect.js';
import { applyChangesTool } from './apply-changes.js';
import { captureTool } from './capture.js';

// ─── Tool Registry ──────────────────────────────────────────────────────────
// The DOM-side tool surface. Keep it minimal and generic.
//   • inspect       — understand the page (overview / selector / text / regex)
//   • apply_changes — inject CSS and/or JS, self-verify, optionally persist
//   • capture       — screenshot (full viewport or cropped to selector)
//
// ask_user and done live in the agent loop, not here.

const TOOLS = [inspectTool, applyChangesTool, captureTool];

const toolMap = new Map(TOOLS.map(t => [t.definition.name, t]));

/** All tool definitions (for sending to the Claude API). */
export const TOOL_DEFINITIONS = TOOLS.map(t => t.definition);

/** Execute a tool by name. Returns the tool's result or an error object. */
export async function execTool(name, input) {
  const tool = toolMap.get(name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  return tool.execute(input);
}
