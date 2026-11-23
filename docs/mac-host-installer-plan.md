# Kế hoạch: đóng gói máy chủ LumaPOS thành một app cài trên Mac

- **Ngày:** 2026-11-23
- **Trạng thái:** Đề xuất, chưa triển khai
- **Liên quan:** [ADR-0002](adr/0002-self-hosted-postgresql-nextjs.md),
  [ADR-0003](adr/0003-google-drive-backups.md),
  [self-hosted-operations.md](self-hosted-operations.md),
  [`ops/macos`](../ops/macos/README.md),
  app Mac `luma-pos-app/native-macos`

## 1. Mục tiêu

Cài máy chủ LumaPOS lên một Mac mới chỉ bằng một file `.dmg`: kéo app vào
Applications, mở app, làm theo trình hướng dẫn, kết thúc với
`pos.haidangshop.com` chạy trên máy mới. Không cần Terminal, Homebrew, mã
nguồn hay chép plist bằng tay.

Phạm vi:

1. Cài mới trên Mac trống (cửa hàng mới, hoặc khôi phục từ Google Drive).
2. Chuyển máy chủ từ Mac cũ sang Mac mới, có đối chiếu dữ liệu.
3. Cập nhật bản web và các thành phần đi kèm qua cơ chế cập nhật của app.

Ngoài phạm vi: VPS Linux (dùng `ops/systemd`, xem mục 9), nhiều cửa hàng trên
một máy, chạy hai primary song song (HA tự động).

## 2. Hiện trạng (2026-11-23)

| Thành phần | Cách đang chạy | Vấn đề khi đóng gói |
|---|---|---|
| App Mac | Console SwiftUI, không sandbox, ký ad-hoc, macOS 14+. Giám sát launchd, log, health, nút **Cập nhật web** | Chưa có trình cài, chưa ký Developer ID |
| Next.js | `bun run start:self-hosted` trong `/Users/Shared/LumaPOS/app` (888 MB, gồm `node_modules` và mã nguồn) | Build trên máy từ checkout Git |
| Worker sync / notifications / backups | `bun run …` chạy file `.ts` trong `src/scripts` | Cần `node_modules` đầy đủ |
| PostgreSQL 17 | Homebrew, LaunchAgent của user `cvthien` | Chỉ chạy khi user đó đăng nhập; phụ thuộc Homebrew |
| Bun, cloudflared, rclone | `/Users/Shared/LumaPOS/bin/bun`, Homebrew | Cài tay |
| Dịch vụ | 5 LaunchDaemon `com.lumapos.*` trong `/Library/LaunchDaemons`, user `_lumapos_svc` | Chép tay, cấp quyền qua hộp mật khẩu hoặc sudoers `lumapos-admin` |
| Secrets | `/Users/Shared/LumaPOS/secrets/*.env`, credential tunnel, `rclone.conf` (mode `0600`) | Tạo tay |
| DB production | `lumapos_prod`, role `lumapos_runtime` | — |

Điểm có sẵn để tận dụng: `LUMAPOS_POSTGRES_BIN_DIR` (`src/scripts/postgres-tools.ts`)
cho phép trỏ backup/restore vào binary PostgreSQL bất kỳ; `db:restore` đã khôi
phục được từ Drive; `run-service.sh` đã kiểm tra quyền file env; `lumapos-admin
deploy` đã có rollback.

## 3. Kiến trúc đích

```
LumaPOS.app (Developer ID, notarized)
└─ Contents/
   ├─ MacOS/LumaPOS                      ← console + trình hướng dẫn (SwiftUI)
   ├─ Library/LaunchDaemons/
   │   ├─ com.lumapos.helper.plist       ← helper root, đăng ký qua SMAppService
   │   ├─ com.lumapos.postgres.plist
   │   ├─ com.lumapos.web.plist
   │   ├─ com.lumapos.sync.plist
   │   ├─ com.lumapos.notifications.plist
   │   ├─ com.lumapos.backups.plist
   │   └─ com.lumapos.cloudflared.plist
   ├─ Helpers/lumapos-helper             ← XPC daemon chạy root (thay lumapos-admin + sudoers)
   └─ Resources/runtime/
       ├─ postgresql-17/{bin,lib,share}  ← binary relocatable, arm64
       ├─ bun, cloudflared, rclone
       ├─ web/                           ← Next.js `output: "standalone"`
       ├─ workers/lumapos-{sync,notifications,backups,restore,maintenance,migrate}
       │                                   ← `bun build --compile`, mỗi worker một file
       └─ migrations/                    ← SQL drizzle
```

Dữ liệu ở ngoài app, để thay app không mất gì:

```
/Users/Shared/LumaPOS/            (giữ đường dẫn hiện tại để store Mac không phải dời dữ liệu)
├─ runtime/<version>/             ← bản copy của Resources/runtime đang chạy (+ bản trước để rollback)
├─ current -> runtime/<version>
├─ postgres/data                  ← PGDATA, owner _lumapos_db, mode 0700
├─ media/  backup-staging/  logs/
└─ secrets/                       ← runtime.env, tunnel.json, rclone.conf (0600)
```

Quyết định thiết kế:

1. **Chạy runtime từ `/Users/Shared/LumaPOS/current`, không chạy thẳng từ trong
   app bundle.** Daemon không phụ thuộc việc app bị kéo đi chỗ khác hay bị
   Sparkle thay; cập nhật = helper chép runtime mới, chuyển symlink, khởi động
   lại, rollback nếu health lỗi (giống `lumapos-admin deploy`).
   Riêng `com.lumapos.helper` chạy từ bundle (bắt buộc với SMAppService).
2. **SMAppService thay sudoers.** Helper root chỉ nhận một danh sách lệnh cố
   định qua XPC (cài, cập nhật runtime, bật/tắt dịch vụ, đọc log, migrate,
   restore, chuyển máy), kiểm tra chữ ký code của app gọi tới
   (`SecCode` + team ID). Người dùng duyệt một lần trong *Cài đặt hệ thống ›
   Mục đăng nhập*. Sau khi chuyển xong, gỡ `lumapos-admin` và rule sudoers.
3. **PostgreSQL thành LaunchDaemon riêng**, user `_lumapos_db`, chỉ nghe
   socket + `127.0.0.1`. Không còn phụ thuộc user nào đăng nhập.
4. **Bản web và worker đi theo phiên bản app.** Một version app = một commit
   web cố định. Đơn giản cho cửa hàng, dễ rollback; giá phải trả là mỗi lần
   cập nhật web phải phát hành app (tự động hóa ở giai đoạn 5).
5. **Secrets không bao giờ nằm trong app hay bản cập nhật.** Trình hướng dẫn
   sinh hoặc nhận chúng lúc cài, helper ghi với owner/mode đúng.

## 4. Các giai đoạn

Mỗi giai đoạn chạy được độc lập và có kiểm tra trên store Mac thật trước khi
sang giai đoạn sau.

### Giai đoạn 1 — Bản runtime gọn, không cần mã nguồn (1–2 ngày)

Repo `luma-pos-web`.

1. `next.config.ts`: thêm `output: "standalone"`; giữ
   `outputFileTracingIncludes` cho `mediainfo.js` wasm; kiểm tra
   `serverExternalPackages` (`mediainfo.js`, `exifr`) được copy vào
   `standalone/node_modules`.
2. Chép `public/` và `.next/static` vào bản standalone (Next không tự chép).
3. Biên dịch worker bằng `bun build --compile --target=bun-darwin-arm64`
   (thêm `--conditions=react-server` như script hiện tại):
   `run-database-backups.ts`, `restore-database-backup.ts`, sync worker,
   notifications worker, `ops:maintenance`, `apply-migrations-from-database-url.ts`.
   Kiểm tra từng file chạy không cần `node_modules`.
4. Script mới `ops/runtime/build-runtime.sh <commit>` → tạo
   `lumapos-runtime-<version>-darwin-arm64.tar.zst` gồm `web/`, `workers/`,
   `migrations/`, `RELEASE_COMMIT`, `manifest.json` (version, commit, SHA-256
   từng file, phiên bản PostgreSQL tối thiểu).
5. `run-service.sh`: thêm chế độ chạy binary đã biên dịch
   (`workers/lumapos-sync` …) và `bun web/server.js` cho web; giữ chế độ cũ
   để chuyển dần.
6. Thử trên store Mac: deploy bản standalone bằng `lumapos-admin deploy` hiện
   có, chạy ít nhất 1 ngày, so sánh RAM/CPU và log.

**Xong khi:** bản runtime < 300 MB; web + 3 worker chạy từ bản này trên store
Mac; backup tự động và một lần `db:restore` vào DB tạm đều thành công; không
còn thư mục `src/` và `node_modules` đầy đủ trong release.

### Giai đoạn 2 — PostgreSQL, công cụ đi kèm và helper root (2–3 ngày)

Repo `luma-pos-app/native-macos` (+ script build trong `luma-pos-web/ops`).

1. Lấy PostgreSQL 17 arm64 relocatable (build từ source với
   `--prefix` tương đối, hoặc dùng bản dựng sẵn có giấy phép phân phối lại,
   kiểu Postgres.app); bỏ những gì không cần (docs, `pgxs`). Ghi rõ phiên bản
   và checksum vào `manifest.json`.
2. Đóng kèm `bun`, `cloudflared`, `rclone` với phiên bản cố định; ký lại bằng
   Developer ID (bắt buộc để notarize, vì chúng nằm trong bundle).
3. Target mới `LumaPOSHelper` (command-line, chạy root) + protocol XPC dùng
   chung. Lệnh tối thiểu:
   `installRuntime(version)`, `activateRuntime(version)`, `rollbackRuntime()`,
   `service(start|stop|restart, label)`, `readLog(label, lines)`,
   `initDatabase()`, `runMigrations()`, `restoreBackup(archiveID)`,
   `writeSecret(name, data)`, `createServiceAccounts()`, `exportForMove()`,
   `importFromMove()`, `uninstall(keepData:)`.
   Mọi đường dẫn do helper tự tính, không nhận đường dẫn tự do từ app.
4. Plist trong `Contents/Library/LaunchDaemons` dùng `BundleProgram` cho
   helper; các dịch vụ khác trỏ `/Users/Shared/LumaPOS/current/...` và
   `UserName` `_lumapos_svc` / `_lumapos_db`.
5. `AdminHelper.swift`: thay `sudo -n lumapos-admin` bằng client XPC; giữ
   đường lùi `lumapos-admin` đến khi giai đoạn 4 xong.
6. Bật Hardened Runtime; entitlement tối thiểu; `CODE_SIGN_STYLE` Manual với
   Developer ID Application cho bản phát hành.

**Xong khi:** trên một Mac thử (hoặc VM macOS 14), app ký Developer ID đăng
ký được helper, helper tạo được user dịch vụ, khởi tạo PGDATA, bật PostgreSQL
như daemon hệ thống, và sống qua khởi động lại máy khi không ai đăng nhập.

### Giai đoạn 3 — Trình hướng dẫn cài đặt (2–3 ngày)

Màn mới trong app Mac (VI/EN, theo `LumaTheme`), hiện khi chưa có
`/Users/Shared/LumaPOS/current`.

1. **Kiểm tra máy:** macOS ≥ 14, Apple silicon, dung lượng trống ≥ 20 GB,
   múi giờ `Asia/Ho_Chi_Minh` (đề nghị đổi nếu khác), cổng 3000/5432 trống,
   không có PostgreSQL Homebrew đang chạy cùng cổng.
2. **Cho phép helper:** hướng dẫn mở *Mục đăng nhập* và bật LumaPOS; app chờ
   `SMAppService.status == .enabled`.
3. **Chuẩn bị hệ thống:** tạo `_lumapos_svc`, `_lumapos_db`, thư mục, quyền;
   cài runtime đi kèm; `initdb`; tạo role `lumapos_runtime` (mật khẩu ngẫu
   nhiên, chỉ ghi vào `runtime.env`) và DB `lumapos_prod`.
4. **Chọn nguồn dữ liệu:**
   - *Khôi phục từ Google Drive:* đăng nhập Google qua rclone (OAuth trong
     trình duyệt), chọn archive, nhập khóa giải mã backup, chạy `restore`,
     hiện kết quả đối chiếu (số bảng, số media, checksum).
   - *Nhận từ máy cũ:* xem giai đoạn 4.
   - *Cửa hàng mới:* migrate schema trống + seed tối thiểu + tạo tài khoản
     chủ cửa hàng.
5. **Kết nối Internet:** đăng nhập Cloudflare (`cloudflared tunnel login`)
   hoặc dán credential tunnel có sẵn; chọn tunnel / tạo mới; ghi
   `cloudflared.yml` chỉ trỏ `127.0.0.1:3000`. Bước này có thể bỏ qua nếu chỉ
   dùng trong LAN.
6. **Sinh `runtime.env`** từ mẫu `.env.example` bằng giá trị đã thu thập
   (không bao giờ hiện secret lên màn hình).
7. **Bật dịch vụ** theo thứ tự postgres → migrate → web → workers → chờ
   `/api/health/ready` → cloudflared; kiểm tra URL công khai.
8. Màn kết quả: địa chỉ web, trạng thái backup đầu tiên, nút mở web.

**Xong khi:** trên Mac trống, từ lúc mở `.dmg` đến web chạy với dữ liệu khôi
phục từ Drive mất < 30 phút (không tính thời gian tải backup), không mở
Terminal lần nào.

### Giai đoạn 4 — Chuyển máy và chuyển store Mac hiện tại (2 ngày)

1. **Chuyển máy qua LAN** (mục mới "Chuyển máy chủ" trên cả hai máy):
   - Máy mới hiện mã ghép đôi 6 số + địa chỉ LAN; máy cũ nhập mã.
     Kênh truyền: TLS với khóa sinh tại chỗ, ghim bằng mã ghép đôi.
   - Máy cũ: bật chế độ chỉ đọc (web trả 503 cho ghi, client giữ hàng đợi
     offline) → chờ sync inbox và notification outbox rỗng → `pg_dump -Fc`
     `lumapos_prod` + tar media + secrets cần thiết (tunnel, rclone, các khóa
     tích hợp) → gửi sang.
   - Máy mới: restore, đối chiếu số dòng từng bảng + checksum media với
     manifest máy cũ gửi kèm; sai lệch thì dừng và không bật tunnel.
   - Đối chiếu đạt → máy cũ tắt cloudflared và mọi dịch vụ ghi, đánh dấu
     "đã chuyển đi" (không tự bật lại sau reboot) → máy mới bật cloudflared.
   - Máy cũ giữ nguyên dữ liệu 7 ngày để rollback, sau đó app nhắc xóa.
2. **Chuyển store Mac hiện tại sang cách cài mới** (một lần):
   - Backup Drive mới nhất + `pg_dump` thủ công trước khi bắt đầu.
   - Dừng dịch vụ, dump `lumapos_prod` từ PostgreSQL Homebrew, restore vào
     PostgreSQL đi kèm (cùng bản 17, không cần `pg_upgrade`), giữ nguyên
     `media/` và `secrets/`.
   - Gỡ 5 plist cũ trong `/Library/LaunchDaemons`, gỡ `lumapos-admin` và
     sudoers, tắt `brew services` PostgreSQL (giữ data cũ 7 ngày).
   - Kiểm tra health, URL công khai, iOS sync, backup đêm đầu tiên.
3. Cập nhật `self-hosted-operations.md`, `ops/macos/README.md`,
   README app Mac.

**Xong khi:** đã diễn tập chuyển máy hoàn chỉnh giữa hai Mac (hoặc Mac + VM),
kể cả trường hợp đối chiếu sai cố ý; store Mac chạy bằng cách cài mới ≥ 3 ngày
không lỗi.

### Giai đoạn 5 — Ký, notarize, phát hành và cập nhật (1–2 ngày)

1. Script `luma-pos-app/native-macos/scripts/release.sh`: build runtime (giai
   đoạn 1) → nhúng vào app → `xcodebuild archive` → ký Developer ID mọi binary
   lồng nhau → `notarytool submit --wait` → `stapler staple` → tạo `.dmg` →
   ký + notarize `.dmg`. Chỉ dùng CLI, không dùng Organizer.
2. Cập nhật tự động bằng Sparkle 2 (EdDSA): feed `appcast.xml` + file `.dmg`
   trên Cloudflare R2 (đã dùng cho media). App hiện "Có bản mới", người dùng
   bấm cập nhật; sau khi app mới mở, helper cài runtime mới với rollback.
3. Không cập nhật trong giờ bán hàng trừ khi người dùng chọn "Cập nhật ngay";
   mặc định đề nghị sau giờ đóng cửa.
4. Giữ đường cập nhật cũ ("build từ checkout") chỉ cho bản Debug trên máy dev.

**Xong khi:** một commit web mới → chạy `release.sh` → store Mac nhận cập
nhật qua Sparkle, chuyển runtime, health xanh; thử rollback bằng một bản cố
tình hỏng.

## 5. Nâng cấp PostgreSQL

- Bản vá (17.x → 17.y): thay binary trong runtime mới, khởi động lại daemon.
- Bản chính (17 → 18): app đóng kèm **cả hai** bản trong một phiên bản chuyển
  tiếp; helper chạy backup Drive → `pg_upgrade --link` sang PGDATA mới → kiểm
  tra → giữ PGDATA cũ đến khi người dùng xác nhận. `postgres-tools.ts` đã
  từ chối `pg_dump` khác phiên bản (`PG_DUMP_VERSION_MISMATCH`), nên trỏ
  `LUMAPOS_POSTGRES_BIN_DIR` vào đúng bản đang chạy.

## 6. Bảo mật

- Helper XPC chỉ chấp nhận app cùng team ID và bundle ID
  `com.lumasoft.lumapos.mac`; danh sách lệnh cố định, tham số có kiểm tra.
- Secrets ghi bởi helper, owner `_lumapos_svc`, mode `0600`; không log, không
  hiện trên UI, không nằm trong bản cập nhật, crash report hay archive chuyển
  máy ngoài kênh TLS đã ghim.
- PostgreSQL chỉ nghe loopback/socket; pgAdmin vẫn dùng tài khoản admin
  riêng.
- Gói chuyển máy mã hóa khi truyền; không ghi ra ổ ngoài.
- Gỡ cài đặt: mặc định giữ dữ liệu; xóa dữ liệu cần xác nhận hai lần và yêu
  cầu có backup Drive < 24 giờ.

## 7. Kiểm thử

- Unit test Swift: phân tích manifest, máy trạng thái của trình hướng dẫn,
  protocol XPC (helper giả).
- Test web: build standalone khởi động được, worker biên dịch chạy được
  `--help`/`--dry-run`, migrate trên DB trống.
- Diễn tập trên VM macOS 14 (Virtualization.framework hoặc UTM): cài mới, khôi
  phục Drive, reboot không đăng nhập, cập nhật, rollback, gỡ cài.
- Diễn tập chuyển máy giữa hai máy thật trước khi dùng cho store Mac.

## 8. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Next standalone thiếu file (wasm, native module) | Test mọi route dùng `mediainfo.js`/`exifr`; giữ chế độ chạy cũ đến khi chạy ổn 1 ngày |
| `bun build --compile` không bundle được thư viện nào đó | Fallback: worker chạy `bun` với `node_modules` tối thiểu đã trace |
| Notarize từ chối binary lồng nhau (PostgreSQL, rclone, cloudflared) | Ký lại từng file với Hardened Runtime trong `release.sh`; kiểm tra bằng `codesign --verify --deep --strict` |
| SMAppService daemon cần người dùng duyệt, dễ bị bỏ qua | Trình hướng dẫn chặn ở bước này, có hình hướng dẫn và nút mở đúng trang Cài đặt |
| Chuyển máy lỗi giữa chừng | Máy cũ chỉ tắt sau khi đối chiếu đạt; máy cũ giữ dữ liệu 7 ngày |
| App lớn (~400–500 MB) | Chấp nhận; Sparkle tải bản đầy đủ. Sau này có thể dùng delta update |
| Cập nhật web phải phát hành app → chậm hơn hiện tại | Tự động hóa `release.sh`; bản Debug vẫn build từ checkout |

## 9. Liên quan VPS

Giai đoạn 1 (runtime gọn, worker biên dịch, `manifest.json`) dùng chung cho
VPS: build thêm target `linux-x64`/`linux-arm64` và dùng `ops/systemd`. Quy
trình chuyển máy ở giai đoạn 4 nên tách phần dump/đối chiếu thành worker
`lumapos-migrate-host` để VPS dùng lại được qua CLI.

## 10. Cần chốt trước khi làm

1. Tài khoản Apple Developer dùng cho Developer ID (cùng team với TestFlight?).
2. Nguồn PostgreSQL đóng kèm: tự build hay dùng bản dựng sẵn (kiểm tra giấy
   phép phân phối lại).
3. Web đi theo phiên bản app (đề xuất) hay tải runtime riêng.
4. Nơi đặt feed Sparkle: R2 với domain `updates.haidangshop.com` hay tên khác.
5. Có cần chế độ chỉ-LAN (không Cloudflare) trong trình hướng dẫn ngay từ đầu.

## 11. Ước tính

| Giai đoạn | Thời gian |
|---|---|
| 1. Runtime gọn | 1–2 ngày |
| 2. PostgreSQL + helper | 2–3 ngày |
| 3. Trình hướng dẫn | 2–3 ngày |
| 4. Chuyển máy + chuyển store Mac | 2 ngày |
| 5. Ký, phát hành, cập nhật | 1–2 ngày |
| **Tổng** | **8–12 ngày làm việc** |
