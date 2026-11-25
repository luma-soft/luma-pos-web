# Chạy LumaPOS trên macOS bằng launchd

Các file `.plist.example` là mẫu để triển khai sau khi đã có release self-hosted
và target database được xác nhận. Chúng không được nạp tự động và không chứa
credentials.

## Bố trí trên máy

- Đặt release đã build tại `/Users/Shared/LumaPOS/app`, ngoài thư mục checkout
  của developer.
- Dùng service account ẩn `_lumapos_svc`, không thuộc nhóm `admin`, có shell
  `/usr/bin/false`; cấp quyền tối thiểu trên secrets, media, backup và log.
  Không dùng tài khoản superuser PostgreSQL làm `DATABASE_URL` của ứng dụng.
- Giữ `/Users/Shared/LumaPOS` ở mode `0710`, group `staff`, để service account
  đi tới các đường dẫn đã biết nhưng không liệt kê thư mục gốc. Thư mục `secrets`,
  `media`, `logs` và `backup-staging` thuộc `_lumapos_svc`; staging dùng mode
  `0700`. Runtime env, rclone config và tunnel credential dùng mode
  `0600`. Release app phải đọc được bởi group `staff`.
- Đặt runtime environment tại
  `/Users/Shared/LumaPOS/secrets/runtime.env`, owner `_lumapos_svc`, mode `600`.
  Đây là file shell assignments đã được tin cậy, không phải `.env.local`; không
  ghi secrets vào plist hoặc log. Chỉ tiến trình launchd đọc file này.
- Release không được chứa `.env`, `.env.local`, `.env.production` hoặc
  `.env.production.local`; wrapper từ chối khởi chạy nếu thấy một trong các file
  đó mà không đọc nội dung.
- Cài Bun vào `/Users/Shared/LumaPOS/bin/bun`, `rclone` và giữ `cloudflared` tại
  đường dẫn trong plist mẫu (Homebrew ARM mặc định). Tạo thư mục log trước khi
  nạp dịch vụ.
- Thư mục `/Users/Shared/LumaPOS/backup-staging` là staging tạm trên ổ trong, không phải
  backup durable; service account cần quyền riêng `0700`. Staging phải nằm ngoài
  app release và media. Archive production chỉ được tính thành công sau khi đã
  xác minh trên Google Drive.
- Đặt remote OAuth của rclone trong
  `/Users/Shared/LumaPOS/secrets/rclone.conf`, owner `_lumapos_svc`, mode `600`.
  Config cần ghi được để refresh token; không để trong repo/release, không in
  nội dung và không route Drive credential qua Tunnel.

## Dịch vụ

Sao chép `com.lumapos.worker.plist.example` thành một plist cho từng dịch vụ
dài hạn. Đổi `Label`, tham số cuối của shared `ops/shared/run-service.sh` và
tên file log:

| Tham số | Dịch vụ |
| --- | --- |
| `web` | Next.js trên loopback, cổng 3000 |
| `sync` | PostgreSQL sync inbox worker |
| `notifications` | PostgreSQL notification outbox worker |
| `backups` | Backup worker, tự yêu cầu backup hằng ngày và xử lý hàng đợi thủ công |

Dùng `com.lumapos.cloudflared.plist.example` cho tunnel. Tunnel chỉ trỏ tới
Next.js; không route PostgreSQL, pgAdmin, SSH hoặc thư mục media.
Plist dùng cú pháp tunnel locally managed:
`cloudflared tunnel --config <PATH> run <UUID-or-name>` theo
[Cloudflare Tunnel run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/).
Thay UUID mẫu trong cả `cloudflared.yml` và plist bằng cùng tunnel UUID/name;
hostname trong YAML mẫu đã đặt thành `pos.haidangshop.com`.
Giữ file config và tunnel credentials ngoài repo, owner `_lumapos_svc`, mode
`600`; credential JSON không được đưa vào log hoặc plist.

`com.lumapos.media-cleanup.plist.example` giữ lịch hiện tại 09:15 giờ địa
phương Việt Nam. Chỉ cài khi timezone macOS là `Asia/Ho_Chi_Minh`; nếu đổi giờ
đóng cửa, cập nhật lịch sau khi chủ cửa hàng duyệt. Không tạo launchd job cho
`/api/cron/notifications/outbox`: worker outbox đã poll liên tục. Hai tác vụ
`notifications` và `einvoices` chưa có lịch đã xác nhận nên không có plist mẫu.

## Cài và vận hành

1. Sửa đường dẫn, label, tham số dịch vụ và `UserName` trong từng plist. Đảm bảo
   các thư mục log đã tồn tại và ghi được bởi service account.
2. Kiểm tra từng plist bằng `plutil -lint` trước khi cài.
3. Copy plist đã duyệt vào `/Library/LaunchDaemons`, đặt owner `root:wheel`, mode
   `644`, rồi nạp bằng `launchctl bootstrap system <plist>`.
4. Xem trạng thái bằng `launchctl print system/<label>` và log riêng của tiến
   trình. `/api/health/ready` phải trả 200 trước khi mở tunnel.
5. Nâng cấp release theo mục [Cập nhật bản web](#cập-nhật-bản-web) bên dưới.

Các ví dụ mặc định giả định Homebrew ARM ở `/opt/homebrew`. Mac Intel hoặc cách
cài khác cần sửa `PATH`, Bun, `cloudflared` và PostgreSQL binary path. Khi
chuyển lên VPS, dùng mẫu `systemd` trong [`ops/systemd`](../systemd/README.md);
giữ nguyên env contract, schema, backend và object keys.

## Cập nhật bản web

Release đang chạy nằm tại `/Users/Shared/LumaPOS/app`; file `RELEASE_COMMIT`
trong đó ghi commit của nó. Một lần cập nhật gồm hai bước:

1. **Build** — `ops/macos/build-release.sh`, chạy bằng tài khoản Mac thường
   (không cần quyền admin):
   - xuất commit `HEAD` của checkout (`git archive`, nên thay đổi chưa commit
     không được đưa vào) tới thư mục build cố định
     `/Users/Shared/LumaPOS/app-build`, giữ `node_modules` giữa các lần build
     và chỉ chạy `bun install --frozen-lockfile` khi `bun.lock` đổi;
   - `next build` ở chế độ standalone (`LUMAPOS_NEXT_OUTPUT=standalone`) với
     một `DATABASE_URL` giả chỉ để import module; build không kết nối database
     và không nhúng giá trị này vào output. Dịch vụ đọc giá trị thật từ
     `secrets/runtime*.env`;
   - đóng gói worker (`sync`, `notifications`, `backups`, `restore`,
     `maintenance`, migrate) bằng `bun build` thành `workers/*.js` chạy bằng
     Bun dùng chung, không cần `node_modules` đầy đủ;
   - ghép release vào `/Users/Shared/LumaPOS/app-next`: server standalone ở
     gốc (`server.js`, `.next`, `node_modules` đã trace), `.next/static`,
     `public/`, `workers/`, `drizzle/`, `ops/shared/run-service.sh`,
     `RELEASE_COMMIT` và `manifest.json` (phiên bản, commit, SHA-256 từng
     file). Kích thước khoảng 120 MB, so với ~900 MB của kiểu cũ.
   - `run-service.sh` nhận ra kiểu này qua `manifest.json` + `server.js` và
     chạy `bun server.js` / `bun workers/<tên>.js`. Đặt
     `LUMAPOS_RELEASE_LAYOUT=classic` để build kiểu cũ (toàn bộ mã nguồn +
     `node_modules`, chạy `bun run …`) nếu cần quay lại.
2. **Deploy** — `lumapos-admin deploy`, chạy bằng root:
   - từ chối `app-next` thiếu `.next/BUILD_ID`, chứa file `.env*`, hoặc có
     symlink ở `app-next`, `.next`, `.next/cache`;
   - `bootout` web, sync, notifications và chờ launchd gỡ xong (gọi
     `bootstrap` ngay sau `bootout` sẽ báo `5: Input/output error`);
   - đổi `app` thành `app-prev-<thời gian>`, `app-next` thành `app`, giao
     `.next/cache` cho `_lumapos_svc`;
   - nạp lại ba dịch vụ (có thử lại) và chờ `GET /api/health/live` trả 200
     trong tối đa ~90 giây. Không dùng `/api/health/ready` làm điều kiện vì
     nó có thể `not_ready` vì lý do vận hành (ví dụ chưa có backup Drive
     trong 26 giờ) trong khi web vẫn phục vụ bình thường;
   - nếu web không lên: trả release cũ về `app`, giữ bản lỗi ở
     `app-failed-<thời gian>`, khởi động lại và thoát mã lỗi;
   - giữ hai `app-prev-*` mới nhất để rollback thủ công. `app-failed-*` không
     tự xoá; xoá tay sau khi đã xem lỗi.

Worker sao lưu (`com.lumapos.backups`) cũng chạy từ `app` (từ 2026-11-25) nhưng
không bị dừng cùng web: sau khi web lên, `lumapos-admin` chỉ khởi động lại nó
khi đang rảnh, tức là không có thư mục tạm `.lumapos-backup-*` trong
`LUMAPOS_BACKUP_STAGING_ROOT` và không có tiến trình con (`pg_dump`, `tar`,
`rclone`). Nếu đang sao lưu, bước deploy in `STEP:backups busy` và worker chạy
tiếp code cũ tới lần deploy sau. Plist của nó đặt `ExitTimeOut` 900 giây để
`SIGTERM` có đủ thời gian kết thúc một lần sao lưu.

### Từ app Mac

App LumaPOS trên Mac có thẻ **Bản web** ở màn Tổng quan và Dịch vụ nền: hiển
thị commit đang chạy so với checkout (`LUMA_WEB_SOURCE_PATH`, mặc định
`~/project/LumaPOS/luma-pos-web`) và nút **Cập nhật web** chạy đúng hai bước
trên. Nếu đã cài công cụ quản trị (mục dưới), app không hỏi mật khẩu; nếu
chưa, macOS hỏi mật khẩu admin một lần cho bước deploy.

### Từ dòng lệnh

```bash
ops/macos/build-release.sh
sudo /usr/local/libexec/lumapos-admin deploy      # đã cài công cụ quản trị
sudo bash /Users/Shared/LumaPOS/app-next/ops/macos/deploy-release.sh   # chưa cài
```

### Rollback thủ công

```bash
sudo launchctl bootout system/com.lumapos.web
sudo launchctl bootout system/com.lumapos.sync
sudo launchctl bootout system/com.lumapos.notifications
sudo mv /Users/Shared/LumaPOS/app /Users/Shared/LumaPOS/app-failed-manual
sudo mv /Users/Shared/LumaPOS/app-prev-<thời gian> /Users/Shared/LumaPOS/app
sudo /usr/local/libexec/lumapos-admin service start web
sudo /usr/local/libexec/lumapos-admin service start sync
sudo /usr/local/libexec/lumapos-admin service start notifications
```

Chỉ rollback app trên cùng PostgreSQL khi các release không khác nhau về
migration.

## Gói runtime cho app Mac (đang làm, chưa dùng trên store Mac)

Bố cục đóng gói (`docs/mac-host-installer-plan.md`, giai đoạn 2) chạy từ
`/Users/Shared/LumaPOS/current -> runtime/<version>` thay vì `app/`. Build trên
máy dev, không cần quyền root:

```bash
ops/macos/build-postgres.sh 17.11     # PostgreSQL relocatable (~5 phút lần đầu)
ops/macos/build-tools-bundle.sh       # bun, cloudflared, rclone
ops/macos/assemble-runtime.sh         # từ release đang chạy (app/) hoặc thư mục chỉ định
```

Kết quả nằm ở `~/Library/Caches/LumaPOS/runtime-build/`
(`lumapos-runtime-<version>.tar.gz` + `.sha256`). Trên Mac đích:

```bash
sudo /usr/local/libexec/lumapos-admin install-runtime <file.tar.gz> <sha256>
sudo /usr/local/libexec/lumapos-admin activate-runtime <version>
sudo /usr/local/libexec/lumapos-admin init-database      # chỉ lần đầu
sudo /usr/local/libexec/lumapos-admin status
```

Lần cài đầu, app chạy `lumapos-admin bootstrap <user>` qua hộp mật khẩu macOS
(cài helper, sudoers, user `_lumapos_svc`/`_lumapos_db`, thư mục, plist). Helper
không ghi đè plist cũ không chạy từ `current`.

## Công cụ quản trị không cần mật khẩu

`ops/macos/lumapos-admin` là helper chạy bằng root, chỉ nhận các lệnh cố định:

| Lệnh | Việc làm |
| --- | --- |
| `deploy` | Đưa `/Users/Shared/LumaPOS/app-next` lên chạy như mô tả ở trên |
| `service start\|stop\|restart <tên>` | `bootstrap`/`kickstart`, `bootout`, `kickstart -k` cho `com.lumapos.<tên>` |
| `log <tên> [số dòng]` | `tail` file log khai báo trong plist của dịch vụ |
| `version` | In phiên bản helper |

`<tên>` chỉ được là `web`, `sync`, `notifications`, `backups`, `cloudflared`.
Đường dẫn log đọc từ plist root-owned trong `/Library/LaunchDaemons`, không
lấy từ người gọi. Helper không chạy file nào trong thư mục user ghi được.

### Cài đặt (một lần, cần mật khẩu admin)

```bash
sudo bash ~/project/LumaPOS/luma-pos-web/ops/macos/install-admin-helper.sh
```

Script:

- copy helper tới `/usr/local/libexec/lumapos-admin` (`root:wheel`, `0755`),
  sau khi kiểm tra `/usr` và `/usr/local` thuộc root và không ghi được bởi
  group/others;
- tạo `/etc/sudoers.d/lumapos` (`root:wheel`, `0440`, kiểm tra bằng
  `visudo`) cho phép đúng user đã chạy `sudo` (hoặc user truyền vào tham số
  đầu) chạy helper bằng `sudo` không cần mật khẩu;
- thử `sudo -n lumapos-admin version` bằng user đó.

Sau khi cài, app Mac gọi `sudo -n /usr/local/libexec/lumapos-admin …` cho
deploy, Bật/Tắt/Khởi động lại dịch vụ hệ thống và đọc log; nếu helper chưa cài
hoặc `sudo -n` cần mật khẩu, app quay lại hộp thoại mật khẩu macOS như cũ.

**Đánh đổi bảo mật:** mọi chương trình chạy dưới user đó có thể restart, tắt
dịch vụ LumaPOS, đọc log của chúng và deploy release trong `app-next` mà không
cần mật khẩu. Không có quyền root nào khác. Chỉ cài trên máy chủ cửa hàng có
mật khẩu đăng nhập và không cho người lạ dùng.

**Cập nhật helper:** bản cài là bản copy; sau khi kéo `lumapos-admin` mới về,
chạy lại script cài đặt.

**Gỡ:**

```bash
sudo bash ~/project/LumaPOS/luma-pos-web/ops/macos/install-admin-helper.sh --uninstall
```


## Xử lý sự cố

| Hiện tượng | Nguyên nhân và cách xử lý |
| --- | --- |
| `Bootstrap failed: 5: Input/output error` khi tự chạy `launchctl` | Gọi `bootstrap` ngay sau `bootout` khi launchd chưa gỡ xong job. Chờ vài giây rồi chạy lại, hoặc dùng `lumapos-admin service start <tên>` (tự thử lại). |
| Reload trình duyệt không thấy thay đổi | Production chạy bản build trong `/Users/Shared/LumaPOS/app`, không phải checkout của developer. Xem `RELEASE_COMMIT` và chạy **Cập nhật web**. |
| App Mac báo "Máy chủ không phản hồi" nhưng `/api/health/live` vẫn 200 | `/api/health/ready` chậm hơn thời gian chờ của app (15 giây). Kiểm tra thời gian trả lời bằng `curl -w '%{time_total}' http://127.0.0.1:3000/api/health/ready`; kiểm tra Google Drive được cache 30 phút cho mỗi archive. |
| Readiness `not_ready` với `recentGoogleDriveBackup` | Không có backup `succeeded` trên Google Drive trong 26 giờ, hoặc không đối chiếu được kích thước/MD5 của archive trên Drive. Xem lịch sử sao lưu ở trang `/admin` và log `backups`. |
| Log web có `Failed to find Server Action` ngay sau khi cập nhật | Tab trình duyệt còn mở trang của bản cũ. Tải lại các tab LumaPOS. |
| Thẻ Bản web báo "Mã nguồn có thay đổi chưa commit" | Checkout có file sửa dở; bản cập nhật chỉ gồm những gì đã commit. Commit (hoặc bỏ) thay đổi trước nếu cần đưa lên. |
| App vẫn hỏi mật khẩu sau khi cài helper | Chạy `sudo -n /usr/local/libexec/lumapos-admin version` bằng user đang dùng app. Nếu báo cần mật khẩu, chạy lại `install-admin-helper.sh` bằng đúng user đó. |
