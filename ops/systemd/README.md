# LumaPOS trên VPS bằng systemd

Các unit trong thư mục này là mẫu cho VPS Linux. Chúng chạy cùng release,
backend, schema và worker command như Mac; chỉ thay supervisor, binary path,
secret path và volume path. Chưa cài các unit này trước khi cutover khỏi Mac.

## Bố trí máy

- Release: `/opt/lumapos/app`, do quy trình deploy quản lý và chỉ đọc với
  `lumapos_svc`, trừ `.next/cache` cần ghi.
- Service account: `lumapos_svc`, không có quyền sudo.
- Runtime environment: `/etc/lumapos/runtime.env`, owner `lumapos_svc`, mode
  `600`; đây là shell assignments đáng tin cậy, không phải file dotenv của
  Next.js.
- Cloudflare Tunnel credential JSON: `/etc/lumapos/cloudflared-tunnel.json`,
  owner `lumapos_svc`, mode `600`; chuyển file qua kênh secrets được bảo vệ,
  không đưa vào repository, archive release hoặc log.
- Media và backup: `/var/lib/lumapos/media` và `/var/lib/lumapos/backups`, trên
  volume bền vững, tách rời release và nằm trên filesystem riêng nếu có thể.
- Tạo `/opt/lumapos/app/.next/cache`, `/var/lib/lumapos/media` và
  `/var/lib/lumapos/backups`; cấp quyền ghi cho `lumapos_svc` vào cache/media/
  backup theo unit tương ứng.
- PostgreSQL lắng nghe trên loopback hoặc socket riêng; không mở cổng 5432 ra
  Internet. `pgAdmin 4` chạy ở máy DBA qua SSH port-forward/VPN, không qua
  Cloudflare Tunnel.
- Cập nhật `/usr/local/bin/bun`, `/usr/local/bin/cloudflared`,
  `MEDIA_LOCAL_ROOT`, `LUMAPOS_BACKUP_ROOT` và các `ReadWritePaths` trong unit
  nếu máy dùng đường dẫn khác.

## Services

Sao chép các file `.service.example` thành unit files trong
`/etc/systemd/system/`, bỏ hậu tố `.example`, rồi sửa đường dẫn nếu cần:

| Mẫu | Chức năng |
| --- | --- |
| `lumapos-web.service.example` | Next.js lắng nghe loopback cổng 3000 |
| `lumapos-sync.service.example` | PostgreSQL sync inbox worker |
| `lumapos-notifications.service.example` | PostgreSQL notification outbox worker |
| `lumapos-backups.service.example` | Backup worker, tự xếp lịch ngày và xử lý backup thủ công |
| `lumapos-media-cleanup.service.example` | Gọi tác vụ media cleanup qua origin loopback |
| `lumapos-cloudflared.service.example` | Chỉ publish Next.js qua Cloudflare Tunnel |

Mẫu Tunnel dùng cùng hostname `pos.haidangshop.com` và cùng origin
`http://127.0.0.1:3000`. Không thêm PostgreSQL, pgAdmin, SSH hoặc thư mục media
vào ingress. Dùng cùng Tunnel ID khi chuyển từ Mac lên VPS; chỉ đổi connector và
đường dẫn cấu hình/credential.

## Lịch và bật services

Chỉ có timer media cleanup theo lịch hiện hành 09:15 giờ Việt Nam. Đặt timezone
của VPS thành `Asia/Ho_Chi_Minh`, rồi sao chép
`lumapos-media-cleanup.timer.example` thành
`/etc/systemd/system/lumapos-media-cleanup.timer`. Không tạo lịch cho
notifications hoặc e-invoices cho đến khi lịch nghiệp vụ được xác nhận.
Notification outbox và backup worker tự poll/đặt lịch.

Sau khi cài unit, reload systemd, kiểm tra unit bằng `systemd-analyze verify`,
rồi bật `lumapos-web`, `lumapos-sync`, `lumapos-notifications` và
`lumapos-backups`. Chỉ bật Tunnel sau khi `/api/health/ready` trả 200 và DNS
hostname đã trỏ đúng Tunnel. Xem logs bằng `journalctl -u <service>`; log không
được chứa secrets hoặc request body.

Khi chuyển từ Mac, giữ nguyên schema, DATABASE_URL contract, Auth provider,
sync commands, media keys và hostname. Dừng services trên Mac trước khi nhận
ghi ở VPS; không chạy hai primary cùng lúc.
