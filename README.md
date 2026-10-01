# AgentLab

AgentLab, AI agent'larının nasıl çalıştığını gözlemlemek, test etmek ve ilerleyen sürümlerde farklı agent mimarilerini karşılaştırmak için geliştirilen bir deney laboratuvarıdır.

## Projenin amacı

İki temel hedefimiz var:

1. **Ürün hedefi:** Agent'ların görev sırasında gerçekleştirdiği gözlemlenebilir işlemleri görünür hale getiren, deneyleri kaydedebilen ve ilerleyen sürümlerde farklı agent mimarilerini karşılaştırabilen gerçek bir uygulama geliştirmek.
2. **Öğrenme hedefi:** Codex eğitiminde öğrenilen Context, Agent, Skill, Harness, Session, AGENTS.md, planlama, Git/GitHub, test, tool kullanımı, multi-agent, otomasyon ve project-handoff kavramlarını gerçek bir projede uygulamak.

## v0.1 — Single Agent

v0.1'in amacı yalnızca şu temel akışı çalışan hale getirmektir:

Görev gir  
→ Deneyi Başlat  
→ Single Agent çalışır  
→ Gözlemlenebilir çalışma olayları gösterilir  
→ Sonuç gösterilir

### Minimum arayüz

- Görev giriş alanı
- Deneyi Başlat butonu
- Single Agent durumu
- Canlı olay akışı
- Deney sonucu

### İlk sürümde takip edilecek bilgiler

- Deney durumu
- Başlangıç/bitiş zamanı
- Çalışma süresi
- Hata durumu
- Agent çıktısı

Canlı akış yalnızca sistemin gerçekten gözlemleyebildiği olayları göstermelidir. Modelin gizli düşünce sürecini veya chain-of-thought içeriğini göstermeye çalışma.

## v0.1 kapsamı dışında

Şimdilik aşağıdakiler yapılmayacak:

- Multi-agent
- Otomasyon
- Kullanıcı hesabı
- Cloud database
- Model karşılaştırması
- Maliyet dashboard'u
- Karmaşık grafikler

Bunlar sonraki sürümlerde değerlendirilecek.

## Geliştirme yaklaşımı

Proje küçük, test edilebilir ve geri alınabilir milestone'larla geliştirilecek. Her adımda önce kavram öğrenilecek; ardından küçük implementasyon, test, canlı doğrulama ve Git checkpoint'i gelecek.

**Mevcut durum:** v0.4.2 Simple Pass/Fail Evaluation uygulaması ve otomatik doğrulamaları tamamlandı. v0.4.1 Fixed Experiment Scenarios ve v0.3.5 Provider Resilience da tamamlandı. Gemini toolsuz REST isteği başarılı oldu. Calculator tool şemalı REST isteği farklı denemelerde hem geçici `503 service_unavailable` aldı hem de başarılı oldu; sağlayıcı kapasitesi değişken. AgentLab üzerinden canlı tool-calling davranışı hâlâ doğrulanmamıştır ve yeni smoke testleri ertelenmiştir. v0.3.3 OpenAI canlı davranışı da gerçek API smoke testi yapılmadığı için doğrulanmamıştır.

## v0.3.3 — OpenAI Responses API

Provider seçimi açıkça `AGENTLAB_MODEL_PROVIDER=fake` veya `AGENTLAB_MODEL_PROVIDER=openai` olarak yapılmalıdır. Değişken eksik veya geçersizse endpoint hata verir; otomatik provider fallback'i yoktur.

OpenAI modu için server-side `OPENAI_API_KEY` ve `OPENAI_MODEL` ortam değişkenleri gerekir. `.env.example` örnek yapılandırmayı gösterir. Örneğin `OPENAI_MODEL=gpt-6-luna` kullanılabilir; model erişimi OpenAI API hesabına bağlıdır.

Gerçek API smoke testi, API kredisi olduğunda manuel yapılabilir: `.env.local` içinde `AGENTLAB_MODEL_PROVIDER=openai`, `OPENAI_API_KEY` ve `OPENAI_MODEL` ayarla, uygulamayı başlat ve “Use the calculator to calculate 12 * 8 and explain the result.” görevini gönder. Otomatik testler bu API'yi çağırmaz. Mevcut canlı davranış doğrulanmamıştır.

v0.3.3'te OpenAI function schema'sı yalnızca mevcut calculator tool için provider içinde tanımlıdır. İkinci tool eklenirse schema'yı `Tool` sözleşmesine taşıma kararı yeniden değerlendirilecektir. Tool input/output lifecycle event'lerine eklenmez.

## v0.3.4 — Gemini Interactions API

Provider seçimi `AGENTLAB_MODEL_PROVIDER=fake|openai|gemini` ile açıkça yapılır; eksik veya geçersiz değerlerde fallback yoktur. Gemini modu server-side `GEMINI_API_KEY` ve `GEMINI_MODEL` gerektirir. `.env.example` yalnızca boş placeholder'ları içerir; gerçek anahtar `.env.local` veya sunucu ortam değişkeninde tutulmalıdır. Örnek model adı `gemini-3.8-flash`'tir; model adı kodda sabitlenmez. Model erişimi ve Free Tier uygunluğu manuel smoke testinden hemen önce tekrar kontrol edilmelidir.

Gemini provider resmi `@google/genai` SDK'sının Interactions API'sini ve native function calling akışını kullanır. Yalnızca calculator function schema'sı provider içinde tanımlanır. Function call ID, ortak `callId` olarak korunur; interaction ve continuation state provider içinde tutulur. Tek response başına bir function call kabul edilir ve mevcut üç tool execution sınırı korunur. Tool input/output lifecycle event'lerine eklenmez. SDK davranışı mock testlerle doğrulanmıştır. Manuel REST kontrolünde toolsuz istek tamamlanmış; calculator tool içeren eşdeğer istekler farklı denemelerde başarılı olmuş veya geçici yüksek talep kaynaklı `503 service_unavailable` almıştır. AgentLab'in canlı SDK tool-calling akışı başarılı bir smoke test ile henüz doğrulanmamıştır; v0.3.5'e kadar retry/backoff bu milestone'a dahil değildi.

## v0.3.5 — Provider Resilience

OpenAI ve Gemini provider'ları provider-neutral `RetryingModelProvider` ile sarılır; `FakeModelProvider` sarılmaz. `ModelProvider` sözleşmesi ve `SingleAgent` değişmez. Her provider çağrısı en fazla 3 kez denenir. En fazla iki retry için exponential backoff cap'leri 500 ms ve 1000 ms'dir (politika üst cap'i 4000 ms); her gecikme 0 ile ilgili cap arasında full jitter kullanır. Retry-After, fallback, tool execution retry'ı ve UI değişikliği yoktur.

Provider adaptörleri yalnızca yapılandırılmış SDK alanlarına göre sınıflandırma yapar. 408, 500, 502, 503 ve 504 geçici sayılır. OpenAI'de 429 yalnızca `code=rate_limit_exceeded` iken retry edilir; kota/billing veya kodu belirsiz 429 retry edilmez. Gemini'de 429 yalnızca yapılandırılmış hata `details[].reason` ya da `code` alanı açıkça `RATE_LIMIT_EXCEEDED` / `rate_limit_exceeded` ise retry edilir; yalnızca `RESOURCE_EXHAUSTED` bilgisi kota ve hız sınırını güvenle ayırmadığından retry edilmez. Tanınan connection/timeout SDK hata tipleri retry edilir; abort, auth/client/config, bilinmeyen ve sınıflandırılmamış hatalar edilmez. Ham provider mesajları istemciye veya loglara taşınmaz.

SDK'lerin kendi retry'ları kapalıdır: OpenAI client `maxRetries: 0`, Gemini Interactions çağrısı `maxRetries: 0` kullanır; AgentLab retry katmanı tek retry sahibidir. Continuation isteği başarısız olursa provider içindeki pending call state korunur ve aynı call ID/tool sonucu ile tekrar denenir; tool'un kendisi tekrar çalıştırılmaz. Belirsiz bir transport hatasında sunucu ilk generation isteğini işlemiş olabilir; retry model çağrısını ve maliyeti tekrarlayabilir. Otomatik testler SDK'leri mock'lar, ağa çıkmaz. Canlı Gemini smoke testleri ertelenmiştir; AgentLab canlı davranışı doğrulanmış değildir. Provider/model fallback'i bu milestone'un kapsamı dışındadır.

## v0.4.1 — Fixed Experiment Scenarios

UI sabit TypeScript senaryo kataloğundan bilinen görevleri çalıştırabilir; serbest metin girişi de kullanılmaya devam eder. Senaryo `id`, `title`, `description` ve sabit `task` içerir. API `{ scenarioId }` değerini katalogda doğrulayıp görevi mevcut experiment akışına verir. `{ task, scenarioId }` birlikte gönderilirse istek `400` ile reddedilir; bilinmeyen senaryo için varsayılan senaryo veya serbest metin fallback'i yoktur.

İlk katalog doğrudan metin yanıtı, tek calculator çağrısı, üç calculator çağrısı ve güvenli unknown-tool hatasını kapsar. Fake `ModelResponse[]` fixture'ları UI kataloğundan ayrı server-side dosyada tutulur ve yalnızca `AGENTLAB_MODEL_PROVIDER=fake` açıkça seçildiğinde kullanılır. OpenAI/Gemini aynı sabit görev metnini alır; model yanıtları deterministik değildir. `SingleAgent`, `runExperiment` ve `ModelProvider` değişmez; üç tool execution limiti korunur. v0.4.2, senaryolar için ayrı `scenario.evaluated` event'i ekler.

## v0.4.2 — Simple Pass/Fail Evaluation

Sabit senaryolar, experiment sonucu ve yakalanan tool lifecycle event'leri üzerinden deterministik, açık kontrollerle PASS/FAIL alır. Evaluation; `SingleAgent`, `runExperiment` ve `ModelProvider` dışında, API route sınırında yapılır. Execution status ile evaluation sonucu ayrıdır: beklenen güvenli başarısızlık `experiment.failed` ardından PASS değerlendirmesi üretebilir. UI bu iki sonucu ayrı gösterir.

Custom/free-text görevler değerlendirilmez. Bilinmeyen-tool senaryosu yalnızca gözlenen sonucu değerlendirir: experiment başarısız olmuş ve hiçbir tool lifecycle event'i oluşmamış olmalıdır. Bu, hatanın özellikle unknown tool kaynaklı olduğunu kanıtlamaz. Gerçek provider çıktıları deterministik değildir; sabit sayı ve tool-count assertion'ları, insanın kabul edebileceği bir yanıtı da FAIL sayabilir. LLM-as-judge, anlamsal değerlendirme, fuzzy matching ve skor bu milestone'un kapsamı dışındadır.

Sürümlerin ve milestone'ların ayrıntılı durumu için [ROADMAP.md](ROADMAP.md) dosyasına bakın.

## v0.5.1 — Controlled Handoff Between Two Agents

The fixed `analyst-finalizer-handoff` scenario demonstrates one coordinator-directed transfer. The Analyst receives the original objective and returns concise notes. The Finalizer receives the original objective and those notes as separately labelled context, then returns the experiment's final response. The runner creates one explicit `{ task, context }` handoff payload and stops after the Finalizer.

Each agent gets its own provider instance. Fake mode uses separate deterministic server-side response fixtures; real providers are independently created and retain their existing retry wrapper. Existing aggregate experiment events remain in use, and this handoff scenario has no v0.4.2 evaluation. Agent A does not choose Agent B: model-requested routing is not implemented. Richer multi-agent lifecycle events, contribution visibility, handoff visualization, and error observability are deferred to v0.5.2.

## v0.5.2 — Multi-Agent Lifecycle Observability

The fixed handoff scenario now adds scoped Analyst/Finalizer lifecycle events, their returned contribution text, a completed or safely failed handoff event, and agent identity on tool lifecycle events. Existing aggregate `agent.started`, `agent.completed`, and experiment events remain. Agent failures expose only the stable `agent_execution_failed` code; invalid handoff data exposes `invalid_handoff`. Tool arguments/results and provider state remain private. Events observe the fixed coordinator-directed Analyst → Finalizer flow; they do not control routing. This milestone adds no dynamic routing or swarm behavior.
