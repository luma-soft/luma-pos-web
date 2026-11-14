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
- Đặt runtime environment tại
  `/Users/Shared/LumaPOS/secrets/runtime.env`, owner `_lumapos_svc`, mode `600`.
  Đây là file shell assignments đã được tin cậy, không phải `.env.local`; không
  ghi secrets vào plist hoặc log. Chỉ tiến trình launchd đọc file này.
- Release không được chứa `.env`, `.env.local`, `.env.production` hoặc
  `.env.production.local`; wrapper từ chối khởi chạy nếu thấy một trong các file
  đó mà không đọc nội dung.
- Cài Bun và `cloudflared` tại đường dẫn trong plist mẫu hoặc sửa đường dẫn cho
  đúng máy. Tạo thư mục log trước khi nạp dịch vụ.
- Cấp quyền `_lumapos_svc` cho thư mục media và thư mục backup riêng. Chúng phải
  nằm ngoài app release và tách biệt nhau.

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
5. Nâng cấp release bằng cách dừng dịch vụ, thay release tại cùng đường dẫn,
   khởi động lại và kiểm tra readiness. Giữ release trước đó để rollback app
   trên cùng PostgreSQL.

Các ví dụ mặc định giả định Homebrew ARM ở `/opt/homebrew`. Mac Intel hoặc cách
cài khác cần sửa `PATH`, Bun, `cloudflared` và PostgreSQL binary path. Khi
chuyển lên VPS, dùng mẫu `systemd` trong [`ops/systemd`](../systemd/README.md);
giữ nguyên env contract, schema, backend và object keys.
