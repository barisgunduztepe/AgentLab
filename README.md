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

**Mevcut durum:** v0.3.4 Gemini provider implementasyonu ve mock tabanlı otomatik doğrulaması tamamlandı. Manuel REST kontrolünde toolsuz Interactions isteği başarılı oldu; calculator tool şemasıyla yapılan istekler geçici `503 service_unavailable` kapasite hatası aldı. Bu nedenle AgentLab üzerinden canlı tool-calling davranışı henüz doğrulanmamıştır. v0.3.3 OpenAI canlı davranışı da gerçek API smoke testi yapılmadığı için doğrulanmamıştır.

## v0.3.3 — OpenAI Responses API

Provider seçimi açıkça `AGENTLAB_MODEL_PROVIDER=fake` veya `AGENTLAB_MODEL_PROVIDER=openai` olarak yapılmalıdır. Değişken eksik veya geçersizse endpoint hata verir; otomatik provider fallback'i yoktur.

OpenAI modu için server-side `OPENAI_API_KEY` ve `OPENAI_MODEL` ortam değişkenleri gerekir. `.env.example` örnek yapılandırmayı gösterir. Örneğin `OPENAI_MODEL=gpt-6-luna` kullanılabilir; model erişimi OpenAI API hesabına bağlıdır.

Gerçek API smoke testi, API kredisi olduğunda manuel yapılabilir: `.env.local` içinde `AGENTLAB_MODEL_PROVIDER=openai`, `OPENAI_API_KEY` ve `OPENAI_MODEL` ayarla, uygulamayı başlat ve “Use the calculator to calculate 12 * 8 and explain the result.” görevini gönder. Otomatik testler bu API'yi çağırmaz. Mevcut canlı davranış doğrulanmamıştır.

v0.3.3'te OpenAI function schema'sı yalnızca mevcut calculator tool için provider içinde tanımlıdır. İkinci tool eklenirse schema'yı `Tool` sözleşmesine taşıma kararı yeniden değerlendirilecektir. Tool input/output lifecycle event'lerine eklenmez.

## v0.3.4 — Gemini Interactions API

Provider seçimi `AGENTLAB_MODEL_PROVIDER=fake|openai|gemini` ile açıkça yapılır; eksik veya geçersiz değerlerde fallback yoktur. Gemini modu server-side `GEMINI_API_KEY` ve `GEMINI_MODEL` gerektirir. `.env.example` yalnızca boş placeholder'ları içerir; gerçek anahtar `.env.local` veya sunucu ortam değişkeninde tutulmalıdır. Örnek model adı `gemini-3.8-flash`'tir; model adı kodda sabitlenmez. Model erişimi ve Free Tier uygunluğu manuel smoke testinden hemen önce tekrar kontrol edilmelidir.

Gemini provider resmi `@google/genai` SDK'sının Interactions API'sini ve native function calling akışını kullanır. Yalnızca calculator function schema'sı provider içinde tanımlanır. Function call ID, ortak `callId` olarak korunur; interaction ve continuation state provider içinde tutulur. Tek response başına bir function call kabul edilir ve mevcut üç tool execution sınırı korunur. Tool input/output lifecycle event'lerine eklenmez. SDK davranışı mock testlerle doğrulanmıştır. Manuel REST kontrolünde toolsuz istek tamamlanmış, calculator tool içeren istekler geçici yüksek talep kaynaklı `503 service_unavailable` hatası almıştır. AgentLab'in canlı SDK tool-calling akışı başarılı bir smoke test ile henüz doğrulanmamıştır; retry/backoff bu milestone'a dahil değildir.

Sürümlerin ve milestone'ların ayrıntılı durumu için [ROADMAP.md](ROADMAP.md) dosyasına bakın.
