import { throwIfCancelled } from "../agent/cancellation";
import type { JsonObject } from "../agent/model-completion";
import { DOCUMENT_CORPUS } from "./document-search-corpus";
import type { Tool, ToolDefinition } from "./tool";

const tokens = (text: string) => [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])];

export class DocumentSearchTool implements Tool {
  definition: ToolDefinition = {
    name: "document_search",
    description: "Search the fixed fictional AgentLab document collection by document ID or keywords. All query terms must match. Returns up to three complete short documents. No web or filesystem access.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "A document ID or 1-8 English keyword tokens; at most 120 characters. Search referenced document IDs in a later response after reading the current result." } },
      required: ["query"],
      additionalProperties: false,
    },
  };

  validateInput(input: unknown): boolean {
    if (typeof input !== "object" || input === null || Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).length !== 1 || Object.keys(input)[0] !== "query" || !Object.hasOwn(input, "query")) return false;
    const query = (input as Record<string, unknown>).query;
    if (typeof query !== "string" || query.length < 1 || query.length > 120 || /[\u0000-\u001f\u007f]/.test(query)) return false;
    const count = tokens(query.trim()).length;
    return count >= 1 && count <= 8;
  }

  async execute(input: JsonObject, options: { signal?: AbortSignal } = {}): Promise<string> {
    throwIfCancelled(options.signal);
    if (!this.validateInput(input)) throw new Error("Invalid document search arguments.");
    const query = (input.query as string).trim().toLowerCase();
    const terms = tokens(query);
    const matches = DOCUMENT_CORPUS.filter((document) => {
      throwIfCancelled(options.signal);
      const words = new Set(tokens(`${document.id} ${document.title} ${document.text}`));
      return terms.every((term) => words.has(term));
    }).sort((left, right) => {
      if (left.id === query) return -1;
      if (right.id === query) return 1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
    const output = JSON.stringify({ results: matches.slice(0, 3), totalMatches: matches.length, truncated: matches.length > 3 });
    if (new TextEncoder().encode(output).byteLength > 8192) throw new Error("Document search output exceeds limit.");
    throwIfCancelled(options.signal);
    return output;
  }
}
