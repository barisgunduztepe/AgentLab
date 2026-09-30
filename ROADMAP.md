# AgentLab Roadmap

Bu belge, AgentLab'in mevcut repository durumunu ve onaylanmış geliştirme sırasını kaydeder. Tamamlandı işaretleri dosya varlığına değil, çalışan bağlantılara ve mevcut test kapsamına dayanır.

## Mevcut checkpoint

- v0.1 Single Agent Foundation tamamlandı.
- v0.2 Tool System tamamlandı; v0.2.1–v0.2.5 exit checkpoint'i geçti.
- v0.2.4 Tool Observability tamamlandı.
- API route aktif akışta `FakeModelProvider` kullanıyor.
- `OpenAIModelProvider` ve `GroqModelProvider` implementasyonları mevcut; aktif uygulama akışına bağlı değiller.
- Sıradaki milestone: **v0.3.1 Structured Tool-Call Contract**.

## v0.1 — Single Agent Foundation

**Durum: ✅ Tamamlandı**

- ✅ **v0.1.1 Next.js ve TypeScript iskeleti** — App Router, `src/`, ESLint ve npm başlangıç yapısı.
- ✅ **v0.1.2 Domain ve ModelProvider sınırı** — Experiment tipleri ve küçük provider interface'i.
- ✅ **v0.1.3 FakeModelProvider ve SingleAgent** — Provider'dan metin alan tek agent.
- ✅ **v0.1.4 Experiment Runner** — Lifecycle, süre, çıktı ve güvenli hata sonucu.
- ✅ **v0.1.5 API / SSE** — Görev alan POST route'u ve olay akışı.
- ✅ **v0.1.6 Minimal UI** — Görev girişi, durum, olaylar, sonuç ve hata alanı.
- ✅ **v0.1.7 Çekirdek testleri** — SingleAgent ve Experiment Runner davranış testleri.

### Provider hazırlığı

OpenAI ve Groq provider dosyaları mevcuttur. Aktif uygulama akışı ikisini de kullanmaz; API route `FakeModelProvider` ile çalışır.

## v0.2 — Tool System

**Durum: ✅ Tamamlandı**

- ✅ **v0.2.1 Tool Contract** — `Tool` interface'i.
- ✅ **v0.2.2 CalculatorTool** — Sınırlı aritmetik hesaplayıcı ve testleri.
- ✅ **v0.2.3 Tool Injection + Deterministic Routing** — Route calculator'ı oluşturup `Tool[]` olarak SingleAgent'a verir; aritmetik görevleri araçla, diğer görevleri provider ile işler.

### ✅ v0.2.4 Tool Observability

**Amaç:** Tool çalışmasını experiment event stream içinde görünür kılmak.

Planlanan event'ler:

- `tool.started`
- `tool.completed`
- `tool.failed`

Event payload'ı varsayılan olarak tool input/output içeriklerini taşımaz. Tool adı, lifecycle bilgisi ve gerekli güvenli metadata yeterlidir.

**Done kriterleri:**

- ✅ Matematik görevinde `tool.started` görünür.
- ✅ Başarılı tool çalışmasında `tool.completed` görünür.
- ✅ Tool hatasında `tool.failed` görünür.
- ✅ Normal metin görevinde tool event'i oluşmaz.
- ✅ Event sırası test edilir.
- ✅ UI'da manuel doğrulama yapılır.
- ✅ Testler, lint ve build başarılı olur.

### ✅ v0.2.5 Tool System Exit Checkpoint

**Amaç:** v0.2'yi çalışan ve test edilmiş bir checkpoint olarak kapatmak.

**Doğrulama sonuçları:**

- ✅ Full test suite: 3 dosya / 15 test.
- ✅ Lint.
- ✅ Production build ve build içindeki TypeScript kontrolü.
- ✅ `git diff --check` (exit code 0).
- ✅ Calculator canlı UI smoke testi: `tool.started — calculator`, `tool.completed — calculator`, sonuç `96`.
- ✅ Non-tool canlı UI smoke testi: `tool.*` eventi oluşmadı; model-provider yolu kullanıldı.

**Sonuç:** v0.2 Tool System exit checkpoint kriterlerini geçti.

## v0.3 — Intelligent Tool Use

### 👉 v0.3.1 Structured Tool-Call Contract

**Amaç:** Modelin metin yanıtına ek olarak yapılandırılmış tool isteği döndürebilmesini tanımlamak.

### ⬜ v0.3.2 Bounded Tool Execution Loop

**Amaç:** İzin verilen tool çağrısını sınırlı sayıda yürütmek, sonucu modele geri vermek ve bilinmeyen tool/hatalı çağrı davranışını belirlemek.

### ⬜ v0.3.3 Tek Gerçek Provider ile Tool Calling Doğrulaması

**Amaç:** Yapılandırılmış tool-call akışını bir gerçek provider ile kontrollü biçimde doğrulamak. Fake/test yolu korunur.

Bu sürümde multi-agent yoktur. Iteration/call limitleri zorunludur.

## v0.4 — Deterministic Scenarios & Simple Evaluation

### ⬜ v0.4.1 Sabit deney senaryoları

**Amaç:** Aynı görev ve koşulları tekrarlanabilir şekilde çalıştırmak. İlk senaryolar test/fixture olarak kalabilir.

### ⬜ v0.4.2 Basit pass/fail evaluation

**Amaç:** Açık ve hafif assertion'larla sonuçları değerlendirmek.

Ağır benchmark framework veya LLM-as-judge eklenmez.

## v0.5 — Multi-Agent Foundation

### ⬜ v0.5.1 İki agent arasında kontrollü handoff

**Amaç:** Tek ve sınırları belli bir görev aktarımını göstermek.

### ⬜ v0.5.2 Multi-agent lifecycle ve event akışı

**Amaç:** Agent katkılarını, handoff'u ve hataları gözlemlenebilir kılmak.

İlk hedef swarm değildir.

## v0.6 — Experiment History

### ⬜ v0.6.1 Yerel deney kaydı

**Amaç:** Şema ve saklama sınırı belirlendikten sonra deney sonuçlarını yerel olarak korumak.

### ⬜ v0.6.2 Geçmiş listesi ve deney ayrıntısı

**Amaç:** Kaydedilmiş deneyleri bulup sonuç ve event'lerini incelemek.

İlk hedef cloud database değildir.

## v0.7 — Agent Arena / Comparison

### ⬜ v0.7.1 Aynı senaryoda iki agent configuration

**Amaç:** Aynı senaryodaki en az iki agent yapılandırmasını karşılaştırılabilir koşullarda çalıştırmak.

### ⬜ v0.7.2 Temel karşılaştırma metrikleri

**Amaç:** Önce güvenilir başarı durumu ve duration ölçülerini yan yana göstermek. Maliyet ancak provider güvenilir usage verisi sağlıyorsa eklenir.

Karmaşık dashboard veya grafikler bu milestone'un parçası değildir.

## v0.8 — Automation

### ⬜ v0.8.1 Kontrollü otomatik experiment çalıştırma

**Amaç:** Sınırlandırılmış tekrar/trigger akışı sağlamak. Çalıştırmalar ayrı kaydedilmeli ve açık durdurma davranışı olmalıdır.

## v1.0 — Usable AgentLab

### ⬜ v1.0.1 Release / Productization Checkpoint

**Amaç:** Desteklenen AgentLab akışlarını güvenilir, anlaşılır ve dokümante edilmiş hale getirmek.

## Development Principles

Her milestone şu sırayı izler:

1. Önce kavramı öğren.
2. Küçük implementasyon yap.
3. Test et.
4. Canlı doğrula.
5. Commit/checkpoint oluştur.
6. Sonra bir sonraki milestone'a geç.

Ek ilkeler:

- YAGNI uygula; premature abstraction yapma.
- Her milestone mümkün olduğunca tek ana kavram öğretsin.
- Milestone'lar küçük, test edilebilir ve geri alınabilir olsun.
- Gizli chain-of-thought gözlemlenmeye veya saklanmaya çalışılmasın.
- Tool input/output verileri varsayılan olarak event log'a yazılmasın.
- Güvenlik gereksinimleri ilgili capability eklendiğinde ele alınsın.
- OpenClaw mimari referans olabilir; entegrasyon hedefi değildir.

## Long-Term Target Architecture

Aşağıdaki çizim uzun vadeli hedefi gösterir; mevcut uygulamanın tamamlanmış mimarisi değildir.

```text
User
  ↓
Experiment / Scenario
  ↓
Agent Runtime
  ├── ModelProvider
  ├── Allowed Tools
  ├── Bounded Tool Selection / Execution Loop
  └── Optional Agent Handoff
          ↓
Observable Event Stream
          ↓
Result + Lightweight Evaluation
          ↓
Local Experiment History
          ↓
Controlled Agent / Provider Comparison
```
