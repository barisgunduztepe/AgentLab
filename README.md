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

**Mevcut durum:** v0.2 Tool System tamamlandı.

**Sıradaki milestone:** v0.3.1 — Structured Tool-Call Contract

Sürümlerin ve milestone'ların ayrıntılı durumu için [ROADMAP.md](ROADMAP.md) dosyasına bakın.
