import { inspectTool } from './inspect.js';
import { applyChangesTool } from './apply-changes.js';
import { captureTool } from './capture.js';
import { mapPageTool } from './map-page.js';
import { confirmSelectorTool } from './confirm-selector.js';

// ─── Tool Registry ──────────────────────────────────────────────────────────
// The DOM-side tool surface. Keep it minimal and generic.
//   • map_page         — framework + semantics + top-level sections (auto-called at start)
//   • inspect          — understand the page (overview / selector / text / regex)
//   • confirm_selector — required gate before apply_changes
//   • apply_changes    — inject CSS and/or JS, self-verify (visual for layout changes)
//   • capture          — screenshot (full viewport or cropped to selector)
//
// ask_user and done live in the agent loop, not here.

const TOOLS = [mapPageTool, inspectTool, confirmSelectorTool, applyChangesTool, captureTool];

const toolMap = new Map(TOOLS.map(t => [t.definition.name, t]));

/** All tool definitions (for sending to the Claude API). */
export const TOOL_DEFINITIONS = TOOLS.map(t => t.definition);

/** Execute a tool by name. Returns the tool's result or an error object. */
export async function execTool(name, input) {
  const tool = toolMap.get(name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  return tool.execute(input);
}
