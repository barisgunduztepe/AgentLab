import { AUDIT_BUDGET, type AuditProgress } from "../agent/critic-report";
import type { ComparisonMetrics } from "../experiments/comparison-metrics";
import type { ExperimentRunMetadata } from "../experiments/experiment-history";

export function MetricsPanel({ metrics }: { metrics: ComparisonMetrics }) {
  const value = (n: number | null) => n === null ? "Bilinmiyor" : String(n);
  return <div>
    <p>Model requested/responded: {metrics.modelRequested}/{metrics.modelResponded} · Tool started/completed/failed: {metrics.toolStarted}/{metrics.toolCompleted}/{metrics.toolFailed}</p>
    <p>Bilinen token alt toplamı (in/out/total): {value(metrics.knownTokens.input)}/{value(metrics.knownTokens.output)}/{value(metrics.knownTokens.total)} · Bilinmeyen/eksik usage: {metrics.unknownUsageCalls} çağrı</p>
    <p>Para maliyeti: hesaplanamadı.</p>
  </div>;
}

export function AuditPanel({ audit, run, historical = false }: { audit?: AuditProgress; run?: ExperimentRunMetadata; historical?: boolean }) {
  return <aside aria-label="Critic denetimi" style={{ padding: 12, margin: "8px 0", border: "1px solid #b9ccf5", borderRadius: 6 }}>
    <strong>Critic — audit-only</strong>
    <p>Critic kararı uygulanmadı; üretici yanıtı revize edilmez. Evaluator bağımsızdır.</p>
    <p>Üretici ve Critic aynı model: {run?.provider === "fake" ? "FAKE (canlı doğrulama değil)" : run?.model ?? "Bilinmiyor"}.</p>
    <p>Planlanan üst sınır: üretici ≤{AUDIT_BUDGET.producerModelCalls} + Critic ≤{AUDIT_BUDGET.criticModelCalls} model çağrısı; toplam ≤{AUDIT_BUDGET.toolExecutions} araç. Süre/token/para tavanı değildir.</p>
    {historical ? <p>Denetim raporu bu şemada saklanmıyor. Verdict olaylardan tahmin edilmez.</p> : <>
      <p>Faz: {audit?.phase ?? "producer"} · Audit status: {audit?.status ?? "not_started"} · Gözlenen üretici/Critic çağrısı: {audit?.producerModelCalls ?? 0}/{audit?.criticModelCalls ?? 0}</p>
      {audit?.status === "completed" && audit.report ? <>
        <p>Verdict: {audit.report.verdict}</p>
        <ul>{audit.report.issues.map((issue, index) => <li key={index}>{issue.kind}: {issue.message} · Kanıt: {issue.evidenceId ?? "yok"}</li>)}</ul>
      </> : audit?.status === "invalid_report" ? <p>Geçersiz denetim raporu; içerik gösterilmez. Denetim arızası koşuyu başarısız kıldı; otomatik repair/retry yok.</p> : null}
      <p>Geçici rapor: sayfa yenilenince kaybolur; history v3 içinde saklanmaz.</p>
    </>}
  </aside>;
}
