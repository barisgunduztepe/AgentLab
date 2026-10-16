import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DocumentSearchTool } from "./document-search-tool";
import { DOCUMENT_CORPUS, DOCUMENT_CORPUS_VERSION } from "./document-search-corpus";
import { createTools, publicTools, type ToolId } from "./tool-registry";
import { validateToolDefinition } from "../agent/model-contract";
import { SingleAgent } from "../agent/single-agent";
import { FakeModelProvider } from "../agent/providers/fake-model-provider";

const tool = new DocumentSearchTool();
const search = async (query: string) => JSON.parse(await tool.execute({ query }));

describe("fixed document search", () => {
  it("uses the supported schema and immutable bounded corpus", () => {
    expect(() => validateToolDefinition(tool.definition)).not.toThrow();
    expect(DOCUMENT_CORPUS_VERSION).toBe("agentlab-docs-v1");
    expect(DOCUMENT_CORPUS).toHaveLength(8);
    expect(new Set(DOCUMENT_CORPUS.map((document) => document.id)).size).toBe(8);
    expect(Object.isFrozen(DOCUMENT_CORPUS)).toBe(true);
    for (const document of DOCUMENT_CORPUS) {
      expect(Object.isFrozen(document)).toBe(true);
      expect(document.id).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(document.title.length).toBeLessThanOrEqual(80);
      expect(document.text.length).toBeLessThanOrEqual(500);
      expect(JSON.stringify(document)).toMatch(/^[\x00-\x7f]+$/);
    }
    expect(createHash("sha256").update(JSON.stringify(DOCUMENT_CORPUS)).digest("hex")).toMatchInlineSnapshot(`"35051bb19b325f9691fd2e035e2311172043c67046a31f54bcf2b1debfccfc1e"`);
    expect(DOCUMENT_CORPUS[0].text).not.toContain("dock-r2");
    expect(DOCUMENT_CORPUS[2].text).toContain("superseded by policy-saffron-current");
    expect(DOCUMENT_CORPUS[3].text).toContain("supersedes policy-saffron-old");
  });

  it.each([null, [], 1, "query", {}, { query: 1 }, { query: "" }, { query: " " }, { query: "!!!" },
    { query: "şğı" }, { query: "a".repeat(121) }, { query: "a b c d e f g h i" }, { query: "x", extra: true },
    { query: "x\ny" }, { query: "x\ty" }, { query: "x\u007fy" }, Object.create({ query: "policy" })])
    ("rejects invalid input %j", async (input) => {
      expect(tool.validateInput(input)).toBe(false);
      await expect(tool.execute(input as { query: string })).rejects.toThrow("Invalid document search arguments.");
    });
  it.each(["a".repeat(120), " policy POLICY ", "a b c d e f g h", " route-amber "])("accepts boundary query %s", (query) => {
    expect(tool.validateInput({ query })).toBe(true);
  });
  it("requires query to be the sole enumerable own key", () => {
    const input = Object.defineProperty({ extra: true }, "query", { value: "policy" });
    expect(tool.validateInput(input)).toBe(false);
  });
  it.each([
    ["route-amber", ["route-amber", "route-amberly"]],
    ["sheet-k7", ["sheet-k7", "route-amber"]],
    ["policy saffron", ["policy-saffron-current", "policy-saffron-old"]],
    ["order-cobalt", ["order-cobalt"]],
    ["rate-m4", ["rate-m4", "order-cobalt"]],
    ["amberly", ["route-amberly"]],
    ["nonexistent", []],
  ])("returns stable full documents for %s", async (query, expected) => {
    const result = await search(query as string);
    expect(result.results.map((document: { id: string }) => document.id)).toEqual(expected);
    expect(result.totalMatches).toBe(expected.length);
    expect(result.truncated).toBe(false);
    for (const document of result.results) expect(DOCUMENT_CORPUS).toContainEqual(document);
  });
  it("deduplicates tokens, enforces AND and reports truncation without cutting JSON", async () => {
    expect(await search(" POLICY policy SAFFRON ")).toEqual(await search("policy saffron"));
    expect((await search("policy")).results).toHaveLength(3);
    const broad = await search("the");
    expect(broad.totalMatches).toBeGreaterThan(3);
    expect(broad.results).toHaveLength(3);
    expect(broad.truncated).toBe(true);
    expect((await search("policy cobalt")).totalMatches).toBe(0);
    for (const document of DOCUMENT_CORPUS) {
      const output = await tool.execute({ query: document.id });
      expect(Buffer.byteLength(output, "utf8")).toBeLessThanOrEqual(8192);
      expect(Object.keys(JSON.parse(output))).toEqual(["results", "totalMatches", "truncated"]);
    }
  });
  it("has no external access paths in either runtime module", async () => {
    for (const file of ["document-search-tool.ts", "document-search-corpus.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/\b(?:fetch|process|require|eval)\s*[.(]|import\s*\(|node:|from\s+["'](?:fs|http|https|net|child_process)["']/);
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
      expect(imports.every((path) => ["../agent/cancellation", "../agent/model-completion", "./document-search-corpus", "./tool"].includes(path))).toBe(true);
    }
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    try {
      await search("https://example.invalid/policy");
      await search("C:/Users/secret.txt");
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });
  it("honors pre-abort and agent lifecycle cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(tool.execute({ query: "policy" }, { signal: controller.signal })).rejects.toMatchObject({ failureCode: "cancelled" });
    for (const boundary of ["tool.started", "tool.completed"]) {
      const pending = new AbortController();
      const provider = new FakeModelProvider([{ type: "tool_call", call: { callId: "one", toolName: "document_search", arguments: { query: "policy" } } }]);
      const complete = vi.spyOn(provider, "complete");
      await expect(new SingleAgent(provider, [tool]).run("Search policy", (event) => {
        if (event.type === boundary) pending.abort();
      }, undefined, { signal: pending.signal })).rejects.toMatchObject({ failureCode: "cancelled" });
      expect(complete).toHaveBeenCalledTimes(1);
    }
  });
  it("creates isolated instances and definitions and validates registry IDs", () => {
    const first = createTools(["document_search", "calculator"]);
    const second = createTools(["document_search", "calculator"]);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0].definition).not.toBe(second[0].definition);
    first[0].definition.parameters.properties.query.description = "Changed";
    expect(second[0].definition.parameters.properties.query.description).not.toBe("Changed");
    expect(() => createTools(["calculator", "calculator"])).toThrow("Duplicate");
    expect(() => createTools(["unknown" as ToolId])).toThrow("Unknown");
    expect(() => createTools(["toString" as ToolId])).toThrow("Unknown");
    expect(publicTools(["document_search", "calculator"])).toEqual([{ id: "document_search", label: "document_search" }, { id: "calculator", label: "calculator" }]);
  });
});
