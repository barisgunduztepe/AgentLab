# Gerçek Ollama yanıtları

Bu dizindeki JSON dosyaları 2026-10-15'te yalnız elle çalıştırılan
`npm run smoke:local -- --record` ile gerçek `/v1/chat/completions` yanıtlarından üretildi.
Kaynak model, UTC kayıt tarihi ve smoke prompt sürümü dosya başlığındadır.

- `qwen3-8b-2026-10-15T13-50-09-621Z.json`: metin; ardından tek çağrı/yanıt biçiminde iki calculator turu ve son yanıt (410).
- `llama3-1-8b-2026-10-15T13-50-37-331Z.json`: metin; ardından tek yanıtta iki araç çağrısı, `invalid_tool_call` ile reddedilir.

Yalnız assistant content, araç çağrısı biçimi/adı/argümanları, finish_reason ve bildirilmiş token sayıları tutulur.
Completion/tool kimlikleri normalize edilir; created sıfırlanır. system_fingerprint, reasoning/reasoning_content,
inline think blokları, diğer alanlar, request/header'lar, anahtar ve adres kaydedilmez. Görünür metin dış kenar
boşlukları temizlenir. Token sayıları kaynağın bildirdiği değerlerdir; reasoning metni çıkarıldı diye değiştirilmez.
Bu sabit sentetik smoke görevlerinin görünür yanıtları/araç argümanları fixture'a özeldir; uygulamanın history
ve olay akışındaki içerik kaydetmeme sözleşmesi değişmez. Ham yanıt veya transcript diske yazılmaz.

İptal edilen isteğin tamamlanmış yanıtı yoktur; iptal fixture'ı yoktur. Claude'un önceki çalışmasında gözlenen
başarısız tekil llama3.1 araç yanıtının ham kaydı sağlanmadı; yeni koşu iki çağrı döndürdü. Bu nedenle tekil
başarısız yanıt fixture'ı uydurulmadı. Sentetik bozuk/tekil çağrı testleri gerçek yanıt diye etiketlenmez.

`local-response-replay.test.ts` yalnız sahte fetch ile bu zarfları oynatır; sunucu/model gerekmez.
Manuel kayıt betiği CI veya `npm test` tarafından çalıştırılmaz. Yeni kayıtlar mevcut dosyaları ezmez;
review sırasında yalnız izin verilen alanları içerdiği ve doğru beklentiyle teste bağlandığı kontrol edilmelidir.
