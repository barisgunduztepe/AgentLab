# AgentLab Çalışma Kuralları

## 1. Önce mevcut bağlamı anla

Her anlamlı görevden önce:

- README.md ve görevle ilgili mevcut dosyaları incele.
- Mevcut milestone ve kapsamı belirle.
- Çalışan yapıyı anlamadan değiştirmeye başlama.

## 2. Milestone kapsamını koru

AgentLab küçük sürümler halinde geliştiriliyor. Bulunulan milestone dışında özellik ekleme. Örneğin v0.1 geliştirilirken ileride planlanan multi-agent, automation veya Agent Arena özelliklerini kendiliğinden ekleme. “İleride lazım olur” gerekçesiyle gereksiz altyapı oluşturma.

## 3. Bu bir öğrenme projesidir

Kullanıcı Codex ve yazılım geliştirmeyi uygulamalı öğreniyor. Önemli teknik adımlarda ne yapıldığını, neden yapıldığını ve hangi kavramın uygulandığını kısa ve anlaşılır biçimde açıkla. Basit ve tekrar eden işlemlerde gereksiz uzun açıklama yapma. Amaç yalnızca projeyi tamamlamak değil, geliştirme sürecini anlaşılır kılmaktır.

## 4. Küçük ve doğrulanabilir adımlar kullan

Büyük miktarda kodu tek seferde üretmek yerine mümkün olduğunda küçük, mantıksal geliştirme adımları kullan. Her adım anlaşılabilir, kontrol edilebilir ve mümkün olduğunda test edilebilir olmalıdır. Kullanıcı açıkça istemedikçe birkaç milestone'u tek görevde tamamlamaya çalışma.

## 5. Büyük değişikliklerden önce planla

Mimariyi, veri modelini, agent sistemini veya birden fazla önemli dosyayı etkileyen değişikliklerde implementasyona geçmeden önce kısa bir plan oluştur. Basit ve açık değişikliklerde gereksiz planlama yapma.

## 6. Doğrulamadan tamamlandı deme

Kod değişikliklerinden sonra uygun doğrulamaları gerçekleştir. Mevcut testler varsa ilgili testleri çalıştır. Test yoksa yapılabilecek en uygun küçük doğrulamayı gerçekleştir. Bir özelliğin çalıştığını doğrulamadan “tamamlandı” olarak raporlama. Başarısız testleri veya doğrulama sorunlarını gizleme.

## 7. Dependency ve teknoloji disiplini

Kullanıcının onayı olmadan ana framework değiştirme, önemli yeni dependency ekleme, yeni harici servis kullanma veya cloud altyapısı ekleme. Yeni teknoloji gerektiğinde önce neden gerektiğini, alternatifleri ve projeye getireceği maliyet/karmaşıklığı kısaca açıkla.

## 8. Git disiplinini koru

Git geçmişi bu projenin öğrenme sürecinin parçasıdır.

- Commitleri küçük ve anlamlı tut.
- İlgisiz değişiklikleri aynı commit'e karıştırma.
- Kullanıcı istemeden push, merge, rebase, reset veya geçmişi değiştiren işlemler yapma.
- Kullanıcının mevcut değişikliklerini silme veya üzerine yazma.
- Destructive Git komutlarından kaçın.

Commit mesajları yapılan değişikliği açıkça ifade etmelidir.

## 9. Mevcut yapıya saygı göster

Bir şeyi değiştirmeden önce mevcut implementasyonu incele. Gereksiz refactor yapma. Görevle ilgisi olmayan dosyaları değiştirme. Kullanıcı tarafından oluşturulmuş içerikleri veya kararları gerekçe olmadan yeniden yazma.

## 10. Gözlemlenebilirlik ilkesi

AgentLab'ın temel amaçlarından biri agent davranışını gözlemlenebilir hale getirmektir. Uygulamada yalnızca gerçekten gözlemlenebilen olayları göster. Modelin gizli düşünce sürecini / chain-of-thought içeriğini kaydetmeye veya göstermeye çalışma. Plan, tool çağrısı, durum değişikliği, hata, test sonucu ve çıktı gibi gözlemlenebilir olayları tercih et.

## 11. Öğrenmeyi otomasyona kurban etme

Bir işlem tamamen otomatik yapılabiliyor olsa bile, işlem mevcut öğrenme hedeflerinden birini içeriyorsa önemli aşamaları kullanıcı için görünür tut. Codex kullanıcı adına her şeyi tek adımda tamamlamaya çalışmamalıdır. Amaç kullanıcının zamanını gereksiz yere harcamak değil; önemli öğrenme noktalarının atlanmasını önlemektir.

## 12. Görev sonu raporu

Anlamlı bir geliştirme adımından sonra kısa şekilde bildir:

- Ne değişti
- Hangi dosyalar değişti
- Nasıl doğrulandı
- Git durumu
- Sıradaki mantıklı adım

Henüz yapılmamış bir işi yapılmış gibi gösterme.

## README ile çelişki

README.md ile AGENTS.md çelişirse bunu sessizce çözmeye çalışma; kullanıcıya bildir.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
