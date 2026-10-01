import { describe, expect, it } from "vitest";
import { getScenarioById, SCENARIOS } from "./scenarios";

describe("experiment scenario catalog", () => {
  it("contains the four fixed scenarios with stable identifiers and task metadata", () => {
    expect(SCENARIOS.map(({ id }) => id)).toEqual([
      "direct-text",
      "calculator-once",
      "calculator-three-steps",
      "unknown-tool-failure",
    ]);
    expect(SCENARIOS.every(({ title, description, task }) => Boolean(title && description && task))).toBe(true);
  });

  it("looks up known scenarios and does not provide a default for unknown IDs", () => {
    expect(getScenarioById("calculator-once")).toMatchObject({ id: "calculator-once" });
    expect(getScenarioById("not-a-scenario")).toBeUndefined();
  });
});
