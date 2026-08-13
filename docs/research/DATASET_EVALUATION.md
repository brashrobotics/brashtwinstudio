# Gerçek Dünya Dataset Değerlendirmesi

Son güncelleme: 13 Ağustos 2026

## Amaç

Mapping & Twin Studio'nun yalnız sentetik fixture'larla değil, gerçek bir
endüstriyel ortamın BIM ve çok oturumlu ölçüm verileriyle sınanması. Bu belge
dataset seçimini, kullanım sınırını ve ilk doğrulama kanıtını kaydeder.

## Adaylar

| Dataset | Ortam/veri | Güçlü taraf | Karar |
|---|---|---|---|
| ConSLAM + BIM/GT Poses | İnşaat alanı; LiDAR, RGB, IMU, TLS, IFC, çok oturum | BIM ile aynı referansa alınmış dört oturum; değişiklik/uzun dönem haritalama için en yakın eşleşme | İlk doğrulama datası |
| Hilti SLAM Challenge 2022 | İnşaat alanı; 5 kamera, LiDAR, IMU, ground truth | SLAM algoritması benchmarkı ve mm-seviye referans | Ham SLAM benchmarkının ikinci datası |
| Hilti–Trimble 2026 | İnşaat alanı; çift fisheye, IMU, floorplan, LiDAR tabanlı GT | Floorplan localization ve as-designed/as-observed sapmaları | 2B lokalizasyon benchmarkı |
| Trimble sample data | IFC ve taranmış point cloud örnekleri | Kolay indirilebilir format smoke testleri | Vendor format uyumluluğu için yedek |

Kaynaklar:

- ConSLAM: <https://github.com/mac137/ConSLAM>
- ConSLAM BIM/GT: <https://mediatum.ub.tum.de/1743877>
- ConSLAM BIM/GT DOI: <https://doi.org/10.14459/2024mp1743877>
- Hilti 2022: <https://github.com/Hilti-Research/Hilti-SLAM-Challenge-2022>
- Hilti–Trimble 2026: <https://github.com/Hilti-Research/hilti-trimble-slam-challenge-2026>

## Seçim

İlk data gate için **ConSLAM BIM and GT Poses** seçildi. Nedenleri:

1. IFC modeli ile LiDAR oturumlarının ground-truth pozları aynı koordinat
   bölgesinde.
2. Dört ayrı tarihteki oturum değişiklik tespiti ve uzun dönem haritalama için
   uygun.
3. İlk kapıda yalnız IFC ve pozlar indirildiğinde veri yaklaşık 9 MB.
4. IFC dosyası IfcOpenShell ile doğrudan triangulate edilebiliyor.
5. Aynı datasetin ham LiDAR/RGB/IMU verisi sonraki SLAM benchmarkında
   kullanılabiliyor. Upstream uyarısına göre hatalı sequence 1 kullanılmayacak.

## Lisans sınırı

BIM/GT paketi CC BY-NC 4.0, upstream ConSLAM yazılım/veri kullanımı ise akademik
kullanım kısıtı bildiriyor. Bu nedenle:

- Dataset yalnız dahili geliştirme ve değerlendirmede kullanılır.
- Kaynak dosyalar `.local/datasets/` altında Git dışında tutulur.
- Veri binary, container, ürün kurulumu veya Twin Map Bundle ile dağıtılmaz.
- Ticari müşteri kabul testi için daha sonra Brash'a ait ya da ticari kullanıma
  açık saha kaydı gerekir.

## Uygulanan doğrulama

Descriptor:
`tests/fixtures/datasets/conslam-bim-gt.dataset.json`

| Kapı | Sonuç | Kanıt |
|---|---|---|
| Provenance ve bütünlük | PASS | Resmi SHA-512 ile 5/5 dosya ve byte boyutu eşleşti |
| IFC parser | PASS | IFC2X3, 139.428 STEP entity, milimetre kaynak birimi |
| Spatial yapı | PASS | 1 proje, 1 site, 1 bina, 32 storey |
| Semantik BIM sayımı | PASS | 1.069 duvar, 153 slab, 6 kapı, 23 pencere, 205 proxy |
| Gerçek geometri üretimi | PASS | IfcOpenShell 0.8.5 ile 2.534/2.534 ürün triangulate edildi |
| Mesh özeti | PASS | 61.339 vertex, 114.065 triangle |
| BIM 3B bounds | PASS | min `[43.5295, 34.3639, -0.655]`, max `[210.2434, 120.6505, 23.5794]` metre |
| TUM trajectory | PASS | 4 session, 1.388 pose, toplam 1.246,588 m yol |
| Quaternion ve zaman sırası | PASS | Sonlu değer, strict artan timestamp, normalize quaternion |
| Ortak koordinat bölgesi | PASS | Birleşik trajectory bounds bütünüyle BIM bounds içinde |
| Ham SLAM çalıştırma | NOT RUN | Raw bag/scan kesiti bir sonraki data gate |
| CAD–SLAM registration hatası | NOT RUN | Bu pakette pozlar zaten referansa hizalı; bağımsız estimate gerekli |

Ground-truth trajectory dosyaları ham sensör frekansında değildir. Session 2,
3 ve 4 içinde 10 saniyeden uzun poz aralıkları bulundu; importer bunları
`REFERENCE_TRAJECTORY_GAP` kalite uyarısı olarak raporlar, bütünlük hatası olarak
değil.

## Tekrarlanabilir çalışma

İndirme ve haklar için `tests/fixtures/datasets/README.md`, CLI kullanımı için
`tools/dataset-cli/README.md` izlenir.

```bash
npm run dataset:verify -- \
  tests/fixtures/datasets/conslam-bim-gt.dataset.json \
  .local/datasets/conslam-bim-gt

npm run dataset:inspect -- \
  tests/fixtures/datasets/conslam-bim-gt.dataset.json \
  .local/datasets/conslam-bim-gt \
  --ifcopenshell-python .local/venv-ifc/bin/python

TWIN_TEST_CONSLAM_DIR=.local/datasets/conslam-bim-gt \
TWIN_IFCOPENSHELL_PYTHON=.local/venv-ifc/bin/python \
node --test tests/integration/conslam-dataset-live.test.js
```

## Sonraki data gate

1. ConSLAM sequence 2 ham LiDAR/RGB/IMU verisinin boyutunu ve formatını
   doğrula; mümkünse kısa, lisansla uyumlu yerel evaluation kesiti oluştur.
2. ROS 1 bag kaydını immutable kaynak olarak koruyup işleme kopyasını MCAP'e
   dönüştür.
3. KISS-ICP ve RTAB-Map'i aynı kesitte çalıştır.
4. Üretilen trajectory'yi GT ile ATE/RPE üzerinden karşılaştır.
5. Üretilen point cloud'u IFC'ye coarse alignment + ICP ile hizala.
6. Fitness, RMSE, overlap ve operatör onay gereksinimini raporla.

Bu kapı geçmeden “SLAM ve CAD füzyonu doğrulandı” kabul edilmeyecektir.
