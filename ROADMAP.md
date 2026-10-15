# AgentLab Roadmap

Bu belge, AgentLab'in mevcut durumunu ve onaylanmış geliştirme sırasını kaydeder. Tamamlanan milestone'lar (v0.1–v0.7) [CHANGELOG.md](CHANGELOG.md) dosyasındadır. Tamamlandı işaretleri dosya varlığına değil, çalışan bağlantılara ve mevcut test kapsamına dayanır.

## Mevcut checkpoint

- v0.1–v0.7 tamamlandı (ayrıntı: [CHANGELOG.md](CHANGELOG.md)). v0.8.0 Toparlama (CI, ROADMAP/CHANGELOG ayrımı, AGENTS.md, Groq temizliği) tamamlandı; tek açık madde yerel fake kayıtlarının temizliği. v0.8.1 Koşu metadata'sı ve v0.8.2 Model çağrı olayları ve hata kodları uygulandı, ikisi de yalnız fake ile doğrulandı (🟡). v0.8.3 Durumsuz model arayüzü de uygulandı; yalnız fake/mock ile doğrulandı (🟡). v0.8.4 yerel adaptör ve manuel smoke altyapısı uygulandı (🟡 yalnız mock); **canlı yerel doğrulama ve gerçek yanıt replay hâlâ bekliyor**. Eski "v0.8 Automation" planı 2026-10-15 mimari incelemesiyle yeniden çerçevelendi; kontrollü tekrar artık v0.9.4'tedir (aşağıdaki "Yol haritası revizyonu" bölümüne bakın).
- v0.3 gerçek provider'larının canlı davranış doğrulaması sınırlıdır; Gemini tool-enabled isteklerinde daha önce 503 gözlenmiştir. Gerçek provider ile hiçbir akış canlı doğrulanmamıştır; bu, v0.8.4'te ele alınır.

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

## Önerilen çalışma modeli (milestone başına)

Kural: işi güvenilir biçimde yapabilecek en ekonomik model seçilir. Tasarım kararı gerektiren milestone'larda önce Opus tasarlar, sonra Sonnet uygular; Sonnet birkaç denemede çözemezse Opus'a dönülür. Fable yalnızca istisnai durumlarda.

| Milestone | Tasarım | Uygulama | Not |
|---|---|---|---|
| v0.8.0 Toparlama | — | 🌙 Sonnet | Mekanik işler (CI, silme, belge). Toplu biçim düzeltmeleri için ⚡ Haiku yeterli. |
| v0.8.1 Koşu metadata'sı | 🌙 Sonnet | 🌙 Sonnet | Şema v3 küçük ve açık. |
| v0.8.2 Model çağrı olayları ve hata kodları | 🌙 Sonnet | 🌙 Sonnet | Olay tipleri mevcut kalıbı izler; `failureCode` listesi karmaşıklaşırsa ☀️ Opus. |
| v0.8.3 Durumsuz model arayüzü | ☀️ Opus | 🌙 Sonnet | En kritik mimari karar: mesaj modeli, araç şeması, iptal, ortak provider testi. İnceleme için ☀️ Opus. |
| v0.8.4 İlk gerçek provider | 🌙 Sonnet | 🌙 Sonnet | Kurulum, adaptör ve smoke betiği. Yerel model davranışı beklenmedik çıkarsa ☀️ Opus. |
| v0.9.1 Koşu servisi ve mimari kaydı | ☀️ Opus | 🌙 Sonnet | Orkestrasyon ve senaryo tanımının yeniden tasarımı. |
| v0.9.2 İkinci araç ve zor senaryolar | ☀️ Opus | 🌙 Sonnet | Mimarileri gerçekten ayıran senaryo ve evaluator tasarımı. |
| v0.9.3 Üçüncü mimari | 🌙 Sonnet | 🌙 Sonnet | Kayıt hazırsa ekleme işidir. |
| v0.9.4 Kontrollü tekrar | ☀️ Opus | 🌙 Sonnet | Bütçe sınırı, durdurma ve istatistik gösterimi tasarımı. |
| v1.0.1 Paylaşılabilir sürüm | — | 🌙 Sonnet | UI bölme, dışa aktarma, belge ve diyagram. |

## v0.8.0 — Toparlama

### 🟡 v0.8.0 Repository ve süreç toparlaması

**Durum:** Neredeyse tamamlandı; tek açık madde yerel veri temizliği (aşağıda).

- ✅ v0.7.2 commit'inin push edilmesi (2026-10-15; origin ile birleştirmek için rebase gerekti).
- ✅ GitHub Actions CI: lint, rota tipi üretimi (`next typegen`), tsc, test ve production build. Üçüncü çalışmada (`4be64f2`) Linux'ta tamamen yeşil; ilk iki çalışma gerçek hataları buldu (temiz checkout'ta eksik `LayoutProps` tipi; `getDefaultExperimentHistoryPath`'in platform parametresine uymaması) ve düzeltildi.
- ✅ Kullanılmayan `groq-model-provider.ts` kaldırıldı (git geçmişinde duruyor).
- ⬜ Yerel history'deki fake deneme kayıtlarının temizlenmesi: kayıtlar repoda değil yerel veri klasöründedir (`%LOCALAPPDATA%\AgentLab\experiments.json`); kullanıcı kendi cihazında temizler veya açıkça onay verir.
- ✅ "Bitti" kuralı Development Principles'a ve AGENTS.md'ye eklendi: canlı doğrulama yapılmadan milestone ✅ olmaz; yapılamıyorsa açıkça "yalnız fake ile doğrulandı" diye işaretlenir.
- ✅ ROADMAP gelecek plan olarak, tamamlananlar CHANGELOG.md olarak ayrıldı (metin değiştirilmeden taşındı).
- ✅ AGENTS.md agent'tan bağımsız dile getirildi (Codex'e özgü ifadeler giderildi; artık Claude da çalışıyor).

**Not:** CI, GitHub'ın Node 20 → 24 geçişi nedeniyle `actions/checkout@v4` ve `actions/setup-node@v4` için uyarı veriyor (şimdilik zararsız) ve `ubuntu-latest` 19 Ekim 2026'da Ubuntu 26'ya geçecek; bu v0.8.1 öncesinde gözden geçirilecek.

## v0.8 — Ölçülebilir çekirdek

### 🟡 v0.8.1 Koşu metadata'sı (history schema v3)

**Amaç:** Her kaydın nasıl üretildiğini kanıtlamak. Provider, model, agent yapılandırma kimliği ve sürümü, senaryo, uygulama commit'i ve fake bayrağı kaydedilir; v1/v2 kayıtlar değiştirilmeden okunur. UI fake koşuları açıkça "FAKE" olarak etiketler. En küçük ve en değerli adım.

**Durum:** 🟡 Uygulandı; **yalnız fake provider ile doğrulandı** (gerçek provider ile ilk doğrulama v0.8.4'te). 186 test, lint, tsc ve production build yerelde geçti; arayüz tarayıcıda fake provider ve geçici bir history klasörüyle görüldü.

**Uygulama (2026-10-15):**
- **Şema v3:** Her yeni kayıt zorunlu bir `run` bloğu taşır: `provider` (`fake`, `openai`, `gemini`), `model` (yalnız gerçek provider'larda; API anahtarı ve adres asla kaydedilmez), `architecture` (`single`, `handoff`), `agentConfigurationId` (`baseline`, `structured`, `handoff-default`), `agentConfigurationVersion` ve isteğe bağlı kısa `commit`. Karşılaştırma alanları (`comparisonId` + `configurationId`) v3'te isteğe bağlıdır ama çift olarak ve `run.agentConfigurationId` ile tutarlı olmak zorundadır. Fake bayrağı ayrı alan değil, `provider === "fake"`'ten türetilir.
- **Uyumluluk:** v1/v2 kayıtlar değiştirilmeden okunur; dosya sürümü en yeni kaydın sürümüne yükselir ve kayıttan eski dosya sürümü reddedilir. Bilinmeyen `run` alanları kaydedilirken atılır, okunurken reddedilir. v3 dosyayı v0.8.1 öncesi uygulama sürümleri okuyamaz (`unsupported_schema`).
- **Üretici taraf:** `createRunMetadata` provider/model özetini (`describeConfiguredProvider`, anahtarsız), `AGENT_CONFIGURATION_VERSIONS` sürümünü ve `getShortCommit`'i birleştirir. Karşılaştırmada iki koşu aynı provider, model ve commit değerini paylaşır.
- **Arayüz:** Geçmiş listesinde sarı "FAKE" etiketi (gerçek provider'larda provider adı), ayrıntıda tam "Run" satırı, karşılaştırma görünümünde "Provider" satırı. v0.8.1 öncesi kayıtlarda etiket yoktur ve "provider not recorded" yazar; geriye dönük FAKE etiketi uydurulmaz.

**Bilinen sınırlar:**
- `commit`, çalışan koddaki **commit edilmemiş değişiklikleri yansıtmaz** ve sunucu proje dizininden başlatılmazsa (`process.cwd()` Git deposu değilse) boş kalır.
- Canlı (SSE) deney görünümü `run` bilgisini göstermez; etiket, kayıt geçmişe yazıldıktan sonra görünür. Model çağrı olayları v0.8.2'dedir.
- Yerel history'deki v0.8.1 öncesi kayıtlar (v0.8.0'dan kalan 4 sahte kayıt dahil) v2 olarak kalır ve etiketsizdir.

### 🟡 v0.8.2 Model çağrı olayları ve hata kodları

**Amaç:** Model davranışını gözlemlenebilir kılmak. `model.requested` / `model.responded` olayları süre ve sonuç türü taşır; prompt/yanıt içeriği varsayılan olarak olaylara yazılmaz. `experiment.failed` güvenli bir `failureCode` alır; evaluator nedeni bu kodla doğrular. Deterministik aritmetik yolu ayrı bir olayla görünür olur.

**Durum:** 🟡 Uygulandı; **yalnız fake provider ile doğrulandı** (gerçek provider ile ilk doğrulama v0.8.4'te). 232 test, lint, tsc ve production build yerelde geçti; arayüz tarayıcıda fake provider ve geçici bir history klasörüyle üç durumda görüldü (hata kodu, handoff ajan atfı, model atlandı).

**Kapsam değişikliği:** Plandaki "bitiş nedeni ve usage" bu milestone'da **yoktur**: `ModelProvider` arayüzü yalnızca metin/araç çağrısı döndürüyor ve bu bilgileri vermiyor. Arayüzü iki kez değiştirmemek için bunlar v0.8.3'e (durumsuz model arayüzü) taşındı.

**Uygulama (2026-10-15, dört adım):**
- **Hata kodları:** `AgentFailure` ve `FailureCode` (`tool_unavailable`, `tool_limit`, `invalid_tool_call`, `tool_failed`, `provider_error`, `invalid_handoff`, `unknown`). `SingleAgent` araç ve provider hatalarını sınıflandırır (provider hataları `provider_error`; ayrıntı yalnızca iç `cause` olarak kalır), handoff iç agent'ın kodunu taşır. `Experiment.failureCode` ve `experiment.failed` olayındaki `failureCode` (geçmişte isteğe bağlı: eski kayıtlarda yok) eklendi. Kullanıcıya gösterilen mesaj genel kalır. unknown-tool senaryosunun evaluator'ı artık yalnızca `tool_unavailable` ile biten başarısızlığı geçirir (provider kesintisi gibi başka nedenle başarısızlık FAIL olur).
- **Model çağrı olayları:** `model.requested` (`initial` veya `after_tool`) ve `model.responded` (`text`, `tool_call` veya `error`, `durationMs`). Süre, `RetryingModelProvider`'ın yeniden denemelerini ve bekleme sürelerini de kapsar (deneme sayısı bilinmez). Handoff'ta her olay `agentId` ile Analyst veya Finalizer'a atfedilir. Olaylar, geçmişte doğrulanır ve saklanır; arayüzde etiketlenir.
- **Atlanan model:** Salt aritmetik görevler modele gitmeden hesaplanır; bu artık `model.skipped` (`reason: deterministic_arithmetic`) olayıyla görünür, böylece model çağrısı olmayan koşu eksik ölçüm sanılmaz.
- **Gizlilik:** Hiçbir olay prompt, yanıt, araç girdi/çıktısı, çağrı kimliği veya provider hata metni taşımaz; testler bunu doğrular.

**Bilinen sınırlar:**
- v0.8.2 öncesi kayıtlarda model olayları ve hata kodu yoktur; bu kayıtlar değiştirilmedi.
- Olaylarla zenginleşen v3 kayıtları, bu sürümden eski uygulama sürümleri tarafından okunamayabilir (bilinmeyen olay türü).
- Mevcut `agent.lifecycle` (`agent_execution_failed`) ve `handoff.failed` (`invalid_handoff`) kodları ayrı bir sözlük olarak durur; deney düzeyindeki `failureCode` bunlardan bağımsızdır.
- Süreler fake provider'da ~0 ms çıkar; anlamlı süre verisi v0.8.4'te gerçek provider ile gelir.

### 🟡 v0.8.3 Durumsuz model arayüzü

**Amaç:** Konuşmayı agent'ın sahiplenmesi. `complete({ messages, tools, signal })` biçiminde durumsuz bir sözleşme; mesaj geçmişi agent'ta tutulur. Yanıt ayrıca **bitiş nedeni** ve (varsa) **usage** bilgisini taşır ve bunlar `model.responded` olayına eklenir (v0.8.2'de arayüz sağlamadığı için ertelendi). Araçlar JSON şemasıyla tanımlanır ve provider'lar şemayı genel olarak çevirir (calculator'a özel kopyalar kalkar). `AbortSignal` uçtan uca taşınır; SSE istemcisi ayrılınca deney durur. Tüm provider'lar için ortak sözleşme testi eklenir. Transcript'in kalıcı kaydı varsayılan olarak kapalıdır (mevcut veri ilkesi). Kapsam büyürse v0.8.3a (arayüz + agent) ve v0.8.3b (araç şeması + iptal) olarak bölünür.

**Durum:** 🟡 Uygulandı; **yalnız fake/mock ile doğrulandı**. Gerçek API çağrısı yapılmadı. Canlı gerçek-provider doğrulaması v0.8.4'te; OpenAI ve Gemini adaptörleri ayrıca kendi canlı doğrulamalarını bekler.

**Uygulama (2026-10-15, dört commit):**
- Ortak mesaj/yanıt sözleşmesi ve sınırlı JSON Schema araç tanımı; deney çıktısı model ölçümlerinden ayrıldı. Calculator nesne girdisini kendisi doğrular.
- Agent her model çağrısına tam konuşma snapshot'ını verir. OpenAI Responses ve Gemini Interactions korunur; previous/pending konuşma alanları kalktı. Fake script adımını transcript'ten belirler. Ortak testler gerçek SDK + sahte fetch ile adaptörleri ve retry sarmalayıcısını doğrular.
- AbortSignal agent, araç, provider HTTP isteği ve retry beklemesine taşınır. SSE reader iptali ve request abort koşuyu durdurur; `failed/cancelled` kaydı yazılır. Karşılaştırmanın başlanmamış ikinci koşusu oluşturulmaz. UI component kapanışında aktif fetch'ler abort edilir; Durdur düğmesi eklenmedi.
- `model.responded` bitiş nedeni ve usage taşır. Eksik/eski, bilinmeyen ve sıfır değerler ayrılır. History v3 validator/sanitizer yeni alanları güvenli biçimde işler; eski v1/v2/v3 kayıtları okunur. Mevcut prompt metinleri ve konfigürasyon sürümleri korunur.

**Doğrulama:** 339 test; lint, `next typegen`, tsc. Fake calculator koşusu ve baseline/structured karşılaştırması tarayıcıda geçici history ile PASS; canlı akış ve kayıt ayrıntısında finish/usage görüldü. Production build ve commit bazlı doğrulama ayrıntıları: [v0.8.3 doğrulama raporu](docs/v0.8.3-validation.md).

**Sınırlar:** Eski uygulamanın yeni ölçüm alanlarını/iptal kodunu okuması garanti edilmez. Transcript kaydı açılmadı. Usage yalnız yanıt alınan denemeye aittir; başarısız retry tüketimi ve maliyet hesaplanmaz. Senkron araç yürütmesi ortasında zorla kesme yoktur. Özel reasoning replay/opaque signature isteyen modeller kapsam dışıdır. OpenAI uyumlu yerel adaptör v0.8.4'tedir.

### 🟡 v0.8.4 İlk gerçek provider ve canlı doğrulama

**Amaç:** Gerçek sinyal almak. Ücretsiz/açık kaynak öncelikli olarak OpenAI uyumlu yerel bir uç nokta (örn. Ollama) için adaptör; elle çalıştırılan smoke betiği (otomatik testlere girmez); kaydedilmiş gerçek yanıtların testlerde tekrar oynatılması; canlı doğrulama raporu. Smoke testi laptopta küçük bir modelle, gerçek karşılaştırmalar GPU'lu masaüstünde yapılabilir; model indirmesi büyük olduğundan Wi-Fi'da yapılmalıdır.

**Durum (2026-10-15):** Adaptör, yapılandırma, metadata genişletmesi ve manuel smoke betiği uygulandı; **yalnız mock ile doğrulandı**. Mevcut ve çalışan yerel uç nokta bulunamadığı için canlı üretim/iptal smoke'u yapılmadı. Gerçek HTTP yanıtı alınmadı; kayıtlı gerçek-yanıt fixture'ları ve replay parçası yapılmadı, uydurma fixture üretilmedi.

- Yeni provider kimliği `openai-compatible`; mevcut `openai` SDK'sı açık baseURL ile `/v1/chat/completions` kullanır. Agent/Tool/complete sözleşmeleri değişmedi; Responses/Gemini adaptörleri korundu.
- `OPENAI_COMPATIBLE_BASE_URL` ve `OPENAI_COMPATIBLE_MODEL` zorunlu; API anahtarı isteğe bağlı. History v3 yalnız provider/model kaydeder; adres ve anahtar kaydetmez. Fake ve eski kayıtlar korunur.
- Ortak sözleşme testi yeni adaptörü, retry ile birlikte kapsar. Tam mesaj geçmişi, tools, bitiş nedeni/usage, anahtar/header izolasyonu, çoklu/bozuk araç çağrıları ve HTTP signal aktarımı sahte transport ile doğrulanır.
- `npm run smoke:local -- --check` yalnız kurulu model listesini kontrol eder. Manuel gerçek smoke metin, en az iki calculator turu ve model HTTP iptali içerir; CI'da çalışmaz. Test yardımcıları yalnız mock kullanır. Gerçek history'ye yazılmaz; geçici derleme ve history kökü kullanılır.
- Kontrol edilen localhost uç noktaları: 11434 ve 1234; ikisine de sandbox dışında ulaşılamadı. Kurulum, model indirme veya OpenAI/Gemini gerçek API çağrısı yapılmadı.
- 411 otomatik test geçti. Ayrıntılı kontroller, değişen dosyalar, canlı doğrulama eksikleri ve sonraki adım: [v0.8.4 doğrulama raporu](docs/v0.8.4-validation.md).

**Açık kabul ölçütleri:** Kullanıcının hazırladığı yerel sunucu + kurulu modelle metin/çok turlu araç/iptal smoke'unu çalıştırmak; gerçek yanıtları kimlik/adres/anahtar sızıntısı olmadan kaydedip replay testlerini eklemek. Bunlar gerçekleşmeden ✅ verilmez. Özel reasoning replay, token streaming, yeni araç ve maliyet hesabı kapsam dışıdır.

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
