# Prompt cập nhật — Công trình đa bộ môn

Triển khai lại toàn bộ trải nghiệm **Công trình** trên web và mobile theo bộ render đã chốt tại:

- `output/designs/project-full-flow-v1`
- `output/designs/project-full-flow-v2-multi-trade`

Khi render v2 bị trùng phiên bản, dùng `05-web-plumbing-work-order-v2.png` và `08-mobile-mixed-coordination-v2.png` làm nguồn chuẩn.

## Phạm vi cố định

- Giữ nguyên navigation toàn cục và component header hiện có trên cả web lẫn mobile.
- Chỉ thay đổi nội dung từ dưới header trở xuống.
- Không tạo Figma.
- Web và mobile phải dùng cùng domain, trạng thái và API; không tạo hai logic nghiệp vụ khác nhau.
- Luồng đầy đủ gồm: danh sách, tạo công trình, tổng quan, thi công/lệnh việc, thiết bị/tài sản đã lắp, nghiệm thu/bàn giao, bảo trì, bảo hành, tài chính/hồ sơ, lịch sử và đóng công trình.

## Mô hình công trình

Hỗ trợ bốn loại: `camera`, `electrical`, `plumbing`, `mixed`.

- Camera: kéo cáp, lắp thiết bị, cấu hình, kiểm tra hình ảnh/ghi hình/truy cập từ xa, bàn giao truy cập an toàn.
- Điện: cô lập nguồn/LOTO, dây và tủ điện, mạch/CB/RCD, đèn/thiết bị; lưu lịch mạch, sơ đồ một sợi và kết quả điện áp/cách điện/tiếp địa/RCD.
- Nước: cô lập nguồn và xả áp, tuyến ống, van/bơm/bồn/thiết bị; lưu áp thử, thời gian thử, độ sụt áp, rò rỉ và độ dốc thoát nước.
- Hỗn hợp là container cấp công trình. Mỗi lệnh việc vẫn thuộc đúng một bộ môn Camera, Điện hoặc Nước. Tiến độ, vật tư, chi phí, hồ sơ, bảo trì và bảo hành được tổng hợp ở cấp công trình.
- Công trình hỗn hợp phải quản lý điểm giao kỹ thuật và phụ thuộc liên bộ môn. Nghiệm thu tổng hợp chỉ mở khi mọi nghiệm thu bộ môn bắt buộc đã đạt.

## Cấu trúc giao diện đã chốt

Sau các chỉ số tiến độ/thiết bị/lệnh việc/bảo hành, phần nội dung dùng năm nhóm chính:

1. **Tổng quan**: việc cần làm tiếp theo, tiến độ, thông tin công trình, hoạt động gần đây và đơn/báo giá liên quan.
2. **Thi công**: lệnh việc theo bộ môn, checklist, an toàn, phép đo/chứng cứ, vật tư và điều phối liên bộ môn.
3. **Thiết bị**: tài sản đã lắp theo bộ môn; riêng Camera có vùng Truy cập an toàn.
4. **Sau lắp đặt**: nghiệm thu/bàn giao, bảo trì định kỳ và yêu cầu bảo hành.
5. **Tài chính & hồ sơ**: doanh thu/chi phí/lợi nhuận, chứng từ, lịch sử và điều kiện đóng công trình.

Trên mobile vẫn giữ năm nhóm nghiệp vụ nhưng trình bày thành tab cuộn ngang và card một cột, nút thao tác tối thiểu 44 px. Picker phải dùng `LumaPickerField`; sheet phải mở qua `showLumaModalSheet`. Trên web dùng picker Luma dạng trigger + popover/listbox, không dùng `<select>` hoặc `<datalist>` hiển thị.

## Camera/NVR — vault bắt buộc

Không lưu bí mật trong `installed_assets`, payload chi tiết công trình thông thường, log, snapshot ký hoặc cache offline mobile. Tạo kho bí mật riêng, mã hóa phía server bằng AES-256-GCM với khóa môi trường `SERVICE_VAULT_ENCRYPTION_KEY`.

Mỗi thiết bị Camera/NVR hỗ trợ:

- tài khoản và mật khẩu xem thiết bị;
- mã xác minh và encryption key;
- nhà cung cấp DDNS, tên miền, tài khoản và mật khẩu DDNS;
- WAN IP, HTTP/RTSP/ONVIF port và URL xem trực tiếp;
- trạng thái cấu hình, thời điểm xoay gần nhất và phiên bản khóa mã hóa.

API chi tiết công trình chỉ trả summary đã che. Endpoint reveal/copy/rotate/phân quyền phải:

- chỉ cho chủ cửa hàng hoặc quản lý;
- yêu cầu PIN re-auth/approval ngắn hạn với scope theo vault;
- trả plaintext chỉ trong response reveal, không cache (`no-store`);
- tự ẩn phía client sau 30 giây;
- ghi audit cho reveal, copy, cập nhật quyền và xoay mật khẩu nhưng tuyệt đối không ghi secret;
- phân quyền theo người và theo vault với quyền xem, sao chép, xoay và quản lý người xem.

## API và dữ liệu chuyên dụng

- `service_job_trade_records`: một record có version cho mỗi lệnh việc, lưu dữ liệu có schema theo đúng bộ môn (an toàn, hệ thống/tuyến, phép đo, chứng cứ, tài liệu).
- `service_job_dependencies`: quan hệ phụ thuộc giữa hai lệnh việc trong cùng công trình; không cho tự phụ thuộc.
- `service_coordination_points`: điểm giao kỹ thuật liên bộ môn, vị trí, bộ môn tham gia, người phụ trách, hạn và trạng thái.
- `installed_assets.specs`: metadata không bí mật theo loại tài sản.
- `service_camera_vaults`: ciphertext/IV/auth tag/key version; một vault cho một tài sản Camera/NVR.
- `service_camera_vault_viewers`: quyền người xem theo vault.
- Dùng `audit_logs` hiện có làm lịch sử truy cập/thay đổi; không tạo bản sao lịch sử chứa secret.

Mọi bảng và truy vấn phải có `store_id`, kiểm tra ownership của project/job/asset/profile, ràng buộc liên kết cùng công trình/cùng cửa hàng và RLS tenant. API mobile tạo công trình phải nhận đủ `serviceType`, giai đoạn, lịch và liên hệ công trường; technician được xem công trình dịch vụ khi feature `field_services` bật, nhưng không được reveal vault.

## Điều kiện hoàn tất

- Empty/loading/error/disabled/permission-denied và trạng thái picker mở đều có thiết kế/kiểm thử.
- Công trình đơn bộ môn không hiện điều phối liên bộ môn; Camera vault chỉ hiện khi có bộ môn Camera.
- Không thể hoàn tất lệnh việc nếu thiếu checklist, ảnh trước/sau hoặc chữ ký theo rule hiện có.
- Không thể nghiệm thu tổng hợp Mixed nếu còn nghiệm thu bộ môn chưa đạt hoặc phụ thuộc/điểm giao bắt buộc chưa hoàn tất.
- Test schema, mã hóa, RBAC/re-auth, tenant ownership, API mobile và render web/mobile.
- Chạy migration thật, xác nhận không còn migration pending và kiểm tra trực tiếp cột/bảng mới.
- So sánh screenshot implementation với render nguồn ở cùng viewport; sửa mọi sai lệch P0/P1/P2 trước khi bàn giao.
