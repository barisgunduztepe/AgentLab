# AgentLab Roadmap

Bu belge, AgentLab'in mevcut repository durumunu ve onaylanmış geliştirme sırasını kaydeder. Tamamlandı işaretleri dosya varlığına değil, çalışan bağlantılara ve mevcut test kapsamına dayanır.

## Mevcut checkpoint

- v0.1 Single Agent Foundation tamamlandı.
- v0.2 Tool System tamamlandı; v0.2.1–v0.2.5 exit checkpoint'i geçti.
- v0.2.4 Tool Observability tamamlandı.
- API route provider'ı `AGENTLAB_MODEL_PROVIDER=fake|openai|gemini` ayarından açıkça seçiyor; eksik/geçersiz ayarda fallback yapmıyor.
- `OpenAIModelProvider` Responses API, `GeminiModelProvider` Gemini Interactions API ile yalnızca calculator function calling yapıyor; `GroqModelProvider` bu milestone'larda kullanılmıyor.
- v0.3.1 Structured Tool-Call Contract tamamlandı.
- v0.3.2 Bounded Tool Execution Loop tamamlandı.
- v0.3.3 OpenAI tool calling implementasyonu ve otomatik doğrulamaları tamamlandı; hesapta $0.00 API kredisi olduğundan gerçek API smoke testi yapılmadı ve canlı davranış doğrulanmadı.
- v0.3.4 Gemini provider implementasyonu tamamlandı; SDK davranışı mock testlerle doğrulandı. Manuel REST kontrolünde toolsuz Interactions isteği başarılı oldu; aynı calculator tool şemalı istek farklı denemelerde hem başarılı oldu hem de geçici yüksek talep kaynaklı `503 service_unavailable` aldı. AgentLab'in canlı SDK tool-calling davranışı doğrulanmadı; yeni smoke testleri ertelendi.
- v0.3.5 Provider Resilience implementasyonu tamamlandı; provider-neutral retry decorator'ı OpenAI ve Gemini'yi sarıyor, FakeModelProvider'ı sarmıyor. Otomatik doğrulama mock tabanlıdır; canlı Gemini smoke testi yapılmadı.
- v0.4.1 Fixed Experiment Scenarios uygulaması ve otomatik doğrulamaları tamamlandı; Gemini canlı smoke testleri hâlâ ertelenmiştir.
- Sonraki planlı milestone: **v0.4.2 Basit pass/fail evaluation**.

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

### ✅ v0.3.1 Structured Tool-Call Contract

**Amaç:** Modelin metin yanıtına ek olarak yapılandırılmış tool isteği döndürebilmesini tanımlamak.

**Durum:** Tamamlandı. `ModelProvider` text/tool-call yanıtlarını ortak type-safe contract ile taşıyor; `SingleAgent` tool-call isteğini çalıştırmadan koruyor. Deney çıktısı tool argümanlarını event akışına eklemeden isteği ve çalıştırılmadığı bilgisini gösteriyor. Testler, lint, TypeScript kontrolü ve production build başarılı oldu.

### ✅ v0.3.2 Bounded Tool Execution Loop

**Amaç:** İzin verilen tool çağrısını sınırlı sayıda yürütmek, sonucu modele geri vermek ve bilinmeyen tool/hatalı çağrı davranışını belirlemek.

**Durum:** Tamamlandı. `SingleAgent` structured tool-call'ları en fazla üç kez çalıştırıp her sonucu provider-neutral continuation prompt'u ile modele iletiyor; unknown/invalid çağrılar çalıştırılmadan, tool execution hataları güvenli experiment failure ile sonlanıyor. Lifecycle event'leri tool input/output içermiyor. Testler, lint, TypeScript kontrolü ve production build başarılı oldu.

### 🟡 v0.3.3 Tek Gerçek Provider ile Tool Calling

**Amaç:** Yapılandırılmış tool-call akışını bir gerçek provider ile kontrollü biçimde doğrulamak. Fake/test yolu korunur.

**Uygulama:** OpenAI Responses API function calling yalnızca mevcut calculator tool için etkinleştirildi. Provider `call_id` ve `previous_response_id` eşleşmesini kendi içinde yönetir; `SingleAgent` provider-neutral `callId` ve tool sonucuyla devam eder. Üç tool execution limiti korunur. Çoklu function call ve hatalı argümanlar güvenli failure üretir. Provider seçimi için `AGENTLAB_MODEL_PROVIDER=fake|openai`, OpenAI modu için server-side `OPENAI_API_KEY` ve `OPENAI_MODEL` zorunludur. Silent fallback yoktur.

Calculator function schema'sı bilinçli olarak OpenAI provider içinde tanımlıdır; ikinci tool eklenirken schema'yı `Tool` sözleşmesine taşıma kararı yeniden değerlendirilecektir. FakeModelProvider testlerde korunur. SDK testleri mock'tur ve otomatik testler gerçek API ağına çıkmaz. UI, multi-provider desteği ve token streaming bu kapsamda değildir.

**Doğrulama:** 7 test dosyası / 43 test başarılı; lint uyarısız; production build ve `git diff --check` başarılı. Hesapta $0.00 API kredisi olduğundan gerçek API smoke testi yapılmadı; bu nedenle canlı OpenAI davranışı doğrulanmış değildir.

### 🟡 v0.3.4 Gemini Free Tier Provider

**Uygulama:** Google'ın resmi `@google/genai` SDK'sı Interactions API üzerinden calculator native function calling için kullanılır. Provider `GEMINI_API_KEY` ve `GEMINI_MODEL` değerlerini server-side environment'tan okur. Seçim `AGENTLAB_MODEL_PROVIDER=gemini` ile açıktır; sessiz fallback yoktur. Gemini function-call ID, provider içinde saklanan interaction ID ve `function_result.call_id` ile eşleştirilir. Ortak `ModelProvider` sözleşmesi ve `SingleAgent` değişmeden kalır. Tek yanıt başına bir tool call ve en fazla üç tool execution sınırları korunur.

**Doğrulama durumu:** Provider SDK davranışı mock testlerle kapsanmıştır; otomatik testler ağa çıkmaz. Manuel REST kontrolünde toolsuz istek başarılı; eşdeğer calculator tool şemalı istekler farklı denemelerde başarılı olmuş veya geçici `503 service_unavailable` kapasite hatası döndürmüştür. AgentLab'in canlı SDK tool-calling davranışı başarılı smoke test ile doğrulanmamıştır. Retry/backoff v0.3.4 kapsamına dahil değildi. Calculator schema'sı bu milestone için provider içinde tutulur; yeni tool eklenirken `Tool` sözleşmesine taşıma yeniden değerlendirilecektir.

### 🟡 v0.3.5 Provider Resilience

**Amaç:** Geçici gerçek-provider istek hatalarında sınırlı ve provider-neutral retry sağlamak; kalıcı, yapılandırma, auth, abort ve belirsiz hataları tekrar etmemek.

**Uygulama:** `RetryingModelProvider`, `ModelProvider` sözleşmesini değiştirmeden OpenAI ve Gemini provider'larını sarar. Fake provider deterministik kalır ve sarılmaz. Üç toplam deneme, 500 ms başlangıç backoff cap'i, 2 kat exponential factor, 4000 ms üst cap ve full jitter uygulanır. Retry-After ve provider/model fallback kapsam dışıdır. SDK dahili retry'ları OpenAI `maxRetries: 0` ve Gemini Interactions request `maxRetries: 0` ile kapatılır.

**Hata sınıflandırması:** Provider adaptörleri yapılandırılmış SDK alanları kullanır; ham hata metni incelenmez. 408/500/502/503/504 retry edilir. OpenAI 429 yalnızca `rate_limit_exceeded` koduyla; Gemini 429 yalnızca açık `RATE_LIMIT_EXCEEDED` kod/reason alanıyla retry edilir. Belirsiz Gemini `RESOURCE_EXHAUSTED` 429 retry edilmez. Tanınmış connection/timeout hataları retry edilir; abort ve sınıflandırılmamış hatalar edilmez. Continuation state istek başarıyla sonuçlanana kadar korunur; retry aynı call ID/tool sonucunu kullanır ve tool'u yeniden çalıştırmaz. Belirsiz transport hatası halinde model üretimi tekrarlanıp ücret doğurabilir.

**Doğrulama:** Otomatik testler SDK davranışını mock'lar, gerçek ağa çıkmaz. Gemini REST calculator isteği değişken sonuç vermiştir (başarılı yanıt ve geçici 503); AgentLab canlı tool-calling davranışı doğrulanmamış olup smoke testler ertelenmiştir. Provider/model fallback kapsam dışıdır.

## v0.4 — Deterministic Scenarios & Simple Evaluation

### ✅ v0.4.1 Sabit deney senaryoları

**Amaç:** Aynı görev ve koşulları tekrarlanabilir şekilde çalıştırmak. İlk senaryolar test/fixture olarak kalabilir.

**Uygulama:** Read-only TypeScript kataloğu dört sabit senaryo tanımlar: doğrudan metin yanıtı, tek calculator çağrısı, üç calculator çağrısıyla bütçe içi çok adımlı akış ve güvenli unknown-tool hatası. `Scenario` yalnızca `id`, `title`, `description` ve `task` içerir. Senaryo API sınırında çözülür; `SingleAgent`, `runExperiment`, `ModelProvider` ve experiment/event tipleri değişmez. Serbest metin `{ task }` akışı korunur; `{ scenarioId }` ayrı ve açıkça doğrulanır. İki alanın birlikte gönderimi ve bilinmeyen ID reddedilir.

Fake yanıt dizileri senaryo metadata'sından ayrı server-side fixture dosyasında tutulur ve yalnızca açıkça `AGENTLAB_MODEL_PROVIDER=fake` seçildiğinde verilir. Gerçek provider'lar sabit görev metnini normal biçimde alır, ancak model çıktıları deterministik değildir. Mevcut üç tool yürütme limiti korunur; dördüncü çağrı testi kullanıcı kataloğunda yer almaz.

**Doğrulama:** Fake provider ile senaryo akışları, free-text regresyonu, bilinmeyen/birleşik payload reddi ve provider factory davranışı otomatik testlerle doğrulanır; testler gerçek ağa çıkmaz. UI senaryo seçimi ile serbest görev girişini açıkça ayırır. v0.4.2 değerlendirmesi uygulanmamıştır.

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
