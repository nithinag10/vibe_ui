import { extractDomTool } from './extract-dom.js';
import { querySelectorTool } from './query-selector.js';
import { checkDynamicTool } from './check-dynamic.js';
import { applyChangesTool } from './apply-changes.js';

// ─── Tool Registry ──────────────────────────────────────────────────────────
// To add a new tool:
// 1. Create src/content/tools/my-tool.js exporting { definition, execute }
// 2. Import and add it to the TOOLS array below
// 3. Add the tool name to the system prompt in src/background/prompts.js
// 4. Add a test in tests/content/tools/my-tool.test.js

const TOOLS = [
  extractDomTool,
  querySelectorTool,
  checkDynamicTool,
  applyChangesTool,
];

// Build a lookup map for O(1) tool dispatch
const toolMap = new Map(TOOLS.map(t => [t.definition.name, t]));

/** All tool definitions (for sending to the Claude API). */
export const TOOL_DEFINITIONS = TOOLS.map(t => t.definition);

/** Execute a tool by name. Returns the tool's result or an error object. */
export async function execTool(name, input) {
  const tool = toolMap.get(name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  return tool.execute(input);
}
