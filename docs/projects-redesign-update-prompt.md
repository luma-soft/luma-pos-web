# Prompt cập nhật — Công trình đa bộ môn

Triển khai lại toàn bộ trải nghiệm **Công trình** trên web và mobile theo bộ render đã chốt tại:

- `output/designs/project-full-flow-v1`
- `output/designs/project-full-flow-v2-multi-trade`
- `artifacts/project-device-photo-audit-2026-08-28/06-selected-option-2-multi-product-flow.png`

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

## Thiết bị đã lắp — flow bắt buộc theo phương án 2

Áp dụng đúng render `06-selected-option-2-multi-product-flow.png`. Không tự đổi hierarchy, interaction model, icon, khoảng cách hoặc trạng thái hiển thị. Giữ nguyên navigation và header dùng chung hiện có.

### Chọn nguồn thiết bị

- Có đúng hai nguồn ngang hàng: **Chọn từ sản phẩm** và **Nhập thủ công**.
- Nguồn mặc định là **Chọn từ sản phẩm**. Nhập thủ công tạo thiết bị không có `product_id` nhưng vẫn dùng cùng cấu trúc snapshot, ảnh và validation.
- Luôn hiển thị thông báo: **Chỉ liên kết thông tin sản phẩm, không trừ tồn kho**.
- Tuyệt đối không tạo stock movement, reservation, outbound transaction, điều chỉnh `total_stock` hoặc bất kỳ side effect kho nào khi chọn hay lưu thiết bị.

### Web — custom multi-select

- Dùng Luma custom picker dạng trigger + controlled popover/listbox; không dùng `<select>`, `<datalist>` hoặc popup native.
- Cho tìm theo tên, SKU, barcode và model; hỗ trợ filter theo component dùng chung nếu đã có.
- Mỗi hàng có ảnh sản phẩm, tên, SKU, thương hiệu/model và checkbox chọn nhiều.
- Footer picker phải hiện **Đã chọn N sản phẩm** và CTA **Thêm N sản phẩm**.
- Khi mở lại picker, giữ nguyên các sản phẩm đã chọn; bỏ chọn phải cập nhật danh sách bản nháp nhưng không được làm mất dữ liệu của các bản nháp còn lại.
- Phải kiểm thử cả trạng thái picker đóng và mở, bàn phím, focus, outside-click, Escape, Enter/Space và screen reader label.

### Mobile — tái sử dụng màn hình có sẵn

- Không viết product picker mới và không mở bottom sheet cho bước chọn sản phẩm.
- Điều hướng toàn màn hình tới `SelectProductPage` tại `lib/src/core/widgets/select_product_page.dart` bằng `Navigator.push`/route chuẩn hiện có.
- Tái sử dụng `MobileProductBrowseDataSource`, tìm kiếm, bộ lọc, thumbnail, trạng thái chọn và footer xác nhận của component dùng chung.
- Không truyền `maxSelection: 1`; phải cho chọn nhiều sản phẩm. Truyền `initiallySelected` để giữ lựa chọn khi quay lại.
- Footer dùng đúng copy **Thêm N sản phẩm**. Sau xác nhận, nhận `List<MobileBrowseProduct>` và quay về form thêm thiết bị.
- Không fork/copy `SelectProductPage`, `ProductSelectionRow` hoặc logic browse/filter sang feature Công trình.

### Tạo danh sách bản nháp thiết bị

- Mỗi sản phẩm được chọn tạo đúng một bản nháp thiết bị độc lập; khóa ổn định theo `product_id` để rebuild không làm mất dữ liệu đang nhập.
- Có khu vực **Thông tin áp dụng chung** cho lệnh việc, vị trí lắp, ngày lắp, hạn bảo hành và ghi chú. Giá trị chung áp dụng cho mọi bản nháp nhưng từng thiết bị vẫn có thể override khi nghiệp vụ yêu cầu.
- Danh sách hiển thị **Thiết bị đã chọn (N)**. Mỗi hàng có thumbnail, tên, SKU, loại, trạng thái hoàn thiện, xóa và expand/collapse.
- Snapshot mỗi thiết bị được phép sửa và tối thiểu gồm: tên thiết bị, loại thiết bị, thương hiệu, model, serial, MAC, địa chỉ IP, vị trí lắp, ngày lắp, hạn bảo hành, lệnh việc và ghi chú.
- Khi chọn sản phẩm, tự điền dữ liệu catalog có sẵn nhưng không khóa field. Ảnh catalog chỉ để tham khảo và không tự trở thành ảnh lắp đặt.
- CTA lưu phải dùng copy theo số lượng: **Lưu N thiết bị**. Validation phải chỉ rõ bản nháp nào và field nào còn thiếu.

### Ảnh thiết bị

- Mỗi bản nháp có bộ ảnh riêng, không dùng chung ảnh giữa các thiết bị.
- Web hỗ trợ kéo-thả và chọn file. Mobile hỗ trợ **Chụp ảnh** và **Chọn từ thư viện**.
- Cho xem thumbnail, xóa, sắp xếp và chọn **Ảnh chính**; giới hạn mặc định 8 ảnh/thiết bị; hỗ trợ JPG, PNG và HEIC với validation dung lượng/định dạng rõ ràng.
- Dùng bucket private và signed URL ngắn hạn. Mở rộng attachment hiện có bằng liên kết `asset_id` và category `asset`; không lưu URL public vĩnh viễn trong `installed_assets`.
- Sau khi tạo asset, upload ảnh theo từng asset. Lỗi upload phải hiển thị đúng thiết bị bị lỗi và cho retry mà không tạo trùng asset.

### API và dữ liệu

- Product browse API phải trả đủ dữ liệu cần cho UI/snapshot: `id`, `name`, `sku`, `barcode`, `imageUrl`, `imageUpdatedAt`, `categoryName`, `brandId`, `brandName`, `model` và các field hiện có. Bổ sung API/model nếu còn thiếu, không suy đoán brand/model từ tên sản phẩm.
- Mobile payload phải gửi `productId` cho từng thiết bị chọn từ catalog; nhập thủ công gửi `productId: null`.
- Thêm contract batch để lưu nhiều thiết bị trong một thao tác. Phần tạo record phải chạy transaction all-or-nothing, kiểm tra project/job/product cùng `store_id` và trả mapping ổn định từ client draft sang asset đã tạo.
- Batch endpoint phải idempotent để retry không tạo thiết bị trùng. Không được gọi API tạo đơn lẻ trong vòng lặp mà không có cơ chế idempotency và tổng hợp lỗi.
- API web và mobile dùng chung domain/service; không duy trì hai implementation nghiệp vụ khác nhau.

### Icon contract — phải khớp thiết kế 100%

- Dùng đúng icon semantic và style đã thể hiện trong render: chọn từ sản phẩm, nhập thủ công, tìm kiếm, bộ lọc, checkbox chọn nhiều, thông tin không trừ kho, camera, thư viện ảnh, upload, ảnh chính, xóa, expand/collapse, quay lại, đóng và lịch.
- Web và mobile phải dùng cùng ý nghĩa icon, cùng trạng thái active/inactive/disabled và cùng optical size. Không thay icon bằng emoji, ký tự Unicode, text symbol hoặc icon gần nghĩa khác.
- Web dùng icon component/thư viện hiện có của Luma; mobile ưu tiên `LumaDesignIcon` và mapping tài sản hiện có. Nếu icon trong render chưa có, bổ sung đúng asset/mapping vào design icon system thay vì dùng `Icons.*` tùy tiện trong feature.
- Tạo bảng mapping kiểm chứng `design icon -> web component/name -> mobile LumaDesignIcon/name -> size -> color -> state` và dùng bảng này làm nguồn triển khai.
- Icon trong field/button phải giữ alignment, stroke weight, khoảng cách với label và kích thước đúng render. Touch target mobile tối thiểu 44 px nhưng glyph không được phóng to sai tỷ lệ.
- Thêm widget/component test cho đúng icon name ở các trạng thái quan trọng; golden/screenshot phải bắt được icon sai, thiếu hoặc fallback.

### Acceptance cho flow thiết bị

- Web và mobile cùng chọn được nhiều sản phẩm, tạo cùng số lượng bản nháp và lưu ra cùng số lượng installed asset.
- Chọn/lưu thiết bị không làm thay đổi tồn kho trước và sau thao tác; có test integration đối chiếu stock balance/stock movement.
- Quay lại màn chọn sản phẩm giữ nguyên lựa chọn; bỏ/chọn lại không làm sai dữ liệu các bản nháp khác.
- Ảnh được gắn đúng asset, private, hiển thị lại sau reload và retry không tạo trùng record/attachment.
- Manual mode, catalog mode, mixed device types, empty/loading/error/permission-denied, partial upload failure và validation nhiều bản nháp đều có test.
- So sánh web và mobile implementation với `06-selected-option-2-multi-product-flow.png` ở đúng viewport. Không hoàn tất khi còn sai icon, hierarchy, spacing, border, radius, typography hoặc trạng thái picker P0/P1/P2.

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
