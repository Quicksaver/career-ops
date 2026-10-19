# Mod: tracker — Başvuru Takipçisi

`users/{USER}/data/applications.md` dosyasını oku ve görüntüle.

**Takip Formatı:**

```markdown
| # | Tarih | Şirket | Rol | Puan | Durum | PDF | Rapor | Notlar |
```

Olası durumlar (Türkçe karşılıklar yalnızca açıklama içindir; takipçiye her zaman kanonik İngilizce durum yazılır, bkz. `templates/states.yml`): `Evaluated` (`Değerlendirildi`) → `Applied` (`Başvuruldu`) → `Responded` (`Yanıt Verildi`) → `Assessment` (`Değerlendirme Testi`) → `Interview` (`Mülakat`) → `Offer` (`Teklif`) → `Hired` (`İşe Alındı`) / `Rejected` (`Reddedildi`) / `Closed` (`Kapandı`) / `Discarded` (`İptal Edildi`) / `SKIP` (`Uygun Değil`)

- `Evaluated` = teklif raporla değerlendirildi, karar bekleniyor
- `Applied` = aday başvurusunu gönderdi
- `Responded` = Şirket yanıt verdi (henüz mülakat değil)
- `Assessment` = çevrim içi değerlendirme veya asenkron ön eleme sürüyor
- `Interview` = aktif mülakat süreci
- `Offer` = iş teklifi alındı
- `Hired` = teklif kabul edildi / iş bulundu
- `Rejected` = şirket tarafından reddedildi
- `Closed` = ilan başvurudan önce kapandı
- `Discarded` = aday tarafından elendi
- `SKIP` = uygun değil, başvurma

Kullanıcı bir durumu güncellemeyi isterse, doğrudan satırı düzenlemeyin; bunun yerine `node set-status.mjs --user {USER} <company> <Yeni_Durum>` komutunu kullanın.

Ayrıca istatistikleri de gösterin:
- Toplam başvuru sayısı
- Duruma göre dağılım
- Ortalama puan
- PDF oluşturulanların yüzdesi (%)
- Rapor oluşturulanların yüzdesi (%)
