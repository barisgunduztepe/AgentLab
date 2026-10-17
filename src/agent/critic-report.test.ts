import { describe, expect, it } from "vitest";
import { MAX_AUDIT_BYTES, parseCriticReport } from "./critic-report";

describe("bounded Critic report", () => {
  it.each(["no_issue", "issues_found", "insufficient_evidence"] as const)("accepts %s without adding fields", (verdict) => {
    const value = { verdict, issues: verdict === "no_issue" ? [] : [{ kind: "evidence_gap", message: "Missing support.", evidenceId: 1 }] };
    expect(parseCriticReport(JSON.stringify(value), 1)).toEqual(value);
  });
  it.each([
    "not JSON", "```json\n{}\n```", "null", "[]", JSON.stringify({ verdict: "no_issue" }),
    JSON.stringify({ verdict: "no_issue", issues: [], extra: true }),
    JSON.stringify({ verdict: "invalid", issues: [] }),
    JSON.stringify({ verdict: "issues_found", issues: [] }),
    JSON.stringify({ verdict: "no_issue", issues: [{ kind: "inconsistency", message: "Conflict", evidenceId: null }] }),
    JSON.stringify({ verdict: "issues_found", issues: Array(6).fill({ kind: "evidence_gap", message: "Gap", evidenceId: null }) }),
    " ".repeat(MAX_AUDIT_BYTES + 1),
  ])("rejects invalid envelope %s", (value) => expect(parseCriticReport(value, 1)).toBeUndefined());
  it.each([
    { kind: "unknown", message: "Gap", evidenceId: null },
    { kind: "evidence_gap", message: "", evidenceId: null },
    { kind: "evidence_gap", message: "a".repeat(241), evidenceId: null },
    { kind: "evidence_gap", message: "bad\u0000", evidenceId: null },
    { kind: "evidence_gap", message: "Gap", evidenceId: 0 },
    { kind: "evidence_gap", message: "Gap", evidenceId: 2 },
    { kind: "evidence_gap", message: "Gap", evidenceId: 1.5 },
    { kind: "evidence_gap", message: "Gap", evidenceId: "1" },
    { kind: "evidence_gap", message: "Gap", evidenceId: null, extra: true },
  ])("rejects invalid issue %#", (issue) => {
    expect(parseCriticReport(JSON.stringify({ verdict: "issues_found", issues: [issue] }), 1)).toBeUndefined();
  });
  it("allows a null reference with no evidence and escaped display text", () => {
    const report = { verdict: "insufficient_evidence", issues: [{ kind: "evidence_gap", message: "<script>not executed</script>", evidenceId: null }] };
    expect(parseCriticReport(JSON.stringify(report), 0)).toEqual(report);
  });
});
