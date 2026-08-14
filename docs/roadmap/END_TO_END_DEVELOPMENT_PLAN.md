# Brash Mapping & Twin Studio — Uçtan Uca Geliştirme Planı

**Plan tarihi:** 13 Ağustos 2026

**Plan sürümü:** 1.0

**Başlangıç durumu:** Faz 0 çekirdeği çalışıyor; 102 dosya ve 22 test yeşil.

> **14 Ağustos 2026 sahiplik güncellemesi:** Bu plandaki Survey Agent ve SLAM
> Worker iş paketleri Brash Embodied Controller ürününe aittir. Twin Studio
> yalnız versiyonlanmış survey/rekonstrüksiyon çıktısını alır, doğrular, CAD ile
> hizalar ve dijital ikize dönüştürür. Twin Studio içinde gerçek robot sensör
> sürücüsü, SLAM, localization, onboard autonomy veya safety runtime'ı
> geliştirilmeyecektir. Aşağıdaki eski bileşen adları dış entegrasyon sınırı
> olarak okunmalıdır.
**Kapsam:** Fabrika survey verisinden doğrulanmış 2B/3B dijital ikiz üretimi,
semantik varlık yönetimi, değişiklik algılama ve Fleet Control canlı 3B görünümü.

Bu belge fikir listesi değil, uygulanabilir ürün geliştirme sırasıdır. Her fazın
girdisi, çıktısı, bağımlılığı, kabul ölçütü ve durdurma koşulu tanımlanmıştır.
Fazlar takvim tarihinden çok kalite kapılarıyla ilerler.

**Uygulama ilerlemesi (13 Ağustos 2026):** Increment 1 — Gerçek PostgreSQL
bootstrap, Increment 2 — Migration runner, Increment 3 — Transaction/outbox,
Increment 4 — Object-store upload session, Increment 5 — Draft artefakt modeli ve
Increment 6 — Validation report ve Increment 7 — Atomik publication use-case
tamamlandı. Gerçek PostgreSQL 16 üzerinde sekiz
migration, iki eşzamanlı runner,
atomik draft+event kaydı, expiring-lease dispatcher, multipart upload
finalizasyonu/quarantine, append-only source/derived provenance zinciri ve sealed
validation job/report akışı, two-person approval, recoverable publication state
machine, React/TypeScript Studio Web shell ve shared-world 2B/3B viewer
doğrulandı. Sıradaki aktif iş Increment 10 — İlk importer.

---

## 1. Ürün vizyonu

Brash Mapping & Twin Studio, fabrikanın yalnızca görsel bir 3B modelini değil,
operasyonel olarak kullanılabilir ve sürümlü bir fabrika gerçeğini üretmelidir.

Sistem aşağıdaki üç gerçeği birbirinden ayırır:

- **As-designed:** CAD/BIM'in tarif ettiği tasarlanmış tesis.
- **As-observed:** LiDAR, kamera, IMU ve odometrinin gördüğü mevcut tesis.
- **As-operated:** Operatör tarafından doğrulanmış ve yayına alınmış dijital ikiz.

Tamamlanmış ürün şu uçtan uca döngüyü destekler:

```text
Fabrika kaynağı
  -> CAD/BIM içe aktarma
  -> Robot survey kaydı
  -> SLAM / 2B-3B rekonstrüksiyon
  -> CAD-scan hizalama ve fark analizi
  -> Semantik nesne önerileri
  -> Operatör doğrulama ve isimlendirme
  -> Navigasyon topolojisi düzenleme
  -> Kalite doğrulama
  -> Değişmez Twin Map Release
  -> Fleet Control harita tüketimi
  -> Canlı robot/rota/alarm 3B görünümü
  -> Tekrar survey
  -> Değişiklik adayı ve yönetici bildirimi
  -> İnsan onaylı yeni revision
```

## 2. Ürün tamamlandığında kullanıcı ne yapabilecek?

### 2.1 Mapping operatörü

1. Site, bina ve kat oluşturur.
2. DXF/IFC/SVG veya floorplan kaynağını yükler.
3. Robot survey oturumu başlatır veya mevcut survey paketini yükler.
4. Sensör kalitesi ve kapsama raporunu görür.
5. CAD ile SLAM sonucunu kontrol noktalarıyla hizalar.
6. Otomatik registration önerisini ve residual hata haritasını inceler.
7. 2B ve 3B görünüm arasında aynı nesneyi seçer.
8. Pano, konveyör, kapı, dock, workcell ve zone önerilerini doğrular.
9. Asset'e isim, sınıf, özellik, tolerans ve topoloji bağı verir.
10. Node, edge, station ve holding point grafiğini düzenler.
11. Validasyon hatalarını giderir.
12. İkinci bir onaylayıcıyla değişmez map release yayınlar.

### 2.2 Fabrika yöneticisi

1. Son doğrulanmış baseline'ı ve yeni survey'i karşılaştırır.
2. Taşınmış, kayıp, yeni veya şekli değişmiş varlık adaylarını görür.
3. Kamera görüntüsü, point-cloud segmenti ve konum farkını birlikte inceler.
4. Alarmı reddeder, saha kontrolü ister veya yeni konumu onaylar.
5. Onaylanan değişiklikten yeni map draft oluşturur.
6. Kim, ne zaman, hangi kanıtla baseline değiştirdiğini audit kaydında görür.

### 2.3 Fleet operatörü

1. Fleet Control içinde optimize edilmiş 3B fabrika sahnesini açar.
2. Robotları canlı konum, yön ve görev durumuyla izler.
3. Planlanan/aktif rota, trafik rezervasyonu, gecikme ve alarm katmanlarını görür.
4. Robotun geçmiş görevini zaman çizelgesinde replay eder.
5. 2B harita, 3B sahne ve operasyon listesinde aynı robot/asset'i seçer.

## 3. Kesin ürün sınırları

### Twin Studio'nun sahip olduğu veriler

- Ham survey ve sensör kalibrasyon kanıtı
- CAD/BIM kaynak dosyaları ve import raporları
- Coordinate-frame graph ve registration sonuçları
- Draft geometri, topoloji, zone ve semantik asset modeli
- Semantic observation ve change candidate geçmişi
- Yayınlanmış Twin Map Bundle ve Scene Manifest
- Map publication ve review audit'i

### Fleet Control'un sahip olduğu veriler

- Robot canlı durumu
- Görevler ve workflow'lar
- Trafik rezervasyonları
- Aktif rota ve güvenlik hold'u
- Fleet alarm ve operasyon replay olayları

### Özellikle yapılmayacaklar

- Twin Studio robotlara görev göndermeyecek.
- AI çıktısı insan onayı olmadan kalıcı asset olmayacak.
- Yayınlanmış release yerinde değiştirilmeyecek.
- Twin Studio Fleet Control veritabanına yazmayacak.
- Fleet Control ham point cloud veya SLAM pipeline çalıştırmayacak.
- 3B viewer güvenlik PLC'si veya robot safety sistemi kabul edilmeyecek.

---

## 4. Mevcut teknik başlangıç noktası

Halihazırda çalışan çekirdek:

- Bağımsız Node.js ESM workspace
- Yedi adet v1 JSON sözleşmesi
- 3B coordinate-frame transform graph
- Persist edilebilir map draft yaşam döngüsü
- Twin Map Bundle doğrulama, inspect, diff ve publish CLI'ı
- SHA-256 content-addressed artefakt store
- Atomik ve değişmez local release store
- PostgreSQL metadata migration'ları
- In-memory ve PostgreSQL catalog repository adapter'ları
- Site/bina/kat/family/draft/release Twin API
- OpenAPI v1 sözleşmesi
- Gerçek localhost HTTP dahil 22 yeşil test

Bu temel korunacak; yeni bileşenler mevcut contract ve immutability kurallarını
delmeyecek.

---

## 5. Hedef teknoloji kararları

Bu kararlar ilk mimari varsayımlardır. Her dış kütüphane için küçük bir teknik
spike, lisans ve performans kontrolü yapılmadan production bağımlılığı alınmaz.

### 5.1 Control plane

- **API ve domain:** TypeScript/Node.js.
- **HTTP:** OpenAPI-first, runtime şema doğrulamalı hafif bir framework.
- **Metadata:** PostgreSQL; spatial metadata için PostGIS.
- **Büyük dosya:** S3-uyumlu object store.
- **Job yönetimi:** İlk aşamada PostgreSQL claim/lease tabloları ve transactional
  outbox. Ayrı queue ürünü ancak ölçümle ihtiyaç görülürse eklenir.
- **Kimlik:** OIDC/OAuth 2.0; yerel geliştirmede sahte kimlik provider.
- **Telemetry:** OpenTelemetry uyumlu trace, metric ve structured log.

PostGIS `geometry` tipi planar koordinat sistemlerini ve sistem birimiyle spatial
işlemleri desteklediği için kat planı, footprint ve zone sorgularında kullanılacak;
ham mesh veya point cloud veritabanına konmayacaktır.

### 5.2 Spatial/ML worker plane

- **Worker dili:** Python; algoritma adapter arayüzleriyle çevrelenmiş CLI/job
  process'leri.
- **Survey edge:** ROS 2 mesajlarından bağımsız Raw Survey Package üretimi.
- **ROS tabanı:** Pilot için ROS 2 Jazzy LTS; resmi destek takviminde Mayıs 2029'a
  kadar destekli olduğu için saha ajanında kısa ömürlü dağıtımlara göre daha güvenli
  bir tabandır. Production başlangıcında destek takvimi yeniden doğrulanacaktır.
- **Point-cloud ara formatı:** Kaynak formatı değişmeden korunur; normalize edilmiş
  işlem artefaktları için LAZ/COPC veya eşdeğer tiled format benchmark edilir.
- **3B runtime teslimi:** GLB/glTF 2.0. glTF authoring değil runtime aktarım formatı
  olduğu için editable kaynak model ayrı tutulur.
- **Worker izolasyonu:** Her job immutable input, pinned container image ve
  deterministik config hash ile çalışır.

### 5.3 Web uygulaması

- **UI:** React + TypeScript.
- **3B:** Three.js tabanlı viewer; render motoru viewer-sdk arkasında tutulur.
- **2B:** Aynı world modelini kullanan ortografik spatial görünüm; gerekirse
  geometri editörü için ayrı 2B katman kütüphanesi.
- **State:** Server state ve editor undo/redo state birbirinden ayrılır.
- **Büyük sahne:** LOD, tile, frustum culling, progressive loading ve worker thread.
- **Ortak seçim:** 2B/3B her temsil aynı `assetId`, `nodeId`, `edgeId` kullanır.

### 5.4 Resmi teknik dayanaklar

- [ROS 2 dağıtım ve destek takvimi](https://docs.ros.org/en/humble/Releases.html)
- [glTF 2.0 resmi registry](https://registry.khronos.org/glTF/)
- [glTF 2.0 runtime aktarım hedefleri](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [PostGIS planar geometry modeli](https://postgis.net/docs/en/geometry.html)

---

## 6. Hedef sistem mimarisi

```text
                             +----------------------+
                             |     Studio Web       |
                             | 2B/3B edit + review  |
                             +----------+-----------+
                                        |
                                        v
+--------------+              +---------+----------+
| Survey Agent |--direct----->|      Twin API      |
| robot / edge |  object store| catalog / auth     |
+------+-------+              +----+-----------+---+
       |                           |           |
       |                      PostgreSQL       | signed URLs
       |                           |           v
       |                           |      +----+---------+
       |                           |      | Object Store |
       |                           |      +----+---------+
       |                           |           |
       v                           v           v
  Raw Survey                 Job Orchestrator / Outbox
                                  |
              +-------------------+-------------------+
              |                   |                   |
              v                   v                   v
       SLAM Worker          Fusion Worker      Semantic Worker
              |                   |                   |
              +-------------------+-------------------+
                                  |
                                  v
                        Draft / Validation / Review
                                  |
                                  v
                         Scene Worker / Packager
                                  |
                                  v
                         Immutable Map Release
                                  |
                 +----------------+----------------+
                 |                                 |
                 v                                 v
          Twin Studio viewer               Fleet Control importer
                                                   |
                                                   v
                                         Live 3B overlay / replay
```

## 7. Paralel iş akışları

Plan boyunca yedi iş akışı paralel fakat bağımlılık kontrollü ilerler.

| Kod | İş akışı | Ana sorumluluk |
|---|---|---|
| PLAT | Platform ve veri | API, PostgreSQL, object store, jobs, security |
| MAP | Mapping pipeline | Survey, SLAM, fusion, topology, release |
| WEB | Studio UX | 2B/3B editör, review, publication ekranları |
| SEM | Semantik/ML | Ontoloji, inference, asset eşleştirme, MLOps |
| CHG | Değişiklik | Baseline differencing, doğrulama, bildirim |
| FLEET | Fleet entegrasyonu | Bundle import, live overlay, replay |
| OPS | Kalite ve operasyon | CI/CD, test data, SLO, security, runbook |

---

## 8. Faz özeti ve tahmini sıra

Tahminler tam zamanlı, 6–8 kişilik çapraz fonksiyonlu ekip için mühendislik
aralıklarıdır; donanım erişimi ve saha testleri gecikirse takvim uzar. Küçük ekipte
fazlar daha az paralel yürütülür. Kalite kapısı geçmeden sonraki faz production
kapsamına alınmaz.

| Faz | Sonuç | Tahmini aralık | Ana kapı |
|---|---|---:|---|
| 0 | Temeli production'a hazırla | 4–6 hafta | M1 Durable Core |
| 1 | Manuel Mapping Studio MVP | 8–12 hafta | M2 Manual Twin |
| 2 | Survey Agent ve ingest | 6–9 hafta | M3 Trusted Survey |
| 3 | 2B/3B reconstruction | 8–12 hafta | M4 As-Observed |
| 4 | CAD/BIM fusion | 6–10 hafta | M5 Fused Twin |
| 5 | Semantik asset yardımcı | 8–12 hafta | M6 Semantic Twin |
| 6 | Değişiklik algılama | 8–12 hafta | M7 Change Assurance |
| 7 | Optimize 3B sahne/viewer | 6–10 hafta | M8 Runtime Scene |
| 8 | Fleet Control entegrasyonu | 6–10 hafta | M9 Live Fleet Twin |
| 9 | Üretim sertleştirme | 8–12 hafta | Production Ready |
| 10 | Fabrika pilotu ve GA | 8–16 hafta | General Availability |

Faz 3–4 ile Faz 7'nin bazı parçaları paralel çalışabilir. Faz 5 veri toplama,
Faz 3'te başlar. Faz 8, Fleet Control ekibinden ortak contract onayı gerektirir.

---

## 9. Faz 0 — Dayanıklı platform çekirdeği

### Amaç

Mevcut çalışan prototipi kalıcı database, güvenli upload, transaction ve production
contract temeline taşımak.

### PLAT-0 iş paketleri

1. Node workspace'i TypeScript build ve source-map altyapısına geçirmek.
2. PostgreSQL driver/bootstrap eklemek.
3. `schema_migrations` tablosu ve advisory-lock kullanan migration runner yazmak.
4. Migration'ları gerçek PostgreSQL üzerinde CI integration testine almak.
5. PostGIS extension ve site-local planar SRID stratejisini ADR ile sabitlemek.
6. Transaction portu ve request-scope unit-of-work oluşturmak.
7. Draft state değişikliği ile outbox event insert'ini aynı transaction'a almak.
8. Optimistic concurrency için HTTP `ETag/If-Match` veya açık `rowVersion`
   contract'ı seçmek.
9. S3-uyumlu object-store adapter yazmak.
10. Multipart upload başlat/tamamla/iptal endpoint'leri eklemek.
11. Upload boyutu, MIME sniffing, checksum ve quarantine politikası uygulamak.
12. Draft artefakt tablosu ve artefakt-role bağlarını eklemek.
13. Validation report'u immutable JSON artefaktı olarak üretmek.
14. Database + release store publication use-case'i tasarlamak.
15. Publication compensation/recovery job'u eklemek.
16. API OpenAPI request/response validation'ını runtime'da zorunlu yapmak.
17. Correlation ID, structured error ve audit actor context eklemek.

### OPS-0 iş paketleri

- CI'da lint, typecheck, unit, contract ve PostgreSQL integration aşamaları.
- Dependency/license/SBOM kontrolü.
- Testcontainer veya eşdeğer izole PostgreSQL/object-store test ortamı.
- Migration backward-compatibility ve restore smoke testleri.
- Secret'ların yalnız environment/secret store üzerinden alınması.

### Teslimatlar

- Production'a bağlanabilir Twin API
- Gerçek PostgreSQL catalog
- Güvenli direct-to-object-store upload
- Atomik publication application service
- `MapReleasePublished.v1` outbox olayı
- Otomatik migration runner

### M1 Durable Core kabul kapısı

- Yeni database sıfırdan kurulabiliyor.
- Migration runner iki kez çalıştırıldığında idempotent davranıyor.
- Aynı release iki paralel istekte yalnız bir kez yayınlanıyor.
- Database commit olup file publication tamamlanmazsa recovery işi durumu düzeltiyor.
- 10 GB sentetik upload API process belleğini şişirmeden object store'a gidiyor.
- Checksum uyuşmazlığı quarantine ile sonuçlanıyor.
- API ve PostgreSQL restart sonrası draft/release kaybı yok.
- Fleet Control repository bağımlılığı hâlâ sıfır.

---

## 10. Faz 1 — Manuel Mapping Studio MVP

### Amaç

SLAM veya AI olmadan operatörün CAD/floorplan ve hazır point cloud üzerinden
doğrulanmış bir 2B/3B map release üretebilmesi.

### WEB-1 uygulama kabuğu

1. React/TypeScript workspace ve component library kurmak.
2. OIDC-ready auth boundary ve local developer identity sağlamak.
3. Site/bina/kat seçici ve proje dashboard'u.
4. Draft status, job status ve validation sorun paneli.
5. Route-level error boundary, loading ve reconnect davranışı.
6. Klavye erişilebilirliği ve temel localization altyapısı.

### WEB-1 spatial editör

1. Ortak world coordinate store.
2. 2B orthographic görünüm ve 3B perspective görünüm.
3. Orbit/pan/zoom, ölçüm aracı ve coordinate readout.
4. Katman görünürlüğü: CAD, point cloud, mesh, asset, zone, topology.
5. Aynı ID ile 2B/3B ortak seçim.
6. Undo/redo command modeli.
7. Autosave ve stale `rowVersion` conflict UI.
8. Node, edge, station, holding point düzenleyici.
9. Polygon zone çizme/düzeltme.
10. Asset oluşturma, footprint/bounds düzenleme.
11. Kısayollar, snap/grid ve kontrollü numeric input.

### MAP-1 importer temeli

1. Importer plugin sözleşmesi.
2. SVG/floorplan importer.
3. Basit DXF katman/geometri importer.
4. PLY/PCD/E57/LAS gibi kaynaklar için dosya profil çıkarma.
5. Birim, eksen, bounds ve unsupported element raporu.
6. Kaynak dosya checksum/provenance kaydı.
7. Import'un draft'ı otomatik değiştirmeyip öneri üretmesi.

### MAP-1 manuel alignment

1. En az üç control point çifti seçme.
2. 2B rigid/similarity transform çözümü.
3. 3B control-point transform çözümü.
4. RMSE, max residual ve point başına hata gösterimi.
5. Transform preview/accept/reject.
6. Scale sapması için configurable yayın blokajı.
7. Dönüşüm provenance ve operator audit kaydı.

### MAP-1 draft validation

- Frame graph cycle/root kontrolü
- CAD/scan registration threshold
- Bounds ve unit doğrulaması
- Node/edge uniqueness ve reachability
- Station ve zone referansları
- Asset 2B footprint/3B bounds tutarlılığı
- Kritik station rota matrisi
- Önceki revision diff özeti
- Eksik scene artefaktı ve checksum

### M2 Manual Twin kabul kapısı

Bir operatör UI üzerinden:

1. Site ve kat oluşturur.
2. Bir CAD/floorplan ve hazır point cloud yükler.
3. Manuel hizalama yapar.
4. İki zone, en az dört asset ve bir bağlı navigasyon grafiği oluşturur.
5. Validasyon sorununu düzeltir.
6. İkinci kullanıcı onayıyla release yayınlar.
7. Release'i yeniden açtığında değiştiremez.
8. 2B ve 3B aynı asset'i aynı ID ile seçer.

Hedef UX: eğitimli mapping operatörü örnek katı 60 dakikanın altında release'e
hazırlayabilmelidir; süre pilot ölçümüyle revize edilir.

---

## 11. Faz 2 — Survey Agent ve güvenilir ingest

### Amaç

Robot/edge bilgisayardan senkronlu, doğrulanabilir ve bağlantı kesintisine dayanıklı
survey paketi üretmek.

### Survey Agent mimarisi

- ROS 2 adapter katmanı
- Sensor profile ve calibration registry
- Recorder ve chunker
- Yerel encrypted spool
- Upload state machine
- Health/coverage telemetry
- Remote survey command boundary

### AGENT-2 iş paketleri

1. LiDAR 2D/3D, RGB, depth, IMU, odometry message adapter'ları.
2. Sensor topic keşfi yerine explicit allowlist config.
3. Intrinsic/extrinsic calibration snapshot.
4. PTP/NTP/ROS clock quality ölçümü.
5. Monotonic timestamp ve clock offset metadata.
6. Disk quota ve backpressure.
7. Güç kesintisinde yeniden açılabilir chunk index.
8. Chunk başına SHA-256 ve manifest Merkle/aggregate hash.
9. Multipart upload resume.
10. Cihaz sertifikası ve mTLS.
11. Survey start/pause/resume/complete state machine.
12. Sensor dropout ve calibration stale alarmı.
13. Privacy mask veya kamera recording disable profili.
14. Kapsama preview için düşük çözünürlüklü trajectory/map stream.

### PLAT-2 ingest

1. Upload session endpoint'leri.
2. Chunk idempotency.
3. Complete işlemi sırasında manifest doğrulama.
4. Virus/file-type/quarantine kontrolü.
5. Raw Survey Package v1 schema validation.
6. Sensor/frame/timestamp coherence checks.
7. Survey-ready outbox olayı.
8. Retention tier ve legal hold alanları.

### M3 Trusted Survey kabul kapısı

- 2 saatlik survey bağlantı üç kez kesilse de veri kaybı olmadan tamamlanıyor.
- Eksik veya farklı checksum'lı chunk ile paket READY olmuyor.
- 100 ms üstü saat kayması kalite raporunda açıkça görülüyor.
- Calibration olmadan ilgili sensör verisi processing'e girmiyor.
- Disk doluluğu robot kontrol sistemini çökertmiyor; recorder kontrollü duruyor.
- Ham kayıt ve manifestten aynı session tekrar üretilebiliyor.

---

## 12. Faz 3 — SLAM ve 2B/3B rekonstrüksiyon

### Amaç

Raw Survey Package'tan tekrar üretilebilir, ölçümlenmiş ve belirsizliği korunmuş
as-observed fabrika modeli çıkarmak.

### Önce benchmark, sonra algoritma seçimi

Tek SLAM motoruna doğrudan bağlanılmayacak. Üç sensör profili için benchmark
hazırlanacak:

1. 2B LiDAR + odometri
2. 3B LiDAR + IMU + odometri
3. RGB-D/visual-inertial yardımcı profil

Her aday şu veri setlerinde ölçülecek:

- Uzun düz koridor
- Tekrarlı raf/kolon geometrisi
- Dinamik forklift/insan trafiği
- Döngü kapanışı olan kat
- Düşük texture/güneş parlaması
- Cam/yansıtıcı yüzey
- Kısmi sensör kaybı

### MAP-3 pipeline adımları

1. Preflight ve sensor quality gate.
2. Timestamp normalization.
3. Extrinsic frame resolution.
4. Motion compensation/deskew.
5. Odometry/pose estimation.
6. Loop closure.
7. Pose graph optimization.
8. Map/point-cloud assembly.
9. Dynamic point filtering.
10. Ground/floor plane estimation.
11. Downsample ve multi-resolution artefakt.
12. 2B occupancy/elevation projection.
13. Coverage ve blind-spot map.
14. Trajectory, covariance ve residual raporu.
15. Deterministic job manifest.

### Worker sözleşmesi

Her worker çıktısında:

- Input artefact hash'leri
- Container image digest
- Algorithm/plugin ID ve sürümü
- Parametre config hash'i
- Random seed
- Başlangıç/bitiş zamanı
- CPU/GPU ve peak memory
- Output hash'leri
- Kalite metrikleri
- Warning/error kodları

bulunmalıdır.

### MAP-3 kalite ölçütleri

Pilot başlangıç hedefleri; saha geometrisine göre yapılandırılabilir:

- Bilinen checkpoint translasyon hatası p95 ≤ 5 cm
- Kat düzlem drift'i ≤ 3 cm / 50 m
- Loop closure sonrası global tutarsızlık ≤ 10 cm
- Kapsama raporu hedef alanın ≥ %95'ini işaretliyor
- Aynı paket/config iki çalışmada eşdeğer geometri hash'i veya tolerans içi sonuç
- Başarısız kalite gate release'i otomatik blokluyor

### M4 As-Observed kabul kapısı

Üç temsil aynı canonical frame'de üretilir:

- Trajectory ve belirsizlik
- 2B occupancy/elevation
- 3B registered point cloud

Operatör kör noktayı, drift'i ve loop closure sorununu UI'da görebilir. Pipeline
aynı immutable survey'den tekrar çalıştırılabilir.

---

## 13. Faz 4 — CAD/BIM ve SLAM füzyonu

### Amaç

As-designed ve as-observed kaynakları deform etmeden ortak canonical frame'e
yerleştirmek ve aralarındaki farkları görünür kılmak.

### MAP-4 importer genişletme

- DXF layer, polyline, block ve unit handling
- IFC site/building/storey/product extraction
- CAD origin ve axis metadata
- BIM object ID/properties provenance
- Unsupported/ignored entity raporu
- Büyük dosya streaming parse

### MAP-4 registration

1. Manuel control point başlangıcı.
2. Feature/geometry tabanlı coarse alignment önerisi.
3. ICP veya uygun alternatifle fine registration.
4. Robust outlier rejection.
5. Scale kilidi; yalnız açık izinle similarity scale.
6. Floor/vertical axis constraint.
7. Residual heatmap.
8. CAD-only, scan-only, matched sınıflandırması.
9. Lokal ve global RMSE.
10. Alignment confidence ve operator acceptance.

### Asla yapılmayacak davranış

CAD çizgileri taramaya uysun diye sessizce eğilip bükülmez. Kaynak geometri,
transform ve residual fark ayrı saklanır. İleri non-rigid düzeltme gerekiyorsa bu,
yeni bir derived artefact ve açık audit kararı olur.

### M5 Fused Twin kabul kapısı

- Operatör en az iki bağımsız control-point setiyle sonucu doğrulayabiliyor.
- Global ve lokal registration hatası haritada görüntüleniyor.
- Belirlenen threshold üstünde release bloklanıyor veya formal waiver istiyor.
- CAD/BIM object provenance kaybolmuyor.
- Önceki accepted transform'a dönüş yapılabiliyor.
- CAD-only ve scan-only bölgeler değişiklik/inceleme katmanına aktarılıyor.

---

## 14. Faz 5 — Semantik asset yardımcı ve insan onayı

### Amaç

LiDAR/kamera verisinden pano, konveyör ve diğer fabrika varlıklarını önerip,
operatörün bunları kalıcı ve anlamlı TwinAsset kayıtlarına dönüştürmesini sağlamak.

### SEM-5 ontoloji

İlk kontrollü sınıf seti:

- ELECTRICAL_PANEL
- CONTROL_PANEL
- CONVEYOR
- WORKCELL
- DOOR
- ELEVATOR
- CHARGER
- DOCK
- RACK
- MACHINE
- SAFETY_SIGN
- FIRE_EQUIPMENT
- UNKNOWN_FIXED_ASSET

Her sınıf için:

- Gerekli ve opsiyonel özellikler
- Statik/semi-statik varsayımı
- Konum toleransı
- Minimum inference confidence
- Kaç doğrulama gerektiği
- Topoloji bağı türü
- Privacy/safety sınıfı

tanımlanır.

### SEM-5 veri programı

1. Consent ve privacy kurallı veri toplama.
2. Müşteri verisini tenant dışına çıkarmayan annotation pipeline.
3. 2B bounding box/segmentation ve 3B bounds annotation guideline.
4. Train/validation/test ayrımı site bazında yapılır; aynı fabrikanın yakın kareleri
   farklı setlere dağılmaz.
5. Difficult negative ve occlusion etiketleri.
6. Dataset version, license ve lineage.
7. Model card ve sınıf bazlı metrikler.

### SEM-5 inference pipeline

1. Kamera frame quality filtering.
2. 2B detection/segmentation.
3. Depth/LiDAR ile 3B projection.
4. Point-cloud cluster refinement.
5. Birden fazla frame observation association.
6. Pose/bounds uncertainty hesaplama.
7. Yakındaki baseline asset ile candidate match.
8. Kanıt frame/segment paketleme.
9. Review queue prioritization.

### WEB-5 review UI

- Görüntü ve mask overlay
- 3B segment isolate
- 2B footprint
- Suggested class ve confidence
- Yakın mevcut asset'ler
- Accept/reject/reclassify/merge/split
- Ad ve özellik formu
- Node/edge/zone binding
- Model feedback reason
- Bulk review, fakat kritik sınıflarda tekil kontrol

### Model yayına alma basamakları

1. Offline evaluation
2. Shadow mode — kullanıcıya gösterilmez
3. Suggestion mode — karar vermez
4. Limited auto-grouping — yalnız observation birleştirir
5. Hiçbir aşamada otomatik baseline mutation yok

### M6 Semantic Twin kabul kapısı

- Kritik sınıflarda suggestion precision hedefi ≥ %90.
- Sınıf bazlı recall raporu var; düşük recall gizlenmiyor.
- Her asset'in en az bir human review kararı ve provenance'ı var.
- Model/dataset sürümü her observation'da izlenebilir.
- Aynı asset 2B ve 3B'de aynı ID ile görünür.
- Model değişimi eski release'i değiştirmez.

---

## 15. Faz 6 — Değişiklik algılama ve bildirim

### Amaç

Yeni survey ile yayınlanmış baseline arasındaki gerçek değişiklikleri bulmak;
localization, occlusion ve geçici engellerden kaynaklanan yanlış alarmları azaltmak.

### CHG-6 değişiklik türleri

- `MOVED`
- `MISSING`
- `APPEARED`
- `GEOMETRY_CHANGED`
- `AISLE_BLOCKED`
- `SAFETY_ZONE_INTRUSION`
- `CAD_SCAN_MISMATCH`

### CHG-6 pipeline

1. Baseline release ve survey compatibility kontrolü.
2. Coordinate-frame ve registration quality gate.
3. Asset görünürlük analizi.
4. Kamera frustum ve LiDAR line-of-sight kontrolü.
5. Occlusion/temporary-object sınıflandırması.
6. Geometric differencing.
7. Semantic re-detection.
8. Asset association.
9. Position/orientation/bounds delta.
10. Site/asset policy threshold.
11. Tek survey adayını `SUSPECTED` durumuna alma.
12. Bağımsız tekrar gözlemlerini birleştirme.
13. Yeterli confirmation ile `CONFIRMED`.
14. Yönetici review.
15. Dismiss veya yeni draft'a apply.

### Yanlış alarm azaltma kuralları

- Robot localization kalitesi düşükse asset change üretilmez.
- Asset görüş alanında değilse `MISSING` üretilmez.
- Tek kareyle kritik varlık taşındı kararı verilmez.
- Asset policy'deki confirmation sayısı sağlanır.
- Hareketli/semi-statik nesne sabit pano gibi değerlendirilmez.
- İki farklı robot veya farklı gün gözlemi daha güçlü kanıt sayılır.
- Geçici forklift/palet için cooldown uygulanır.

### Bildirim mimarisi

Change Detection yalnız domain olayı üretir:

```text
ChangeCandidateSuspected.v1
ChangeCandidateConfirmed.v1
ChangeCandidateReviewed.v1
```

E-posta, mesajlaşma veya bakım sistemi adapter'ları outbox üzerinden abone olur.
Adapter başarısızlığı change kaydını kaybettirmez.

### CHG-6 değerlendirme seti

- Kontrollü pano taşıma
- Konveyör parçası değişimi
- Yeni palet/raf
- Kısmi occlusion
- Işık değişimi
- Robot localization offset
- Tarama açısı değişimi
- Gerçek missing asset
- Koridor blokajı

### M7 Change Assurance kabul kapısı

- Kontrollü pilot setinde kritik `MOVED/MISSING` recall ≥ %90.
- Operatöre sunulan confirmed change precision ≥ %95 hedefi.
- Yanlış alarm oranı site/survey bazında raporlanıyor.
- Baseline insan onayı olmadan değişmiyor.
- Her alarmın görüntü, 3B segment, delta ve model/config kanıtı var.
- Notification delivery retry ve dead-letter gözlemlenebilir.

---

## 16. Faz 7 — Optimize edilmiş 3B sahne ve Viewer SDK

### Amaç

Ham point cloud'u tarayıcıya göndermeden, büyük fabrikalarda akıcı ve kimlik
koruyan 3B runtime sahne üretmek.

### MAP-7 Scene Worker

1. Point-cloud cleaning ve duplicate removal.
2. Static/dynamic separation.
3. Mesh reconstruction veya surfel/point representation benchmark.
4. Semantic asset mesh ayrımı.
5. Spatial tile oluşturma.
6. LOD0/LOD1/LOD2 üretimi.
7. Texture resize ve compression.
8. glTF/GLB export.
9. Asset ID ile scene node metadata.
10. Tile bounds, checksum ve dependency manifest.
11. Empty/missing tile recovery.
12. Viewer budget raporu.

glTF runtime teslim formatıdır; editable source ve yüksek çözünürlüklü point cloud
ayrı artefakt olarak korunur. Büyük kat tek GLB olmak zorunda değildir; Scene
Manifest tile/LOD seçimini yönetir.

### WEB-7 Viewer SDK

- Scene Manifest loader
- Tile scheduler ve request cancellation
- Frustum/distance LOD
- Cache budget
- 2B/3B asset selection
- Robot model registry
- Pose interpolation buffer
- Route polyline/edge highlight
- Zone volume/overlay
- Alarm marker
- Timeline/replay state
- Screenshot ve shareable camera bookmark
- GPU capability fallback

### Performans bütçesi

Pilot hedefleri:

- İlk anlamlı sahne ≤ 5 saniye, saha ağı koşullarında
- İlk yükte ≤ 30 MB scene payload hedefi
- Desktop minimum 30 FPS, hedef 60 FPS
- Aynı anda 100 robot pose interpolation
- Live overlay render p95 ≤ 100 ms
- Viewer memory soft budget 1.5 GB; düşük cihaz profili ayrıca
- Tile checksum hatasında sahne çökmeden kullanıcıya hata

### M8 Runtime Scene kabul kapısı

- 100.000 m² sentetik/örnek sahnede progressive loading çalışıyor.
- Aynı asset 2B/3B seçiminde tutarlı.
- LOD geçişinde ID kaybolmuyor.
- Broken tile tüm viewer'ı çökertmiyor.
- Mobil/entegre GPU için graceful degradation var.
- glTF validator ve Twin Scene contract testleri yeşil.

---

## 17. Faz 8 — Fleet Control canlı 3B ve replay entegrasyonu

### Amaç

Twin Studio'nun statik sahnesini Fleet Control'un canlı operasyon verisiyle,
birbirinin veri sahipliğini bozmadan birleştirmek.

### Entegrasyon modeli

```text
Twin Studio -> MapRelease / SceneManifest / asset metadata
Fleet Control -> robot pose / mission / route / traffic / alarm / replay events
Viewer -> iki kaynağı mapReleaseId + frameId üzerinden birleştirir
```

### FLEET-8 contract işleri

1. `MapReleaseImported.v1` consumer sonucu.
2. `FleetLiveOverlay.v1` detaylandırma.
3. Robot pose sequence ve observedAt kuralları.
4. Frame/map release compatibility.
5. Route edge ID ve topology version bağı.
6. Alarm target ID kuralları.
7. Snapshot + incremental event envelope.
8. Reconnect/cursor/resume davranışı.
9. Replay event schema.
10. Contract compatibility matrix ve deprecation policy.

### FLEET-8 ilk entegrasyon sırası

1. Fixture tabanlı bağımsız demo viewer.
2. Fleet Control ekibine contract paketi.
3. Read-only map importer spike.
4. Release compatibility preview.
5. Feature flag arkasında 3B viewer.
6. Robot live pose.
7. Aktif rota ve rezervasyon overlay.
8. Alarm overlay.
9. Mission replay.
10. Production pilot.

### Canlı pose davranışı

- Telemetry out-of-order sequence ile reddedilir veya buffer edilir.
- Render, network frame'leri arasında interpolate eder.
- Telemetry staleness görünür olur; eski robot hareket ediyormuş gibi gösterilmez.
- Map release/frame uyuşmazlığında robot 3B sahneye sessizce konmaz.
- Z ekseni bilinmiyorsa floor binding ile kontrollü projection uygulanır.
- Pose source ve observedAt debug panelinde görülebilir.

### Replay

Replay; yalnız robot konumu değil aşağıdaki olayları aynı zaman çizgisinde oynatır:

- Mission state
- Robot pose
- Route revision
- Reservation/delay
- Safety hold
- Alarm lifecycle
- Infrastructure state

Replay üretim verisini değiştiremez ve live moddan görsel olarak ayrılır.

### M9 Live Fleet Twin kabul kapısı

- Fleet Control static bundle'ı read-only tüketiyor.
- Twin Studio Fleet Control database/API'sine yazmıyor.
- 50–100 robotluk sentetik stream akıcı görüntüleniyor.
- Pose staleness ve frame mismatch açıkça görünür.
- Aktif rota topolojide doğru edge'leri boyuyor.
- Aynı görev deterministic replay edilebiliyor.
- Feature flag kapatıldığında mevcut 2B Fleet operasyonu etkilenmiyor.

---

## 18. Faz 9 — Production hardening

### 18.1 Güvenlik

- OIDC ve RBAC roller: Viewer, Mapper, Reviewer, Approver, Admin, Service Agent
- Site/tenant row-level authorization
- Publication için iki kişi kuralı
- Device identity ve mTLS
- Signed URL scope/expiry/content-length
- Encryption at rest ve in transit
- Secret rotation
- Dependency, container ve SBOM scanning
- Audit log tamlığı
- Camera data privacy masking/retention
- Penetration test ve threat-model review

### 18.2 Güvenilirlik

- API multi-instance safety
- Job lease renewal/recovery
- Idempotency keys
- Object-store lifecycle ve replication
- Database PITR
- Release catalog backup
- Worker cancellation ve resource quota
- Dead-letter ve replay tooling
- Partial outage davranışı
- Disaster recovery tatbikatı

### 18.3 Gözlemlenebilirlik

Temel metrikler:

- API latency/error by operation
- Upload throughput/failure/resume
- Queue depth ve oldest job age
- Worker duration, retry ve failure code
- GPU utilization/memory
- Registration RMSE distribution
- SLAM drift/coverage
- Semantic precision/feedback
- Change confirmation/dismissal ratio
- Scene tile size/load time
- Fleet overlay staleness
- Notification delivery lag

### 18.4 SLO başlangıç hedefleri

- Catalog API availability: pilot %99.5, GA %99.9
- Metadata read p95: < 300 ms
- Draft mutation p95: < 500 ms
- Outbox event publication p95: < 5 saniye
- Critical notification p95: < 60 saniye, confirmed change sonrası
- RPO: 15 dakika
- RTO: 4 saat
- Published release checksum corruption: 0 tolerans

### 18.5 Veri yaşam döngüsü

Örnek başlangıç politikası:

- Raw camera: site/privacy politikasına göre 30–90 gün
- Raw LiDAR: 90–365 gün
- Derived processing artefact: yeniden üretilebilirliğe göre 180 gün+
- Published release: süresiz/audit gereksinimine göre
- Review/audit: yasal ve müşteri sözleşmesine göre
- Silme: soft-delete talebi, asynchronous purge ve audit tombstone

### Production Ready kabul kapısı

- Restore tatbikatı başarılı.
- Tenant isolation testi başarılı.
- Publication concurrent/failure testleri başarılı.
- 24 saat soak ve peak load testi başarılı.
- Güvenlik bulgularında açık kritik/yüksek konu yok.
- Operasyon runbook'ları görevli kişi tarafından uygulanmış.
- SLO dashboard ve alert'leri çalışıyor.

---

## 19. Faz 10 — Fabrika pilotu ve General Availability

### Pilot seçimi

İlk saha aşağıdaki özelliklerde olmalı:

- Tek bina, tek kat
- Ölçülebilir 5–20 bin m² alan
- CAD/BIM mevcut
- Kontrollü survey saatleri
- En az iki robot tipi gerektirmeyen basit survey platformu
- 20–100 kalıcı semantik asset
- Yönetici ve mapping operatörü atanmış
- Fleet Control entegrasyonu feature flag ile açılabilir

### Pilot dalgaları

#### Dalga A — Offline mapping

- CAD import
- Manuel alignment
- Survey/SLAM
- Manuel semantik asset
- Release publication

#### Dalga B — Semantik yardımcı

- Shadow inference
- Review ölçümü
- Ontoloji düzeltme
- Suggestion mode

#### Dalga C — Change detection

- Kontrollü varlık değişiklikleri
- False alarm analizi
- Bildirim ve review

#### Dalga D — Fleet canlı 3B

- Read-only sahne
- Robot pose
- Rota ve alarm
- Replay

### Pilot başarı ölçütleri

- Manuel map hazırlama süresi baseline'a göre en az %30 azalıyor.
- Kritik station/topology hatası release sonrası çıkmıyor.
- Operatör semantic suggestion'ların en az %70'ini küçük düzeltmeyle kabul ediyor.
- Confirmed change precision hedefi sağlanıyor.
- Fleet 3B viewer operatörün görev takibini aksatmıyor.
- Survey ve publication runbook'u ürün ekibi olmadan yerel kullanıcı uygulayabiliyor.
- Açık kritik güvenlik veya veri kaybı yok.

### GA öncesi karar

Pilot sonunda her özellik için:

- Tut
- İyileştir
- Feature flag arkasında bırak
- Kapsamdan çıkar

kararı metrik ve kullanıcı kanıtıyla verilir. Pilot verisi kötü olan AI özelliği,
ürün takvimini korumak için otomatik olarak baseline mutation yetkisi kazanmaz.

---

## 20. Uçtan uca test stratejisi

### 20.1 Test piramidi

1. **Unit:** transform, lifecycle, topology, scoring, differencing.
2. **Schema/contract:** JSON Schema, OpenAPI, event compatibility.
3. **Repository:** in-memory/PostgreSQL conformance.
4. **Integration:** PostgreSQL, object store, outbox, workers.
5. **Golden spatial:** bilinen transform ve beklenen geometri.
6. **ML evaluation:** versioned dataset ve class metrics.
7. **Browser E2E:** operatör yolculukları.
8. **Hardware-in-loop:** survey agent + sensör kayıt/replay.
9. **Performance:** upload, processing, scene, live overlay.
10. **Failure/chaos:** restart, network cut, corrupt chunk, worker death.

### 20.2 Golden dataset'ler

- Bilinen 2B transform'lu CAD/scan çifti
- Bilinen 3B control point seti
- Loop closure koridor survey'i
- Dinamik nesneli point cloud
- Pano/konveyör semantic seti
- Moved/missing/appeared kontrollü set
- Büyük tiled scene
- Fleet pose/route/replay event fixture'ı

Her golden dataset:

- Lisans ve kaynak
- Sensör profili
- Ground truth yöntemi
- Beklenen tolerans
- Privacy sınıfı
- Dataset version

taşır.

### 20.3 Kritik failure testleri

- Upload ortasında ağ kesilir.
- Aynı chunk iki kez gelir.
- Manifest checksum farklıdır.
- Worker lease sahibiyken process ölür.
- Publication rename öncesi disk/object store hatası olur.
- Database commit sonrası event delivery durur.
- Frame graph cycle içerir.
- CAD unit mm iken metre sanılır.
- Robot yanlış map release bildirir.
- Kamera asset'i görmüyordur fakat missing adayı üretilmemelidir.
- Live overlay event'leri out-of-order gelir.
- Replay ile live stream karışır.

---

## 21. API ve event sürümleme politikası

### HTTP

- URL major sürüm: `/api/v1`.
- Geriye uyumlu optional alanlar minor değişikliktir.
- Required alan/semantik değişimi yeni major gerektirir.
- Runtime OpenAPI validation zorunludur.
- Idempotent create için `Idempotency-Key` kullanılır.
- Concurrency için `If-Match` veya `rowVersion` zorunlu hale gelir.

### Event

Event envelope:

```json
{
  "eventId": "...",
  "eventType": "MapReleasePublished",
  "schemaVersion": 1,
  "aggregateId": "demo-plant@2",
  "occurredAt": "...",
  "correlationId": "...",
  "payload": {}
}
```

- Event payload geriye uyumlu genişletilir.
- Consumer cursor ve idempotency saklanır.
- Event silinmez/değiştirilmez; düzeltme yeni event'tir.
- Fleet consumer-driven fixture testleri ayrı repository import etmez.

### Bundle

- Bundle manifest major contract taşır.
- Artefaktlar checksum ve role ile adreslenir.
- Consumer compatibility açık metadata'dır.
- Publish öncesi tüm gerekli artefaktlar staging'de tekrar doğrulanır.
- Published bundle'a sonradan tile eklenmez; yeni revision/scene release gerekir.

---

## 22. UX ekran planı

### Ana ekranlar

1. Site dashboard
2. Survey session list/detail
3. Upload/import wizard
4. Processing job monitor
5. CAD–scan alignment workspace
6. 2B/3B map editor
7. Semantic observation inbox
8. Asset detail/property editor
9. Topology/zone editor
10. Validation report
11. Revision diff
12. Publication approval
13. Release catalog/viewer
14. Change candidate inbox/detail
15. Model/dataset quality dashboard
16. Admin/security/retention settings

### Kritik UX ilkeleri

- Spatial değişiklik preview olmadan kaydedilmez.
- Release ile draft görsel olarak ayrılır.
- Confidence ve uncertainty gizlenmez.
- AI önerisi ile doğrulanmış asset aynı renk/durumla gösterilmez.
- Hata yalnız kod değil, haritadaki konumuyla gösterilir.
- Destructive karar confirmation ve audit note ister.
- Uzun job'lar kullanıcı sekme kapatsa da devam eder.
- UI reconnect sonrası server snapshot'ına döner.

---

## 23. Güvenlik threat modeli başlangıcı

Korunacak varlıklar:

- Fabrika yerleşimi ve üretim hattı bilgisi
- Kamera görüntüleri
- Robot/sensör kimlik bilgileri
- Published map integrity
- Yönetici review kararları
- Fleet canlı konum verisi

Ana tehditler:

- Yetkisiz site verisi erişimi
- Signed URL sızıntısı
- Malicious CAD/mesh parser girdisi
- Zip/path traversal ve symlink
- Büyük dosyayla resource exhaustion
- Model/worker supply-chain saldırısı
- Sahte survey agent
- Release checksum manipülasyonu
- Audit kaydı atlama
- Cross-tenant model/data sızıntısı

Kontroller:

- Sandbox worker/container
- File-type sniffing ve parser timeout
- Boyut/triangle/point limitleri
- Tenant-scoped object keys ve DB authorization
- Device cert ve short-lived token
- Immutable checksum catalog
- Two-person publication
- Append-only audit/outbox
- Dependency/image signing
- Restore ve integrity scan

---

## 24. MLOps ve model yönetişimi

Her model sürümü şu artefaktları taşır:

- Model ID/version/hash
- Training code commit
- Dataset version ve split manifest
- Class ontology version
- Hyperparameter/config hash
- Offline metric report
- Site/domain limitations
- Known failure modes
- Approval ve rollout state

Model rollout:

```text
REGISTERED -> EVALUATED -> SHADOW -> SUGGESTION -> RETIRED
```

Model rollback eski observation'ı silmez. Yeni model eski survey üzerinde yeniden
çalıştırıldığında ayrı observation seti üretir. Model feedback doğrudan training
setine girmez; review ve privacy kontrolünden geçer.

Drift sinyalleri:

- Confidence dağılımı değişimi
- Sınıf bazlı accept/reject oranı
- Site/sensör bazlı precision düşüşü
- Unknown asset oranı
- Camera exposure/blur değişimi
- Point density değişimi

---

## 25. Operasyon runbook teslim listesi

Production öncesi aşağıdaki runbook'lar gerçek ortamda denenmiş olmalı:

1. Yeni site açma
2. Survey robot provision
3. Sensor calibration expiry
4. Upload resume/recovery
5. Corrupt survey quarantine
6. SLAM failure triage
7. Registration waiver/rejection
8. Draft validation failure
9. Publication ve two-person approval
10. Partial publication recovery
11. Release retirement
12. Incorrect change alert review
13. Notification dead-letter replay
14. Database restore
15. Object-store release integrity scan
16. Device credential revoke
17. Tenant export/delete
18. Fleet bundle compatibility rollback
19. 3B viewer performance incident
20. Security incident ve audit export

---

## 26. Ekip ve çalışma modeli

Önerilen çekirdek ekip:

- 1 ürün/teknik lider
- 2 platform/backend mühendisi
- 2 robotics/spatial mühendisi
- 1–2 web/3B mühendisi
- 1 ML/computer vision mühendisi
- 1 QA/automation; DevOps/SRE paylaşımlı
- Saha pilotunda mapping operatörü ve fabrika uzmanı

Küçük ekipte öncelik sırası değişmez; paralellik azalır. Fiziksel survey,
kalibrasyon, ground truth ve kullanıcı kabul görevleri yalnız yazılımla veya Codex
ile tamamlanmış sayılamaz.

### Çalışma ritmi

- 2 haftalık iteration
- Her iteration çalışan demo
- Her faz sonunda gate review
- ADR ile mimari karar
- Contract-first entegrasyon
- Feature flag ile riskli özellik
- Aylık dataset/model quality review
- Pilot döneminde haftalık saha feedback triage

---

## 27. Definition of Done

### Bir özellik tamamlandı sayılmak için

- Domain davranışı ve hata kodları tanımlı
- API/event/schema belgeli
- Authorization uygulanmış
- Unit ve integration testleri var
- Failure/retry/idempotency davranışı testli
- Metric/log/trace ekli
- Migration ve rollback/recovery yolu belli
- İlgili README/runbook güncel
- Hassas veri ve retention etkisi incelenmiş
- UI ise accessibility ve empty/error/loading state'leri tamam
- Performance budget ihlal etmiyor

### Bir faz tamamlandı sayılmak için

- Fazın kabul kapısı gerçek fixture veya pilot veriyle geçilmiş
- Açık kritik/yüksek güvenlik hatası yok
- Bilinen eksikler risk kaydında
- Demo değil tekrar çalıştırılabilir pipeline mevcut
- Operasyon ekibi runbook'u uygulayabiliyor
- Önceki release consumer'ları bozulmuyor
- Ölçümler dashboard'da görünür

---

## 28. Risk kaydı

| Risk | Etki | Erken sinyal | Azaltma |
|---|---|---|---|
| CAD ve gerçek fabrika büyük ölçüde farklı | Yüksek | Registration residual yüksek | Fark katmanı, insan review, yeni as-built kaynak |
| Tekrarlı koridorda SLAM drift | Yüksek | Loop closure instability | IMU/odometry, checkpoint, yeniden survey |
| Sensör zamanları senkron değil | Yüksek | Motion distortion | Clock quality gate, PTP/NTP, ingest reject |
| Kamera verisi privacy engeline takılır | Yüksek | Müşteri onayı yok | Kamera opsiyonel profil, edge masking, retention |
| Semantik model siteye genellenmez | Orta/Yüksek | Accept rate düşer | Site-split eval, suggestion-only, active learning |
| Değişiklik algılama alarm yağmuru üretir | Yüksek | Dismiss rate artar | Visibility, multi-confirmation, threshold tuning |
| Büyük point cloud web viewer'ı kilitler | Yüksek | Memory/FPS bütçesi aşılır | Tile/LOD/progressive load, budgets |
| İki harita revision'ı Fleet'te karışır | Yüksek | Frame mismatch | Explicit release ID, consumer contract, reject |
| Worker kütüphane/lisans sorunu | Orta/Yüksek | Legal/security scan | Adapter, SBOM, pinned image, alternative bakeoff |
| Object store ile DB publication ayrışır | Yüksek | Orphan/incomplete release | Staging, transaction/outbox, recovery reconciler |
| Saha donanımı geliştirmeyi bloke eder | Orta | Test verisi az | Recorded fixture, simulator, hardware calendar |
| Scope 3B görselliğe kayar | Yüksek | Validasyon/topoloji gecikir | Gate sırası, manual twin MVP önce |

---

## 29. İlk 12 somut geliştirme increment'i

Bu plan onaylandıktan sonra kodlama sırası:

### Increment 1 — Gerçek PostgreSQL bootstrap

- `pg` adapter paketi
- config validation
- connection pool
- health/readiness
- gerçek integration test

### Increment 2 — Migration runner

- schema version table
- checksum
- advisory lock
- CLI `migrate/status`
- concurrent startup testi

### Increment 3 — Transaction ve outbox

- unit-of-work port
- draft lifecycle event
- atomic save+outbox
- dispatcher claim/retry

**Durum:** 13 Ağustos 2026'da tamamlandı; in-memory rollback ve PostgreSQL 16
transaction/lease testleri kalite kapısından geçti.

### Increment 4 — Object-store upload session

- upload intent
- signed/multipart adapter
- completion checksum
- quarantine

**Durum:** 13 Ağustos 2026'da local/pilot object-store adapter'ı, provider-ready
upload plan sınırı, streaming multipart assembly, idempotent receipt, checksum ve
quarantine akışıyla tamamlandı. S3-uyumlu production signer/client bu davranış
sözleşmesini uygulayacak ayrı adapter olarak kalır.

### Increment 5 — Draft artefakt modeli

- source/derived artefakt role'leri
- upload-to-draft binding
- provenance
- immutable input references

**Durum:** 13 Ağustos 2026'da tamamlandı; tamamlanmış upload'a composite FK,
source/derived rol kuralları, spatial frame zorunluluğu, aynı-draft immutable input
kenarları, producer sürüm/config hash'i, append-only PostgreSQL trigger'ları ve
Twin API/OpenAPI yüzeyi gerçek PostgreSQL 16 + HTTP testlerinden geçti.

### Increment 6 — Validation report

- machine-readable issue schema
- report artefaktı
- draft validation job
- UI-ready location references

**Durum:** 13 Ağustos 2026'da tamamlandı; deterministic validator/config kimliği,
sealed draft input snapshot'ı, immutable JSON report artefaktı, UI-ready issue
konumları, multipart object-store yazımı, PostgreSQL validation-run guard'ları ve
job-backed Twin API/OpenAPI akışı 63/63 tam dış kalite kapısından geçti.

### Increment 7 — Atomik publication use-case

- two-person approval domain
- DB + release store state machine
- reconciliation worker
- published event

**Durum:** 13 Ağustos 2026'da tamamlandı; sealed bundle/draft/report identity,
append-only two-person approval, expiring recovery lease'i, immutable release
store ile PostgreSQL arasındaki iki kesinti noktasını toparlayan reconciler ve
atomik release+draft+audit+outbox finalizasyonu 68/68 tam dış kalite kapısından
geçti.

### Increment 8 — Studio Web shell

- auth boundary
- site/floor/draft screens
- OpenAPI client
- job/release status

**Durum:** 13 Ağustos 2026'da tamamlandı; React 19/TypeScript/Vite 6 kabuğu,
typed/abortable Twin API client, TanStack Query server-state sınırı, local identity
adapter'ı, site-to-draft workspace, validation/release durumları, EN/TR temel
localization ve responsive desktop/mobile arayüz 68 backend + 4 web testi,
production build, temiz dependency audit ve gerçek tarayıcı QA'sından geçti.

### Increment 9 — 2B/3B viewer skeleton

- world frame
- grid/axes/camera
- layer registry
- shared selection

**Durum:** 13 Ağustos 2026'da tamamlandı; rendering-engine-independent canonical
world store, lazy Three.js adapter, orthographic 2B/perspective 3B kameralar,
pan/zoom/orbit, metre coordinate readout, beş katmanlı registry, raycast ortak
selection ve 2.4 MP GPU buffer bütçesi 68 backend + 10 web testi, production
build ve gerçek desktop/mobile WebGL QA'sından geçti.

### Increment 10 — İlk importer

- SVG/floorplan
- source metadata
- units/bounds
- import report

**Durum:** 13 Ağustos 2026'da tamamlandı; güvenli SVG parser, aktif içerik ve
harici referans reddi, fiziksel birim/`viewBox` metre normalizasyonu, doğrusal
geometri ve transform çıkarımı, deterministik kaynak/config SHA-256 raporu,
gerçek fixture upload'u ve desktop/390 px WebGL QA'sı 68 backend + 18 web testi
ile doğrulandı.

### Increment 11 — Manuel spatial editor

- node/edge
- zone polygon
- asset footprint
- undo/redo

**Durum:** 13 Ağustos 2026'da tamamlandı; rendering-independent command store,
100-komut undo/redo, grid-snap node/asset yerleştirme, iki düğümlü edge bağlantısı,
zone çizim/preview, numeric inspector, cascade delete ve ortak 2B/3B seçim 68
backend + 24 web testi, production build, temiz dependency audit ve gerçek
desktop/390 px WebGL QA'sından geçti.

### Increment 12 — Manual Twin milestone

- alignment control points
- validate/diff
- approval
- publish
- release viewer

**Durum:** 13 Ağustos 2026'da tamamlandı; en az üç kontrol noktasından
deterministik similarity/rigid çözümü, residual/RMSE ve scale raporu, frame ve
topoloji kalite kapıları, feature diff'i, stale-evidence koruması, iki kişili
onay ve salt-okunur 2B/3B local release preview'u 68 backend + 30 web testiyle,
PostgreSQL 16 + ConSLAM + IfcOpenShell tam dış kapısıyla ve gerçek
desktop/390 px tarayıcı QA'sıyla doğrulandı. Production publication yetkisi Twin
API'de kaldı ve Fleet Control kaynaklarına dokunulmadı.

### Increment 13 — Embodied survey boundary

- Versioned processed-survey manifest and ingest-report contracts
- Explicit Brash Embodied Controller ownership boundary
- Manifest-only clock, frame, quality, hash, path, and declared-size validation
- Synthetic fixture and no-download GrandTour ETH-2 metadata plan

**Status:** Completed on August 14, 2026 without moving sensor drivers, SLAM,
localization, autonomy, or safety into Twin Studio.

### Increment 14 — Durable survey intake

- Atomic manifest and completed-upload attachment to an editable draft
- Immutable `OPEN -> ACCEPTED|REJECTED` verification state
- Server-resolved checksum, byte, media, site, and floor identity checks
- Twin API/OpenAPI create, list, inspect, and verify operations

**Status:** Completed on August 14, 2026. Verification reads only the bounded
JSON manifest; heavy survey artifacts stay in the object-store data plane.

### Increment 15 — Accepted survey materialization snapshot and real-data gate

- Accepted-intake-only immutable materialization snapshot and deterministic hash
- PostgreSQL composite manifest provenance and append-only job guard
- Twin API/OpenAPI create, get, and draft-list operations
- SHA-256-verifying GrandTour selection adapter with separate local/upstream paths
- Bounded DLIO Zarr-v2, TF, and binary PLY development inspector
- Versioned trajectory/frame/reconstruction preview contract

**Status:** Completed on August 14, 2026. The 290,764,702-byte GrandTour ETH-2
base selection passed official checksum verification and produced a bounded
preview from 4,305 odometry poses, 47,567 TF samples, and 17,388,758 PLY points.
The accepted-intake job creation path rereads only the bounded manifest; heavy
artifact execution remains worker-owned. PostgreSQL schema version 10, the full
backend/web gate, and the opt-in real-data integration test passed. Fleet Control
and robot-side SLAM sources were not changed.

### Increment 16 — Leased materialization and source-frame Studio preview

- Guarded `PENDING -> RUNNING -> SUCCEEDED|FAILED` execution with expiring
  leases, stale-owner rejection, and three-attempt bounded retry
- Standard coordinate-frame/calibration JSON, TUM trajectory, and binary XYZI
  PLY streaming adapter with checksum, byte, record, and preview budgets
- Deterministic content-addressed preview publication through completed upload
  provenance, plus API run and integrity-checked preview operations
- Shared 2D/3D trajectory, point-cloud sample, and reconstruction-bounds render
  with automatic fit-to-bounds navigation
- Explicit read-only source-frame mode that prevents unregistered SLAM survey
  coordinates from being presented as canonical CAD coordinates

**Status:** Completed on August 14, 2026. The synthetic accepted-intake flow
passed from multipart source uploads through HTTP materialization and preview
retrieval. Product execution contains no GrandTour/Zarr dependency, input
snapshots remain immutable, and successful output references the exact completed
upload and SHA-256 identity. Fleet Control and robot-side SLAM sources were not
changed.

### Increment 17 — Survey lineage and operator registration

- Bind every accepted materialization source as an immutable draft artifact
- Bind the bounded preview as a derived source-frame artifact with complete
  input lineage
- Store a versioned survey registration report with transform, residuals,
  metrics, solver identity, and configuration hash
- Expose registration create/list operations through Twin API and OpenAPI
- Add operator-editable control points and fused canonical 2D/3D survey views
- Preserve a separate read-only source-frame inspection mode
- Provide a compact no-download demo seed for reproducible local acceptance

**Status:** Completed on August 14, 2026. PostgreSQL migration 012, the real
PostgreSQL 16 repository gate, backend/web tests, HTTP end-to-end flow, and
in-app browser acceptance passed. The registration target is the draft canonical
frame; explicit CAD/BIM target-artifact binding and review approval remain the
next provenance gate. Fleet Control and robot-side SLAM sources were not changed.

### Increment 18 — Registration target evidence and acceptance gate

- Require a same-draft CAD/BIM or floorplan source in the canonical frame
- Seal source-preview and target-artifact identities into registration report v2
- Evaluate deterministic RMSE, maximum-error, and scale-deviation thresholds
- Store exactly one immutable approval or rejection by an independent reviewer
- Prevent approval when registration quality fails
- Expose target selection, quality, and reviewer controls in Studio Web

**Status:** Completed on August 14, 2026. Twin API, OpenAPI, JSON Schema,
PostgreSQL migration 013, service/API/web tests, and the local demo cover the
full target-to-review provenance chain. Fleet Control and robot-side SLAM
sources were not changed.

### Increment 19 — Survey quality review and coverage evidence

- Derive deterministic coverage, trajectory, frame, reconstruction-density, and
  warning metrics from a successful materialization preview
- Store a bounded source-frame occupancy grid for 2D/3D operator inspection
- Seal the quality report and one independent approval or rejection as immutable
  draft artifacts
- Prevent approval of failed quality and prevent registration without approved
  materialization-quality evidence
- Expose report generation, review, issues, metrics, and coverage layer in Studio

**Status:** Completed on August 14, 2026. JSON Schema, OpenAPI, PostgreSQL
migration 014, application/API/browser boundaries, deterministic tests, and the
idempotent local demo cover the quality-to-registration provenance chain. Fleet
Control and robot-side SLAM sources were not changed.

### Increment 20 — Publication registration gate and semantic candidates

- Verify registration acceptance content by immutable SHA-256 identity during
  release validation and fail eligibility unless the decision is `APPROVED`
- Publish draft-validation report v2 while retaining the legacy v1 schema
- Accept bounded model observations only as derived evidence with model and
  same-draft camera/LiDAR/survey provenance
- Transform observations into canonical asset candidates through one approved
  registration without automatically creating Twin assets
- Seal independent operator accept/reject, name, type, and scalar-property
  decisions as immutable review evidence
- Render unreviewed/accepted candidates in the shared 2D/3D Assets layer and
  keep rejected observations hidden

**Status:** Completed on August 14, 2026. JSON Schema, OpenAPI, PostgreSQL
migration 015, deterministic application/API/viewer tests, release-validation
gating, and the synthetic idempotent demo cover observation-to-review
provenance. Permanent asset promotion, change detection, Fleet Control, and
robot-side SLAM remain outside this increment.

### Increment 21 — Versioned Twin assets and observed changes

- Promote only accepted candidate decisions through an explicit audited command
  into immutable `TWIN_ASSETS` draft revisions
- Preserve stable asset identity, canonical 2D/3D geometry, change policy,
  source observation, candidate report, review, and predecessor lineage
- Compare a later approved-registration candidate report with the latest asset
  baseline using deterministic class-nearest matching
- Emit immutable review-required `MOVED`, `MISSING`, and `APPEARED` evidence
  without mutating the baseline or any published release
- Bound missing detection to the declared observed envelope and disclose this
  heuristic in both the report and Studio until explicit visibility evidence is
  available
- Render promoted assets and change markers in the shared Studio 2D/3D world

**Status:** Completed on August 14, 2026. Versioned JSON Schemas, OpenAPI,
PostgreSQL migration 016, application/API/viewer tests, and the deterministic
demo cover review-to-asset promotion and later-observation comparison. Change
confirmation, notifications, Fleet Control, and robot-side SLAM remain outside
this increment.

### Increment 22 — Controlled change decisions and revision application

- Seal one independent `CONFIRMED` or `DISMISSED` decision for every detected
  change and prevent the detector from reviewing its own report
- Require explicit acknowledgement before approximate `OBSERVED_ENVELOPE`
  missing evidence can be confirmed
- Apply confirmations only as a predecessor-linked draft Twin asset v2
  revision, retaining stable identities for moved assets and operator metadata
  for appeared assets
- Remove only confirmed missing assets, keep dismissed changes out of the
  revision, and leave every prior revision immutable
- Commit the new `TWIN_ASSETS` binding and `TwinAssetChangesApplied.v1` outbox
  event atomically so notification evidence cannot diverge from revision state
- Expose review/application controls and reviewed/applied geometry behavior in
  Studio without changing Fleet Control or robot-side SLAM

**Status:** Completed on August 15, 2026. Asset-change review v1, draft Twin
assets v2, OpenAPI, PostgreSQL migration 017, atomic persistence, deterministic
application/API/viewer tests, and the idempotent synthetic demo cover the full
detection-to-reviewed-revision chain. Production missing alerts remain disabled
until explicit calibrated sensor visibility evidence replaces the bounded
observed-envelope heuristic.

---

## 30. Karar kapıları

Bazı teknoloji kararları veri olmadan verilmemelidir:

### Gate A — Point-cloud storage

LAZ/COPC/eşdeğer adaylar gerçek survey boyutu, random spatial access, browser
delivery ve lisans açısından benchmark edilir.

### Gate B — SLAM motoru

Üç sensor profilinde golden dataset ölçümü olmadan seçim yapılmaz.

### Gate C — 3B representation

Mesh, splat/surfel veya point tile yaklaşımı GPU, kalite ve asset selection
ihtiyacına göre karşılaştırılır. Runtime çıkış yine Scene Manifest arkasında kalır.

### Gate D — Semantic model

İlk 1.000+ doğrulanmış observation ve sınıf dağılımı görülmeden model ailesi
production standardı ilan edilmez.

### Gate E — Queue teknolojisi

PostgreSQL claim/lease kapasitesi gerçek yükte yetmezse ayrı broker eklenir; erken
aşamada iki farklı durability sistemi işletilmez.

### Gate F — Fleet viewer yerleşimi

Viewer'ın Fleet Control içine native feature, microfrontend veya ayrı uygulama
olması bundle/live-overlay demo ölçümünden sonra kararlaştırılır.

---

## 31. Genel başarı ölçütleri

Ürün GA seviyesinde başarılı sayılmak için:

- Fabrika katı CAD + robot survey ile tekrar üretilebilir biçimde modellenebiliyor.
- 2B, 3B ve navigasyon topolojisi aynı coordinate frame ve ID modelini kullanıyor.
- Mapping operatörü AI olmadan dahi release üretebiliyor.
- AI yalnız verimlilik sağlıyor; güvenilirlik için zorunlu değil.
- Semantik asset'lerin tamamı provenance ve review geçmişine sahip.
- Taşınmış/kayıp kritik varlıklar kabul edilen precision/recall ile bulunuyor.
- Yayınlanmış map değişmez ve bütünlüğü denetlenebilir.
- Fleet Control doğru revision'ı tüketip robotları canlı 3B sahnede gösterebiliyor.
- Görev/rota/alarm deterministik replay edilebiliyor.
- Saha ekibi ürün geliştirme ekibi olmadan survey, review ve publication yapabiliyor.
- Backup/restore, security ve audit gereksinimleri kanıtla doğrulanmış.

---

## 32. Planın yaşayan belge olarak yönetimi

- Bu plan her faz kapısında sürümlenir.
- Tamamlanan iş `docs/status/README.md` içine işlenir.
- Mimari değişiklikler `docs/decisions/` altında ADR üretir.
- Faz hedefi değişirse neden, metrik ve etki yazılır.
- Kabul ölçütü sessizce gevşetilmez; waiver açık audit kararıdır.
- Fleet Control entegrasyon kapsamı yalnız ortak contract kararıyla genişletilir.

The next active work connects approved registration evidence to publication
eligibility and then begins semantic asset-candidate extraction from registered
survey evidence.
