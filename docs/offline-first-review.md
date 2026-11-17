# Rà soát offline-first — LumaPOS web + iOS native

Ngày: 2026-11-17. Phạm vi: `luma-pos-web` (Next.js) và `luma-pos-app/native-ios/LumaPOSNative` (SwiftUI).

## 1. Cơ chế hiện có

| Thành phần | Web | iOS native |
|---|---|---|
| Công tắc offline | `offline-sync-preference.ts`: **theo trình duyệt** (localStorage), mặc định bật; Mac host (loopback) luôn tắt. Cài đặt › Hệ thống › Đồng bộ offline. | `NativeOfflineModeStore` (`app.offlineMode`): **theo cửa hàng**, lưu ở `store.prefs` qua `/api/mobile/settings/prefs`, đổi cần quản lý + PIN; mirror vào UserDefaults, mặc định bật. |
| Hàng đợi ghi | IndexedDB `sales-pos-offline` (đơn POS) + `luma-service-offline` (checklist), gửi qua `/api/sync/relay`, idempotent theo `eventId` = SHA-256(`clientId`). | SQLite `offline_mutations` scope `store:principal:actor`; đơn POS → `/api/mobile/orders` (idempotent `clientId`) hoặc relay; dịch vụ hiện trường → `/api/mobile/services/jobs/…` (`clientMutationId` + `expectedVersion`); PATCH hóa đơn điện tử. Màn Khôi phục offline xử lý lỗi/xung đột. |
| Cache đọc | Product Catalog + lịch sử tồn kho (IndexedDB, scope user/role, xóa khi đăng xuất). SW chỉ cache asset tĩnh, không cache HTML/RSC/API. | `NativeReadQueryCacheStore` (SQLite `native_query_cache`) cho ~24 màn: khách, công nợ KH/NCC, sổ quỹ, kế toán, tài chính, giao hàng, ca, báo cáo, dịch vụ… + catalog, lịch sử hóa đơn, dashboard. |

## 2. Bảng luồng đọc/ghi

Ký hiệu: ✅ offline-first · 🟡 chỉ đọc cache (stale) · ❌ chỉ online.

| Luồng | Web đọc | Web ghi | iOS đọc | iOS ghi | Rủi ro / ghi chú |
|---|---|---|---|---|---|
| POS bán hàng (tiền mặt/thẻ, không nguồn) | ✅ catalog IndexedDB | ✅ outbox → relay | ✅ catalog SQLite | ✅ outbox | Trùng đơn: chặn bằng `clientId`/`eventId`. Giá đổi khi đang offline → `conflict` (`CHECKOUT_PRICING_CHANGED`), cần xử lý tay. Tồn kho có thể âm khi nhiều máy bán offline cùng lúc. |
| POS chuyển khoản / QR / thanh toán chờ / từ nháp, báo giá, trả hàng | — | ❌ (schema relay từ chối) | — | ❌ | Đúng thiết kế: cần xác nhận thanh toán server. Giữ online. |
| Đơn hàng / hóa đơn (xem, sửa, hủy) | ❌ | ❌ | 🟡 lịch sử HĐ | ❌ (trừ PATCH HĐĐT) | Sửa/hủy offline dễ lệch công nợ, kho. Giữ online. |
| Khách hàng (danh sách, công nợ) | ❌ | ❌ | 🟡 | ❌ | Dữ liệu cá nhân (SĐT, địa chỉ, công nợ) nằm trên máy iOS. Tạo KH offline dễ trùng SĐT. |
| Kho: tồn, lịch sử | ✅ (catalog, lịch sử) | ❌ | ✅ | ❌ | Kiểm kho/điều chỉnh/chuyển kho offline xung đột số lượng. Giữ online. |
| Nhập hàng / trả NCC / NCC | ❌ | ❌ | 🟡 NCC, công nợ NCC | ❌ | Ảnh hưởng giá vốn, công nợ. Giữ online. |
| Thu chi / sổ quỹ / ca | ❌ | ❌ | 🟡 | ❌ | Tiền: không nên ghi offline. Dữ liệu nhạy cảm trên máy iOS. |
| Kế toán, báo cáo, tài chính | ❌ | ❌ | 🟡 | ❌ | Chỉ đọc; số liệu nhạy cảm cache trên máy iOS. |
| Dịch vụ hiện trường: checklist | ✅ relay | ✅ | 🟡 | ✅ | Xung đột theo `expectedVersion` → màn khôi phục. |
| Dịch vụ: vật tư sử dụng, thiết bị lắp | ❌ | — (web không có form hiện trường) | 🟡 | ✅ | Relay backend đã hỗ trợ `material.usage`/`asset.create`; web chưa có UI hiện trường tương ứng nên không cần hàng đợi. |
| Công trình (dự án, ảnh, thiết bị) | ❌ | ❌ | 🟡 | ❌ (ảnh: hàng upload riêng) | Ảnh lớn; giữ online. |
| Cài đặt | ❌ | ❌ | ❌ | ❌ | Giữ online. |

## 3. Phát hiện chính

1. **Hai công tắc khác nghĩa.** iOS dùng chính sách cửa hàng `app.offlineMode` (quản lý tắt là tắt mọi máy iOS). Web bỏ qua chính sách này: quản lý tắt offline trên iOS nhưng trình duyệt vẫn xếp hàng đơn.
2. **iOS giữ dữ liệu nhạy cảm sau khi đăng xuất.** `AuthCoordinator.signOut()` chỉ xóa catalog; `native_query_cache` (khách, công nợ, sổ quỹ, kế toán…) vẫn nằm trong SQLite theo actor scope. Ai mở máy đăng nhập tài khoản khác không đọc được (scope), nhưng dữ liệu vẫn trên thiết bị.
3. **iOS cache đọc không theo công tắc.** Tắt offline mode chỉ ngừng xếp hàng ghi; màn hình vẫn ghi cache đọc vào SQLite.
4. Web: các luồng ghi ngoài POS/checklist đều online — hợp lý; không đề xuất xếp hàng thu chi, kho, nhập hàng, sửa đơn vì rủi ro tiền/kho.
5. Web đăng xuất không xóa outbox POS/checklist — đúng (không mất đơn chưa gửi; outbox scope theo user/store nên không replay sang tài khoản khác).

## 4. Đề xuất thứ tự

1. **Web tôn trọng chính sách cửa hàng** `app.offlineMode`: nếu cửa hàng tắt → web tắt offline, công tắc trình duyệt bị khóa và ghi chú lý do. (Nhỏ, an toàn.)
2. **iOS xóa cache đọc khi đăng xuất** (`native_query_cache` theo actor scope cũ). Catalog đã xóa sẵn; outbox giữ lại.
3. **iOS: khi offline mode tắt** → không ghi/đọc cache đọc mới và xóa cache đọc hiện có của actor.
4. (Tùy chọn, lớn) Thêm luồng ghi offline mới — không khuyến nghị lúc này.

## 5. Phạm vi đã chốt & triển khai

User chốt mục 1–3 (2026-11-17); mục 4 không làm.

### 5.1 Web tôn trọng chính sách cửa hàng
- `offline-sync-preference.ts`: thêm `luma.web.offline-sync.store-policy.v1` (bản sao cuối cùng của `prefs.app.offlineMode`). `isOfflineSyncEnabled()` = không phải Mac host **và** chính sách cửa hàng bật **và** công tắc trình duyệt bật. Chính sách lưu localStorage nên tải lại khi mất mạng vẫn theo.
- `components/offline-store-policy.tsx` bọc layout `(app)` và `(pos)`: ghi chính sách trước khi các con đọc công tắc; khi chuyển bật → tắt thì xóa bản sao danh mục + lịch sử tồn kho (giống tắt tay).
- Cài đặt › Đồng bộ offline: cửa hàng tắt → ẩn công tắc, hiện lý do (`storePolicyOffBody`). Đổi chính sách vẫn qua app iOS (quản lý + PIN); web chưa có nút đổi chính sách cửa hàng.
- Hàng đợi đã có vẫn được gửi (không mất đơn), endpoint `/api/sync/relay` không đổi.
- Test: `src/lib/offline/offline-sync-preference.test.mjs`.

### 5.2 iOS xóa cache đọc khi đăng xuất
- `NativeLumaDatabase.clearReadSnapshotCaches(principalPrefix:)` xóa `native_query_cache`, `dashboard_cache`, `order_list_cache` theo tiền tố `store:principal:` (gồm mọi thu ngân dưới tài khoản đó). Không đụng `offline_mutations`, nháp POS, catalog.
- `AuthCoordinator.signOut()` gọi hàm này cho phiên vừa đăng xuất.

### 5.3 iOS tắt offline mode = bỏ cache đọc
- `NativeOfflineModeStore.save(false)` xóa toàn bộ cache đọc trên máy.
- `NativeReadQueryCacheStore`, `NativeDashboardCache`, `NativeInvoiceHistoryCacheStore`: khi offline mode tắt thì không đọc/ghi cache (màn hình luôn lấy từ server).
- Test: `testReadSnapshotCachesFollowOfflineModeAndSignOutScope`.

### Còn lại (chưa làm)
- `pos_state` feature cache (tồn kho, phiếu nhập, khả năng thanh toán offline) vẫn ghi khi tắt offline: khả năng thanh toán cần cho POS; phiếu nhập/tồn kho có thể xử lý tương tự nếu cần.
- Chính sách cửa hàng chỉ đồng bộ vào iOS khi mở màn Cài đặt; máy iOS chưa mở cài đặt sau khi quản lý đổi trên máy khác vẫn theo giá trị cũ.
- Web chưa có nút đổi chính sách cửa hàng (cần PIN quản lý như iOS).
