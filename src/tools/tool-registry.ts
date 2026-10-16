import { CalculatorTool } from "./calculator-tool";
import { DocumentSearchTool } from "./document-search-tool";
import type { Tool } from "./tool";

export const TOOL_FACTORIES = {
  calculator: () => new CalculatorTool(),
  document_search: () => new DocumentSearchTool(),
};
export type ToolId = keyof typeof TOOL_FACTORIES;

export function createTools(ids: readonly ToolId[]): Tool[] {
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate tool ID.");
  return ids.map((id) => {
    if (!Object.hasOwn(TOOL_FACTORIES, id)) throw new Error("Unknown tool ID.");
    const tool = TOOL_FACTORIES[id]();
    if (tool.definition.name !== id) throw new Error("Tool name does not match registry ID.");
    return tool;
  });
}

export function publicTools(ids: readonly ToolId[]): { id: ToolId; label: string }[] {
  return ids.map((id) => {
    if (!Object.hasOwn(TOOL_FACTORIES, id)) throw new Error("Unknown tool ID.");
    return { id, label: id };
  });
}
