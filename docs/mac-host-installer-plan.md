# Kế hoạch: đóng gói máy chủ LumaPOS thành một app cài trên Mac

- **Ngày:** 2026-11-23, cập nhật 2026-11-24
- **Trạng thái:** Đề xuất, chưa triển khai
- **Ràng buộc (2026-11-24):** không có tài khoản Apple Developer. Không dùng
  Developer ID, notarize, team ID hay `SMAppService.daemon`; app ký ad-hoc và
  chỉ cài trên máy của chủ cửa hàng.
- **Liên quan:** [ADR-0002](adr/0002-self-hosted-postgresql-nextjs.md),
  [ADR-0003](adr/0003-google-drive-backups.md),
  [self-hosted-operations.md](self-hosted-operations.md),
  [`ops/macos`](../ops/macos/README.md),
  app Mac `luma-pos-app/native-macos`

## 1. Mục tiêu

Cài máy chủ LumaPOS lên một Mac mới chỉ bằng một file `.dmg`: kéo app vào
Applications, cho phép mở lần đầu (mục 4, giai đoạn 5), làm theo trình hướng
dẫn, kết thúc với `pos.haidangshop.com` chạy trên máy mới. Không cần
Homebrew, mã nguồn hay chép plist bằng tay; Terminal chỉ cần cho một lệnh gỡ
cờ cách ly nếu người cài chọn cách đó.

Phạm vi:

1. Cài mới trên Mac trống (cửa hàng mới, hoặc khôi phục từ Google Drive).
2. Chuyển máy chủ từ Mac cũ sang Mac mới, có đối chiếu dữ liệu.
3. Cập nhật bản web và các thành phần đi kèm qua cơ chế cập nhật của app.

Ngoài phạm vi: VPS Linux (dùng `ops/systemd`, xem mục 9), nhiều cửa hàng trên
một máy, chạy hai primary song song (HA tự động).

## 2. Hiện trạng (2026-11-23)

| Thành phần | Cách đang chạy | Vấn đề khi đóng gói |
|---|---|---|
| App Mac | Console SwiftUI, không sandbox, ký ad-hoc, macOS 14+. Giám sát launchd, log, health, nút **Cập nhật web** | Chưa có trình cài; không có tài khoản Apple Developer nên chỉ ký ad-hoc |
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
LumaPOS.app (ký ad-hoc, không notarize)
└─ Contents/
   ├─ MacOS/LumaPOS                      ← console + trình hướng dẫn (SwiftUI)
   └─ Resources/
       ├─ admin/lumapos-admin            ← helper root (bản mở rộng của ops/macos/lumapos-admin)
       ├─ launchd/com.lumapos.{postgres,web,sync,notifications,backups,cloudflared}.plist
       └─ runtime/
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
   thay; cập nhật = helper chép runtime mới, chuyển symlink, khởi động lại,
   rollback nếu health lỗi (giống `lumapos-admin deploy`).
2. **Giữ mô hình helper hiện tại, không dùng SMAppService.** Không có team ID
   thì không đăng ký `SMAppService.daemon` ổn định được và không kiểm tra được
   "đúng app LumaPOS gọi tới" bằng chữ ký. Lần cài đầu, trình hướng dẫn hỏi
   mật khẩu admin **một lần** (hộp thoại macOS) để chép `lumapos-admin` vào
   `/usr/local/libexec` (owner `root:wheel`, mode `0755`), cài rule sudoers
   chỉ cho phép đúng file đó, và chép plist vào `/Library/LaunchDaemons`.
   Sau đó app gọi `sudo -n lumapos-admin <lệnh>` như hiện nay. An toàn dựa
   vào: helper thuộc root, không ai khác sửa được; danh sách lệnh cố định;
   mọi đường dẫn do helper tự tính; tham số được kiểm tra.
3. **PostgreSQL thành LaunchDaemon riêng**, user `_lumapos_db`, chỉ nghe
   socket + `127.0.0.1`. Không còn phụ thuộc user nào đăng nhập.
4. **Bản web và worker tách khỏi app.** Không notarize thì mỗi lần thay app
   có thể phải cho phép mở lại, nên app nên ít đổi. Runtime (web + worker +
   PostgreSQL bản vá) là gói riêng `lumapos-runtime-<version>.tar.zst`, app tự
   tải, kiểm tra chữ ký EdDSA và SHA-256, rồi helper cài. Bản `.dmg` đầu tiên
   vẫn chứa sẵn một runtime để cài được khi chưa có mạng.
5. **Secrets không bao giờ nằm trong app hay bản cập nhật.** Trình hướng dẫn
   sinh hoặc nhận chúng lúc cài, helper ghi với owner/mode đúng.

## 4. Các giai đoạn

Mỗi giai đoạn chạy được độc lập và có kiểm tra trên store Mac thật trước khi
sang giai đoạn sau.

### Giai đoạn 1 — Bản runtime gọn, không cần mã nguồn (1–2 ngày)

> **Đã triển khai 2026-11-24** (commit `05913beb`, store Mac chạy bản này).
> Khác so với kế hoạch: worker không dùng `bun build --compile` (mỗi file
> ~61 MB vì nhúng Bun) mà `bun build` thành `workers/*.js` chạy bằng Bun dùng
> chung; release ghép phẳng ở gốc (`server.js`, `.next`) để `lumapos-admin
> deploy` không phải đổi; chưa tạo file `.tar.zst` (để giai đoạn 5). Kết quả:
> release 117 MB (trước 888 MB); web, sync, notifications chạy từ release
> mới, health `ready`. Ngày 2026-11-25 worker backup cũng chuyển sang `app`
> (`ExitTimeOut` 900; `lumapos-admin` v3 chỉ khởi động lại nó khi rảnh).
> **Còn lại:** chưa diễn tập `restore` bằng bundle mới.

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

### Giai đoạn 2 — PostgreSQL, công cụ đi kèm và helper root (2 ngày)

> **Đã làm phần build và helper 2026-11-25; chưa chạy thử quyền root trên Mac
> trống.**
> - `ops/macos/build-postgres.sh`: tự build PostgreSQL 17.11 từ mã nguồn
>   (kiểm SHA-256 của postgresql.org), không ICU (DB dùng locale libc), có
>   contrib (`pg_trgm`), lz4, zstd, OpenSSL; thư viện chép vào `lib/`, mọi
>   file Mach-O dùng `@rpath`, ký ad-hoc. 32 MB (nén 10 MB). Đã thử: chép sang
>   thư mục khác vẫn chạy; `initdb`, `pg_trgm`, `pg_dump` zstd; khôi phục bản
>   dump `lumapos_prod` vào đó, số dòng 151 bảng khớp.
> - `ops/macos/build-tools-bundle.sh`: bun, cloudflared, rclone (một file
>   arm64, chỉ link thư viện hệ thống), ghi phiên bản + SHA-256.
> - `ops/macos/assemble-runtime.sh`: ghép `app/` (release runtime),
>   `postgresql-17/`, `tools/bin/` + `manifest.json` (format 2, SHA-256 từng
>   file) thành `lumapos-runtime-<version>.tar.gz` (320 MB, nén 113 MB).
>   Release có thêm `sql/` (compat + grant) cho bước migrate.
> - `lumapos-admin` v4: `bootstrap <user>` (chỉ từ hộp mật khẩu, từ chối khi
>   chạy qua sudoers), `create-accounts`, `install-runtime` (kiểm mọi file
>   theo manifest, từ chối symlink ra ngoài/file đặc biệt, cây thành của root),
>   `activate-runtime` (đổi `current`, chỉ khởi động lại PostgreSQL khi bản
>   PostgreSQL đổi, migrate, rollback nếu web không lên), `rollback-runtime`,
>   `init-database` (role `lumapos_owner` cho migrate + `lumapos_runtime`,
>   mật khẩu ngẫu nhiên chỉ ghi vào `runtime.env`), `migrate`,
>   `write-secret`, `status`; plist launchd do helper tự sinh. Plist cũ của
>   store Mac (không chạy từ `current`) được giữ nguyên.
> - App Mac: build phase chép helper vào `Contents/Resources/admin/`;
>   `AdminHelper` có `bootstrap`, so phiên bản, `status`, lệnh runtime,
>   `write(secret:)` qua stdin.
>
> **Còn lại:** chạy `bootstrap` → `install-runtime` → `activate-runtime` →
> `init-database` → `migrate` trên Mac thử hoặc VM (store Mac đang dùng cổng
> 5432 nên không thử tại chỗ); `restore`, `export-for-move`,
> `import-from-move`, `uninstall` chuyển sang giai đoạn 3–4.

Repo `luma-pos-app/native-macos` (+ script build trong `luma-pos-web/ops`).

1. Lấy PostgreSQL 17 arm64 relocatable (build từ source với
   `--prefix` tương đối, hoặc dùng bản dựng sẵn có giấy phép phân phối lại,
   kiểu Postgres.app); bỏ những gì không cần (docs, `pgxs`). Ghi rõ phiên bản
   và checksum vào `manifest.json`.
2. Đóng kèm `bun`, `cloudflared`, `rclone` với phiên bản cố định (giữ chữ ký
   gốc của nhà phát hành; không cần ký lại vì không notarize). Ghi checksum
   vào `manifest.json`.
3. Mở rộng `ops/macos/lumapos-admin` (bash, đã có `deploy`, `service`, `log`)
   thêm các lệnh: `install-runtime <file>`, `activate-runtime <version>`,
   `rollback-runtime`, `create-accounts`, `init-database`, `migrate`,
   `restore <archive-id>`, `write-secret <name>` (đọc từ stdin),
   `export-for-move`, `import-from-move`, `uninstall [--keep-data]`.
   Mọi đường dẫn do helper tự tính, không nhận đường dẫn tự do từ app.
4. Lệnh `bootstrap` (chạy một lần qua hộp mật khẩu admin): chép helper vào
   `/usr/local/libexec`, cài sudoers (`visudo -cf` trước khi đặt), chép plist
   trong `Resources/launchd` vào `/Library/LaunchDaemons` (`root:wheel`,
   `0644`). Plist dịch vụ trỏ `/Users/Shared/LumaPOS/current/...` và
   `UserName` `_lumapos_svc` / `_lumapos_db`.
5. `AdminHelper.swift`: thêm các lệnh mới; nếu helper trên máy cũ hơn helper
   trong app thì chạy lại `bootstrap` (một lần nhập mật khẩu).
6. App vẫn ký ad-hoc; bật Hardened Runtime không bắt buộc. Kiểm tra app chạy
   được trên Mac khác sau khi gỡ cờ cách ly (giai đoạn 5).

**Xong khi:** trên một Mac thử (hoặc VM macOS 14), app chạy `bootstrap` với
một lần nhập mật khẩu, tạo được user dịch vụ, khởi tạo PGDATA, bật PostgreSQL
như daemon hệ thống, và sống qua khởi động lại máy khi không ai đăng nhập.

### Giai đoạn 3 — Trình hướng dẫn cài đặt (2–3 ngày)

> **Đã làm bản đầu 2026-11-25 (chưa chạy thật trên Mac trống).** App Mac hiện
> trình hướng dẫn thay cho bảng điều khiển khi chưa có `current` lẫn `app` (bản
> Debug xem thử bằng `-LumaSetupPreview YES`, không đụng hệ thống). Các bước:
> kiểm tra máy → quyền quản trị (`bootstrap`) → chọn gói runtime (`install-runtime`
> + `activate-runtime`, chỉ đổi `current` khi chưa có DB) → cơ sở dữ liệu
> (`init-database`, `init-runtime-env`, `migrate`) → cửa hàng mới
> (`provision-store`, mật khẩu qua stdin) → Internet (chỉ máy này hoặc
> Cloudflare: tên miền + tệp JSON của `cloudflared tunnel create`,
> `configure-tunnel`) → khóa sao lưu (`backup-key`, chép/lưu tệp, phải xác nhận
> đã cất) → `start-services` → hoàn tất. `lumapos-admin` v5 thêm các lệnh này;
> `init-runtime-env` không bao giờ đổi khóa đã có.
>
> **Khôi phục từ Google Drive (2026-11-25, helper v6).** Bước cơ sở dữ liệu
> giờ chỉ `init-database` + `init-runtime-env`; `migrate` chạy ở bước cửa hàng.
> Bước cửa hàng có hai lựa chọn: cửa hàng mới (`migrate` + `provision-store`)
> hoặc khôi phục: chọn `rclone.conf` của máy cũ + thư mục sao lưu
> (`configure-drive`, tệp qua stdin), nhập khóa sao lưu cũ (`set-backup-key`,
> chỉ khi DB còn trống), `list-backups` (worker `list-drive-backups` đọc thư
> mục Drive, mới nhất trước), chọn bản → `restore-backup` (compat SQL, worker
> `restore-database-backup` với staging trong `backup-staging`, rồi
> `migrate`). Máy mới không có lịch sử sao lưu nên không có SHA-256: bản tải
> về được so với MD5 của Drive, nội dung vẫn được thẻ AES-GCM xác thực. Khôi
> phục xong thì bỏ qua bước khóa sao lưu (giữ khóa cũ). Đã thử với cụm
> PostgreSQL 17 tạm và rclone giả: khôi phục đúng (dữ liệu, media, chủ sở
> hữu), sai khóa / tải hỏng / DB đã có dữ liệu đều bị chặn.
>
> **Đăng nhập Google trong app (2026-11-25).** Kết nối Drive có hai nguồn:
> đăng nhập Google (Client ID + secret của OAuth client Desktop của cửa hàng;
> app chạy `rclone authorize drive` của runtime bằng tài khoản người dùng, scope
> `drive.file`, rồi tự tạo `rclone.conf`) hoặc tệp `rclone.conf` có sẵn. Dùng
> cho cả khôi phục và cửa hàng mới: bước "Sao lưu" (trước là "Khóa sao lưu")
> kết nối Drive cho sao lưu tự động, không bắt buộc. `configure-drive` giờ chạy
> `rclone mkdir` dưới `_lumapos_svc` để tạo thư mục và kiểm tra kết nối. Khôi
> phục phải dùng đúng OAuth client của máy cũ vì `drive.file` chỉ thấy tệp do
> client đó tạo. Chưa thử đăng nhập Google thật (cần client của cửa hàng).
>
> **Chưa có:** thư mục Drive có dấu cách, đổi kết nối Drive sau khi cài, nhận từ máy cũ (giai đoạn 4), đăng nhập
> Cloudflare trong app (`cloudflared tunnel login`), chế độ LAN cho máy khác
> (web vẫn chỉ nghe `127.0.0.1`).

Màn mới trong app Mac (VI/EN, theo `LumaTheme`), hiện khi chưa có
`/Users/Shared/LumaPOS/current`.

1. **Kiểm tra máy:** macOS ≥ 14, Apple silicon, dung lượng trống ≥ 20 GB,
   múi giờ `Asia/Ho_Chi_Minh` (đề nghị đổi nếu khác), cổng 3000/5432 trống,
   không có PostgreSQL Homebrew đang chạy cùng cổng.
2. **Cấp quyền quản trị một lần:** giải thích app sẽ cài dịch vụ hệ thống,
   rồi chạy `lumapos-admin bootstrap` qua hộp mật khẩu macOS. App không thấy
   mật khẩu.
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
   > **Đã chuyển 2026-11-26 10:16–10:18** bằng
   > `ops/macos/convert-classic-to-packaged.sh` (dịch vụ dừng khoảng 2 phút):
   > runtime `20261126.031147-c0e839e1`, 150 bảng khớp số dòng, 3.168 tệp ảnh
   > khớp, local và public đều 200. Lần chạy đầu dừng ở `bootstrap` vì
   > `chown owner -- path` (BSD không nhận `--` sau tham số) đã đổi chủ
   > `/Users/Shared/LumaPOS` sang root mà chưa đặt 0755; đã đặt lại 0755 và sửa
   > `ensure_dir`. Sau khi chuyển: archive không chứa lịch sử
   > `database_backup_runs` nên đã chép 13 bản ghi thành công từ cụm Homebrew
   > (chạy tạm trên socket riêng, chỉ đọc) và bỏ bản sao lưu trùng ngày 26/11
   > mà worker mới vừa bắt đầu. Giữ để quay lại: dữ liệu Homebrew
   > (`launchctl disable gui/<uid>/sh.brew.postgresql@17`),
   > `media.classic-20261126_101648`, `classic-launchd-20261126_101648`,
   > `backups/pre-packaged-20261126_101648.lumaenc`, thư mục `app`. Xóa sau 7
   > ngày chạy ổn. Deploy web giờ đi qua runtime (`assemble-runtime.sh` +
   > `install-runtime` + `activate-runtime`).
   > **Cài lại thử bằng DMG trên store Mac 2026-11-26 11:05–11:13** (cửa hàng
   > dừng khoảng 8 phút): `export-for-move`, `uninstall keep-data`, đổi tên
   > thư mục thành `LumaPOS.before-reinstall-20261126_110543`, rồi trình hướng
   > dẫn từ DMG (helper v10, runtime `548d528b`): khôi phục từ tệp chuyển máy,
   > tunnel bằng tệp JSON cũ với 3 tên miền, Drive bằng `rclone.conf` cũ. Mọi
   > khóa trong `runtime.env` giữ nguyên giá trị (so sánh từng khóa), 3.168 tệp
   > ảnh khớp, ready 200. Lỗi tìm ra và đã sửa trên đường đi: archive không
   > mang `runtime.env` (giờ có `settings.env`), tunnel chỉ một tên miền, bỏ
   > qua bước Sao lưu sau khi khôi phục từ tệp, archive không mang lịch sử sao
   > lưu (giờ mang, lượt dở dang của máy cũ thành failed), PostgreSQL chạy từ
   > runtime đã bị xóa sau deploy (mất plpgsql 10:44–10:59, một đơn 84.000đ lỗi;
   > helper v10 khởi động lại PostgreSQL mỗi lần chuyển runtime và giữ runtime
   > đang dùng theo `lsof`), và build tự động cần thư mục build trong cache
   > người dùng khi `/Users/Shared/LumaPOS` thuộc root.
3. Cập nhật `self-hosted-operations.md`, `ops/macos/README.md`,
   README app Mac.

> **Đã làm 2026-11-26 (helper v8, chưa diễn tập giữa hai Mac).** Thay cho
> kênh LAN có mã ghép đôi, chuyển máy bằng **tệp**: màn Bảo trì › "Dừng và
> xuất dữ liệu" chạy `export-for-move` (dừng và `launchctl disable` web,
> worker, sao lưu và tunnel để không tự chạy lại sau reboot; worker
> `export-store` ghi archive cùng định dạng sao lưu Drive, mã hóa bằng khóa
> sao lưu, vào `/Users/Shared/LumaPOS/exports` cho người dùng). Máy mới chọn
> "Tệp chuyển máy" trong trình hướng dẫn: `set-backup-key` rồi `restore-file`.
> `cancel-move` chạy lại máy cũ. Tunnel: đăng nhập Cloudflare trên máy mới tạo
> tunnel mới và `route dns --overwrite-dns` trỏ tên miền sang máy mới. Đối
> chiếu số dòng: chưa có ngoài checksum từng tệp trong manifest và thẻ
> AES-GCM. Chuyển store Mac hiện tại sang cách cài mới (mục 2) chưa làm: cần
> có mặt chủ cửa hàng, ngoài giờ bán.

**Xong khi:** đã diễn tập chuyển máy hoàn chỉnh giữa hai Mac (hoặc Mac + VM),
kể cả trường hợp đối chiếu sai cố ý; store Mac chạy bằng cách cài mới ≥ 3 ngày
không lỗi.

### Giai đoạn 5 — Đóng gói, phát hành và tự cập nhật (1–2 ngày)

1. Script `luma-pos-app/native-macos/scripts/release.sh` (chỉ CLI):
   build runtime (giai đoạn 1) → `xcodebuild` Release, ký ad-hoc
   (`CODE_SIGN_IDENTITY=-`) → nhúng runtime ban đầu → `hdiutil` tạo `.dmg` →
   ghi SHA-256 của `.dmg`.
2. **Mở app lần đầu trên máy mới** (Gatekeeper chặn app chưa notarize):
   - Cách chính: mở app, bị chặn, vào *Cài đặt hệ thống › Quyền riêng tư &
     Bảo mật*, bấm **Vẫn mở**. Làm một lần cho mỗi bản app.
   - Cách thay thế: `xattr -dr com.apple.quarantine /Applications/LumaPOS.app`.
   - Hoặc chép `.dmg` qua AirDrop/USB rồi vẫn phải làm một trong hai bước trên.
   Viết hướng dẫn có ảnh vào `README` của `.dmg`.
3. **Cập nhật runtime (thường xuyên):** khóa EdDSA riêng giữ trên máy build
   (ngoài repo). `release.sh --runtime-only` tạo gói runtime + `manifest.json`
   đã ký, đưa lên Cloudflare R2 (đã dùng cho media) với một
   `runtime-feed.json`. App kiểm tra feed định kỳ, xác minh chữ ký bằng khóa
   công khai nhúng trong app, rồi `lumapos-admin install-runtime` +
   `activate-runtime` có rollback. Không cần cho phép mở lại.
4. **Cập nhật app (hiếm):** feed báo có bản app mới, app mở trang tải `.dmg`;
   người dùng thay app và cho phép mở lại theo bước 2. Không dùng Sparkle cho
   app vì không notarize.
5. Không cập nhật trong giờ bán hàng trừ khi người dùng chọn "Cập nhật ngay";
   mặc định đề nghị sau giờ đóng cửa.
6. Giữ đường cập nhật cũ ("build từ checkout") cho bản Debug trên máy dev.

> **Đã làm 2026-11-26.** `luma-pos-app/native-macos/scripts/release.sh` (CLI):
> ký gói runtime bằng Ed25519 (`ops/macos/runtime-signing.mjs`, khóa riêng ở
> `~/Library/Application Support/LumaPOS/release/`, LibreSSL của macOS không có
> Ed25519 nên dùng `node:crypto` qua bun), kiểm tra với khóa công khai trong
> app, build Release ký ad-hoc, nhúng runtime vào `Contents/Resources/runtime`,
> ký lại, tạo `.dmg` (kèm hướng dẫn mở lần đầu) và `.sha256`; `--runtime-only`
> tạo gói + `runtime-feed.json`. App chỉ cài gói có chữ ký khớp (trình hướng
> dẫn chọn sẵn gói trong app; Bảo trì › Phần mềm máy chủ cài gói mới + quay
> lại bản trước). **Chưa có:** nơi đặt feed (mục 10.3) nên app chưa tự kiểm
> tra cập nhật; cập nhật runtime hiện bằng cách chọn tệp gói.

**Xong khi:** một commit web mới → `release.sh --runtime-only` → store Mac
nhận runtime qua feed, chuyển runtime, health xanh; thử rollback bằng một bản
cố tình hỏng và thử từ chối một gói có chữ ký sai.

## 5. Nâng cấp PostgreSQL

- Bản vá (17.x → 17.y): thay binary trong runtime mới, khởi động lại daemon.
- Bản chính (17 → 18): app đóng kèm **cả hai** bản trong một phiên bản chuyển
  tiếp; helper chạy backup Drive → `pg_upgrade --link` sang PGDATA mới → kiểm
  tra → giữ PGDATA cũ đến khi người dùng xác nhận. `postgres-tools.ts` đã
  từ chối `pg_dump` khác phiên bản (`PG_DUMP_VERSION_MISMATCH`), nên trỏ
  `LUMAPOS_POSTGRES_BIN_DIR` vào đúng bản đang chạy.

## 6. Bảo mật

- Helper `lumapos-admin` thuộc root, mode `0755`, rule sudoers chỉ cho đúng
  file đó; danh sách lệnh cố định, tham số có kiểm tra, không nhận đường dẫn
  tự do. Không kiểm tra được app gọi tới bằng chữ ký (không có team ID), nên
  bất kỳ tiến trình nào của user admin cũng gọi được các lệnh này — giống mức
  rủi ro hiện tại, đã ghi trong `ops/macos/README.md`.
- Gói runtime chỉ được cài khi chữ ký EdDSA khớp khóa công khai nhúng trong
  app và SHA-256 từng file khớp `manifest.json`. Khóa bí mật không nằm trong
  repo hay trên store Mac.
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
  lệnh `lumapos-admin` (kiểm tra tham số, chạy với thư mục giả).
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
| Gatekeeper chặn app chưa notarize; macOS mới có thể siết thêm | Hướng dẫn "Vẫn mở" có ảnh + lệnh `xattr`; app ít đổi vì runtime cập nhật riêng; nếu sau này có tài khoản Apple Developer thì thêm notarize mà không đổi kiến trúc |
| Binary đi kèm bị gắn cờ cách ly sau khi chép | Helper gỡ cờ cách ly khi cài runtime vào `/Users/Shared/LumaPOS/runtime` |
| Mất khóa EdDSA ký runtime | Lưu bản sao khóa trong trình quản lý mật khẩu; app mới có thể nhúng khóa công khai mới |
| Chuyển máy lỗi giữa chừng | Máy cũ chỉ tắt sau khi đối chiếu đạt; máy cũ giữ dữ liệu 7 ngày |
| App lớn (~400–500 MB) | Chỉ tải `.dmg` khi cài mới; cập nhật thường xuyên chỉ tải gói runtime (~150–250 MB) |

## 9. Liên quan VPS

Giai đoạn 1 (runtime gọn, worker biên dịch, `manifest.json`) dùng chung cho
VPS: build thêm target `linux-x64`/`linux-arm64` và dùng `ops/systemd`. Quy
trình chuyển máy ở giai đoạn 4 nên tách phần dump/đối chiếu thành worker
`lumapos-migrate-host` để VPS dùng lại được qua CLI.

## 10. Cần chốt trước khi làm

1. ~~Tài khoản Apple Developer~~ — đã chốt 2026-11-24: không có; dùng ký
   ad-hoc, không notarize, runtime cập nhật riêng.
2. ~~Nguồn PostgreSQL đóng kèm~~ — đã chốt 2026-11-25: tự build từ mã nguồn
   (giấy phép PostgreSQL cho phân phối lại), `build-postgres.sh`.
3. Nơi đặt feed runtime và `.dmg`: R2 với domain `updates.haidangshop.com` hay
   tên khác.
4. Có cần chế độ chỉ-LAN (không Cloudflare) trong trình hướng dẫn ngay từ đầu.

## 11. Ước tính

| Giai đoạn | Thời gian |
|---|---|
| 1. Runtime gọn | 1–2 ngày |
| 2. PostgreSQL + helper | 2 ngày |
| 3. Trình hướng dẫn | 2–3 ngày |
| 4. Chuyển máy + chuyển store Mac | 2 ngày |
| 5. Đóng gói, phát hành, tự cập nhật runtime | 1–2 ngày |
| **Tổng** | **8–11 ngày làm việc** |
