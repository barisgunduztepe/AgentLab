# AgentLab Roadmap

Bu belge, AgentLab'in mevcut repository durumunu ve onaylanmış geliştirme sırasını kaydeder. Tamamlandı işaretleri dosya varlığına değil, çalışan bağlantılara ve mevcut test kapsamına dayanır.

## Mevcut checkpoint

- v0.1–v0.7 tamamlandı. Sıradaki aşama **v0.8.0 Toparlama**, ardından **v0.8 Ölçülebilir çekirdek**'tir. Eski "v0.8 Automation" planı 2026-10-15 mimari incelemesiyle yeniden çerçevelendi; kontrollü tekrar artık v0.9.4'tedir (aşağıdaki "Yol haritası revizyonu" bölümüne bakın).
- v0.3 gerçek provider'larının canlı davranış doğrulaması sınırlıdır; Gemini tool-enabled isteklerinde daha önce 503 gözlenmiştir. v0.6 history çalışması provider davranışını değiştirmemiştir.

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

**Doğrulama:** Fake provider ile senaryo akışları, free-text regresyonu, bilinmeyen/birleşik payload reddi ve provider factory davranışı otomatik testlerle doğrulanır; testler gerçek ağa çıkmaz. UI senaryo seçimi ile serbest görev girişini açıkça ayırır. Pass/fail değerlendirmesi v0.4.2'de eklenmiştir.

### ✅ v0.4.2 Simple Pass/Fail Evaluation

**Amaç:** Sabit senaryoların experiment result ve mevcut lifecycle event'lerine dayalı açık, hafif assertion'larla sonucunu PASS/FAIL değerlendirmek.

**Uygulama:** `EvaluationResult` yalnızca `passed` ve kullanıcıya gösterilebilen kısa `reason` içerir. Küçük server-side evaluator senaryo ID'sine göre çalışır; evaluation API route'ta `SingleAgent`, `runExperiment` ve `ModelProvider` dışında yapılır. Sabit senaryolar için execution event'lerinden sonra tek `scenario.evaluated` SSE event'i gönderilir. Custom/free-text experiment'lar değerlendirilmez ve evaluation event'i almaz. Execution status (completed/failed) ile evaluation PASS/FAIL ayrı gösterilir.

Doğrudan metin senaryosu tamamlanmış, boş olmayan metin ve sıfır tool lifecycle event'i ister. Tek calculator senaryosu bir başarılı calculator lifecycle'ı ve final text içinde ayrı numeric token olarak `96` ister. Üç adımlı senaryo üç başarılı calculator lifecycle'ı ve `5`, `15`, `24` numeric token'larını ister. Güvenli başarısızlık senaryosu experiment failure ve sıfır tool lifecycle event'i olduğunda PASS olabilir.

**Sınırlamalar:** Safe-failure evaluator yalnızca gözlenen sonucu bilir; unknown-tool nedenini kanıtlayamaz. Gerçek provider yanıtlarının dili ve davranışı değişebilir; deterministik sayısal/tool-count assertion'ları insanın kabul edeceği bazı yanıtları FAIL sayabilir. Bu milestone LLM-as-judge, semantic grading, fuzzy matching, numeric scoring, persistence, repeated runs veya provider comparison eklemez.

**Doğrulama:** Saf evaluator ve SSE akışı Fake fixture'larla test edilir; otomatik testler ağa çıkmaz. UI evaluation sonucunu experiment execution status'undan ayrı gösterir.

## v0.5 — Multi-Agent Foundation

### ✅ v0.5.1 İki agent arasında kontrollü handoff

**Amaç:** Tek ve sınırları belli bir görev aktarımını göstermek.

**Uygulama:** Sabit `analyst-finalizer-handoff` senaryosu, coordinator tarafından Analyst'ten Finalizer'a tam bir kez aktarılır. Analyst özgün görev için kısa not üretir; Finalizer özgün görevi ve bu notları alıp son yanıtı döndürür. İki ayrı provider instance'ı kullanılır; Fake fixture'ları server-side ve deterministiktir. Var olan aggregate experiment event akışı korunur. Modelin handoff seçmesi, geri yönlendirme veya genel multi-agent orchestration yoktur. v0.5.2 daha ayrıntılı agent katkısı, handoff ve hata gözlemlenebilirliğini kapsar.

### ✅ v0.5.2 Multi-agent lifecycle ve event akışı

**Amaç:** Agent katkılarını, handoff'u ve hataları gözlemlenebilir kılmak.

**Uygulama:** Yalnızca sabit Analyst → Finalizer handoff akışında `agent.lifecycle` olayları agent kimliği, phase ve tamamlanan agent'ın normal metin çıktısını gösterir. `handoff.completed` / `handoff.failed` sabit kaynak-hedef ve güvenli hata kodunu taşır. Tool lifecycle olaylarında handoff akışı için `agentId` bulunur; tek-agent olay biçimi değişmez. Mevcut aggregate agent/experiment olayları korunur, handoff senaryosu değerlendirilmez ve hata mesajları genel/güvenli kalır. Olaylar yalnızca yürütmeyi betimler; dinamik yönlendirme veya swarm eklenmez.

İlk hedef swarm değildir.

## v0.6 — Experiment History

**Durum: ✅ Tamamlandı**

### ✅ v0.6.1 Yerel deney kaydı

**Amaç:** Şema ve saklama sınırı belirlendikten sonra deney sonuçlarını yerel olarak korumak.

**Uygulama:** `schemaVersion: 1` içeren tek JSON snapshot, Windows'ta `%LOCALAPPDATA%\AgentLab\experiments.json` altında tutulur; repository ve OneDrive çalışma alanı kullanılmaz. API route terminal experiment, varsa scenario/evaluation ve güvenli event akışını bir kez kaydeder. Yazma işlemleri süreç içinde sıraya alınır ve geçici dosya aynı dizinde hazırlanıp hedefin yerine geçirilir. Bozuk veya desteklenmeyen snapshot hata verir ve üzerine yazılmaz. Persistence hatası experiment sonucunu değiştirmez; istemciye yeni event eklenmez ve sunucu yalnızca genel bir uyarı kaydeder.

v0.6.1 kapsamında history UI veya history okuma endpoint'i yoktu; v0.6.2 bunları eklemiştir.

### ✅ v0.6.2 Geçmiş listesi ve deney ayrıntısı

**Amaç:** Kaydedilmiş deneyleri bulup sonuç ve event'lerini incelemek.

Read-only history API'si özet listesi ve ID ile tek kayıt ayrıntısını sunar. History UI, seçilen kaydın sonuç/evaluation bilgisi ve stored event'lerini gösterir; canlı run state'inden ayrıdır ve yeni run akışı kapandıktan sonra listeyi yeniler. v1 validation, evaluation için scenario ID ve event'ler için enclosing experiment ID eşleşmesini gerektirir.

History okuması local-only'dir: normal `dev`/`start` komutları `127.0.0.1` üzerinde dinler ve history read route'ları yalnızca loopback `Host` kabul eder. `X-Forwarded-For` ve `X-Forwarded-Host` istemci kimliği olarak kullanılmaz. LAN üzerinden history paylaşımı ve authentication bu milestone'da yoktur.

İlk hedef cloud database değildir.

## v0.7 — Agent Arena / Comparison

### ✅ v0.7.1 Aynı senaryoda iki agent configuration

**Amaç:** Aynı senaryodaki en az iki agent yapılandırmasını karşılaştırılabilir koşullarda çalıştırmak.

**Uygulama:** Dört sabit ve değerlendirilebilir single-agent senaryosu için aynı scenario task, provider/model, calculator tool ve evaluator kullanılarak `baseline` ve `structured` yapılandırmaları sıralı çalıştırılır. Baseline mevcut prompt'u aynen kullanır; structured yalnızca şu instruction'ı task prompt'una ekler: “Organize your response into the labeled sections ‘Key points’ and ‘Conclusion.’ Keep it concise and complete the original task.” Her koşu ayrı experiment ID ve sonuç taşır; ortak `comparisonId` ile ilişkilendirilir ve `configurationId` olarak `baseline` veya `structured` saklanır. Yeni kayıtlar history schema v2 kullanır; v1 kayıtlar değiştirilmeden okunmaya devam eder. UI karşılaştırmayı başlatır ve iki kayıtlı koşuyu tanımlar; kazanan veya metrik sıralaması üretmez.

**Durum:** Tamamlandı. Temel başarı/duration metrikleri v0.7.2'de eklendi.

### ✅ v0.7.2 Temel karşılaştırma metrikleri

**Amaç:** Önce güvenilir başarı durumu ve duration ölçülerini yan yana göstermek. Maliyet ancak provider güvenilir usage verisi sağlıyorsa eklenir.

**Uygulama:** Karşılaştırma yanıtına her koşunun `durationMs` değeri eklendi (history'ye yazılan değerle aynı; history şeması değişmedi). UI, `baseline` ve `structured` koşularını status, scenario evaluation (PASS/FAIL), duration ve history bağlantısıyla yan yana tabloda gösterir. Eksik değerler "Not evaluated" / "Not measured" olarak yazılır. Kazanan veya sıralama üretilmez; tek koşu olduğu ve süre ağ/provider gecikmesinden etkilendiği için sonuç istatistiksel değildir.

**Kapsam dışı bırakılanlar:** Maliyet ölçümü eklenmedi, çünkü `ModelProvider` arayüzü token/usage verisi sağlamıyor; güvenilir usage verisi gelirse ayrı bir milestone'da değerlendirilir. Dashboard, grafik, tekrarlı koşu/ortalama ve eski v1 kayıtlardan geriye dönük karşılaştırma yapılmadı.

**Durum:** Tamamlandı. 158 test, lint, tsc ve production build başarılı; tablo fake provider ile tarayıcıda iki senaryoda görülerek doğrulandı. Gerçek API çağrısı yapılmadı.

## Yol haritası revizyonu (2026-10-15)

v0.7 sonunda yapılan mimari inceleme, laboratuvarın karşılaştırma için gereken bilgiyi henüz kaydedemediğini gösterdi. Bu nedenle yeni provider, araç veya mimari eklemeden önce ölçüm çekirdeği kurulur. Eski "v0.8 Automation / v0.8.1 Kontrollü otomatik experiment çalıştırma" hedefi kaldırılmadı; v0.9.4 kontrollü tekrar olarak yeniden çerçevelendi, çünkü durdurma davranışı önce v0.8.3'teki iptal altyapısını gerektirir.

**İncelemenin bulguları:**

1. **Konuşma durumu provider'da tutuluyor.** OpenAI/Gemini adaptörleri `previousResponseId` / `previousInteractionId` saklıyor; `ModelProvider` yalnızca `generateResponse` + `continueAfterToolCall` sunuyor. Agent modele ne gönderildiğini bilemiyor; context/talimat/hafıza deneyleri yapılamıyor; her koşu ayrı provider instance'ı gerektiriyor; durumsuz (chat-completions tarzı) yerel modeller bu arayüze ancak durum taklidiyle uyar.
2. **History hangi provider/model ile koşulduğunu kaydetmiyor.** Kayıtlarda provider, model, agent yapılandırma sürümü veya fake bayrağı yok; fake ve gerçek koşular ayırt edilemez, "aynı model" iddiası kanıtlanamaz.
3. **Model çağrıları gözlenmiyor.** Olaylar yalnız araç ve yaşam döngüsünü kapsar; model çağrı sayısı, süresi, bitiş nedeni ve usage kaydedilmez.
4. **Hata nedeni siliniyor.** `runExperiment` her hatayı genel mesaja çevirir; evaluator unknown-tool nedenini kanıtlayamaz (v0.4.2 sınırlaması).
5. **İptal altyapısı yok.** Arayüzde `AbortSignal` yok; SSE istemcisi ayrılsa da deney sürer.
6. **Araç şeması provider'lara gömülü ve calculator'a özel.** `getCalculatorFunctionTools` iki provider'da kopyalanmış; `Tool.execute(input: string)` şemasız; Gemini adaptörü calculator dışını kendi içinde reddeder.
7. **Daha küçükler:** aritmetik görevler modele gitmeden hesaplanır ve bunu belirten olay yoktur; SSE ve karşılaştırma handler'ları orkestrasyonu iki kez yazar (karşılaştırma canlı akış vermez); bir senaryo eklemek beş yere dokunmayı gerektirir (katalog, evaluator, fixture, handler listesi, `page.tsx` listesi); fake seçimi handler içinde ortam değişkeniyle yapılır; 🟡 canlı doğrulanmamış maddeler birikir.

Sıralama gerekçesi: ölçüm ve arayüz düzeltilmeden eklenen her provider/araç/mimari, calculator'a özel ve durum saklayan kodu çoğaltır. Bu sıra hem en ucuz yoldur hem de öğrenme hedefindeki Context/Harness konusunu doğrudan çalıştırır.

## v0.8.0 — Toparlama

### ⬜ v0.8.0 Repository ve süreç toparlaması

- v0.7.2 commit'inin push edilmesi.
- GitHub Actions CI: test, lint, tsc ve production build.
- Kullanılmayan `groq-model-provider.ts` dosyasının kaldırılması.
- Yerel history'deki fake deneme kayıtlarının temizlenmesi.
- "Bitti" kuralı (aşağıdaki Development Principles'a eklendi): canlı doğrulama yapılmadan milestone ✅ olmaz; yapılamıyorsa açıkça "yalnız fake ile doğrulandı" diye işaretlenir.
- ROADMAP'in gelecek planı (ROADMAP) ve tamamlanan işler (CHANGELOG) olarak ayrılması.
- AGENTS.md'nin agent'tan bağımsız dile getirilmesi (Codex'e özgü ifadeler; artık Claude da çalışıyor).

## v0.8 — Ölçülebilir çekirdek

### ⬜ v0.8.1 Koşu metadata'sı (history schema v3)

**Amaç:** Her kaydın nasıl üretildiğini kanıtlamak. Provider, model, agent yapılandırma kimliği ve sürümü, senaryo, uygulama commit'i ve fake bayrağı kaydedilir; v1/v2 kayıtlar değiştirilmeden okunur. UI fake koşuları açıkça "FAKE" olarak etiketler. En küçük ve en değerli adım.

### ⬜ v0.8.2 Model çağrı olayları ve hata kodları

**Amaç:** Model davranışını gözlemlenebilir kılmak. `model.requested` / `model.responded` olayları süre, bitiş nedeni ve (varsa) usage taşır; prompt/yanıt içeriği varsayılan olarak olaylara yazılmaz. `experiment.failed` güvenli bir `failureCode` alır (örn. `tool_unavailable`, `tool_limit`, `invalid_tool_call`, `tool_failed`, `provider_error`); evaluator nedeni bu kodla doğrular. Deterministik aritmetik yolu ayrı bir olayla görünür olur.

### ⬜ v0.8.3 Durumsuz model arayüzü

**Amaç:** Konuşmayı agent'ın sahiplenmesi. `complete({ messages, tools, signal })` biçiminde durumsuz bir sözleşme; mesaj geçmişi agent'ta tutulur. Araçlar JSON şemasıyla tanımlanır ve provider'lar şemayı genel olarak çevirir (calculator'a özel kopyalar kalkar). `AbortSignal` uçtan uca taşınır; SSE istemcisi ayrılınca deney durur. Tüm provider'lar için ortak sözleşme testi eklenir. Transcript'in kalıcı kaydı varsayılan olarak kapalıdır (mevcut veri ilkesi). Kapsam büyürse v0.8.3a (arayüz + agent) ve v0.8.3b (araç şeması + iptal) olarak bölünür.

### ⬜ v0.8.4 İlk gerçek provider ve canlı doğrulama

**Amaç:** Gerçek sinyal almak. Ücretsiz/açık kaynak öncelikli olarak OpenAI uyumlu yerel bir uç nokta (örn. Ollama) için adaptör; elle çalıştırılan smoke betiği (otomatik testlere girmez); kaydedilmiş gerçek yanıtların testlerde tekrar oynatılması; canlı doğrulama raporu. Smoke testi laptopta küçük bir modelle, gerçek karşılaştırmalar GPU'lu masaüstünde yapılabilir; model indirmesi büyük olduğundan Wi-Fi'da yapılmalıdır.

## v0.9 — Gerçek karşılaştırma

### ⬜ v0.9.1 Tek koşu servisi ve mimari kaydı

**Amaç:** Orkestrasyonu tek yerde toplamak. SSE ve karşılaştırma aynı koşu servisini kullanır (karşılaştırma da canlı akış verir). Agent mimarileri bir kayıttan (registry) seçilir; `"baseline" | "structured"` sabit birliği ve handoff'a özel `if`'ler kalkar. Senaryo tek tanımda toplanır: görev, evaluator, fake fixture ve karşılaştırılabilirlik bilgisi.

### ⬜ v0.9.2 İkinci araç ve ayırt edici senaryolar

**Amaç:** Mimarileri ayırabilen deneyler. Salt okunur ikinci araç (sabit belge setinde arama) ve mimariler arasında fark yaratması beklenen 2–3 daha zor senaryo (çok adımlı arama, kasıtlı çelişki içeren görev).

### ⬜ v0.9.3 Üçüncü mimari ve çoklu karşılaştırma

**Amaç:** Tek agent + Critic mimarisi; handoff karşılaştırmaya katılır; karşılaştırma ikiden fazla mimariyi destekler. Kazanan seçilmez.

### ⬜ v0.9.4 Kontrollü tekrar

**Amaç:** Gerçek modellerin değişkenliğini ölçmek. N tekrarlı koşu, bütçe/koşu üst sınırı, açık durdurma, başarı oranı, medyan süre ve yayılım. Her koşu ayrı kaydedilir. JSON history'nin yavaşladığı ölçülürse SQLite değerlendirilir. (Eski v0.8.1 hedefi.)

## v1.0 — Usable AgentLab

### ⬜ v1.0.1 Release / Productization Checkpoint

**Amaç:** Desteklenen AgentLab akışlarını güvenilir, anlaşılır ve dokümante edilmiş hale getirmek: UI'ın bileşenlere bölünmesi, JSON/CSV dışa aktarma, mimari diyagramı, demo GIF, katkı rehberi ve ilk sürüm etiketi.

## Bilerek sonraya bırakılanlar

LLM-as-judge (ancak deterministik değerlendirme yetmezse), bulut veritabanı, kullanıcı hesabı ve swarm. SQLite ve MCP araç desteği değerlendirme listesindedir.

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
- Canlı doğrulama yapılmadan milestone ✅ olarak işaretlenmez; yapılamıyorsa "yalnız fake ile doğrulandı" diye açıkça belirtilir (2026-10-15).
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
