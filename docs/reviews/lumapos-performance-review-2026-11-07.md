# LumaPOS — Performance review iOS + Web (2026-11-07)

**Trạng thái:** Đã review mã nguồn / ghi nhận backlog; **chưa sửa code hiệu năng trong đợt review này**.  
**Phạm vi:** Native SwiftUI iOS, Next.js Web, catalog offline, delta sync, IndexedDB/SQLite và backend Supabase.  
**Baseline được xem:** mobile `main` @ `25978d5b08e5322c6f10a75b4a601893e3312c00`; web `main` @ `664e9bba7bd9a7c01d9e83730d49bb9e011f7397`. Kiểm tra lại HEAD mới nhất trước khi triển khai.

## Tóm tắt

Unified Product Catalog V2 đã có những cơ chế cần giữ nguyên: một nguồn catalog chung, cache offline theo actor/scope, SQLite atomic commit + tombstone, IndexedDB atomic transaction, delta/full recovery, đồng bộ nhiều tab web, và search index web. Trọng tâm kế tiếp là giảm chi phí **lọc, xếp hạng, tạo projection, render và tải không cần thiết**, đặc biệt ở 10.000–50.000 SKU. Không thay đổi nghiệp vụ khi tối ưu.

## Vấn đề phát hiện trực tiếp từ source

| Ưu tiên | Khu vực | Vấn đề / bằng chứng | Hành động |
|---|---|---|---|
| P0 đo + tối ưu | iOS search | `native-ios/LumaPOSNative/Features/Inventory/InventoryCatalogModels.swift`, `NativeProductCatalogSnapshot.page()` (~L493–630): duyệt/collect toàn catalog, sort và tạo rank toàn catalog, một số predicate còn lặp trong comparator. Độ phức tạp tăng mạnh với số SKU. | Profile bằng Instruments; precompute candidate/rank/predicate; tận dụng search index và incremental projection; bảo đảm lọc/ranking trên **toàn bộ ứng viên trước pagination**. |
| P1 | iOS warmup | Cùng file, `warmDefaultBrowse()` (~L841–935) gọi một browse cho POS với `pageSize: max(1, catalog.rows.count)`, tạo một kết quả toàn bộ SKU trong lúc warm. | Đo allocation/cpu; tránh warm các bản sao/danh sách toàn bộ nếu POS không cần; giữ data đầy đủ offline ở canonical catalog. |
| P1 | iOS screen load | `native-ios/LumaPOSNative/Features/Inventory/InventoryView.swift` (~L153–168) gọi `loadInventory`, `loadStocktakes`, `loadProducts` ngay khi mở khu vực Hàng hóa, thêm reload khi chọn tab hoặc có notification. `InventoryProductListView.swift` (~L180–200) fetch categories kể cả khi đã có cache. | Cache-first + lazy loading theo tab, single-flight và TTL/invalidation theo mutation; không tải chồng hoặc hiển thị skeleton khi có data hợp lệ. |
| P1 | Web re-render | `src/app/(app)/inventory/tabs/product-catalog-products-content.tsx` (~L35–89): default prop `cameraSkus = []` tạo reference mới khi prop vắng, nằm trong dependency của `useMemo`; filter/result có thể tính lại trên re-render. | Dùng hằng số array/set ổn định và dependency primitives ổn định; dùng React Profiler xác nhận số lượt recompute. |
| P1 | Web broad search | `src/lib/product-catalog-explorer.ts` (~L263–375) tìm kiếm có thể trả tối đa `products.length`, dựng rank map, nhóm, lọc, sort toàn bộ candidates cho mỗi query. Component tính tức thời trên thay đổi input. | Giữ index/ranking chuẩn, tối ưu broad query, debounce/defer/worker nếu đo thấy giật; memoize projection và chỉ project row của trang hiện tại. Không sort trước lọc ứng viên nếu thay đổi thứ tự kết quả. |
| P1/P2 | Web delta apply | `src/lib/product-catalog.ts` (~L163–214) mỗi delta dựng Map full snapshot, loop catalog rồi sort full; `src/components/product-catalog-provider.tsx` (~L115–236) commit IndexedDB trước publish. | Đo delta apply/index patch; cân nhắc cấu trúc dữ liệu incremental nếu hiệu quả đo được. **Giữ nguyên atomicity, revision validation, tombstones, full recovery.** |
| P2 điều tra | Backend | `src/lib/data/product-catalog.ts` (~L214–380): full snapshot gồm nhiều subquery correlated cho units/prices/stocks/variants và aggregate recent sales. | Đo `EXPLAIN (ANALYZE, BUFFERS)` tại store đại diện + indexes/query count/response bytes, không kết luận query chậm nếu chưa đo. |
| P2 | POS, Dashboard, lịch sử đơn/khách | Những luồng này có cache nhưng vẫn có request refresh và state/update riêng; chưa có benchmark xuyên màn hình. | Thêm cold/warm/offline measurements, kiểm tra duplicate API, render frequency, cache TTL & invalidation; không làm chậm checkout. |

## Số liệu sẵn có (không phải benchmark production)

Nguồn: [Unified Catalog V2 test report (2026-11-06)](../unified-product-catalog-v2-test-report.md).

- **iOS synthetic search (iPhone 17 Simulator):** 1k = **84 ms**, 10k = **830 ms**, 50k = **4.210 ms**. Đây là microbenchmark, **không** phải latency mở màn hình trên thiết bị thật.
- **Web broad search đã có index:** 1k = **1,82 ms**, 10k = **20,29 ms**, 50k = **110,08 ms**; web exact SKU ở 50k = **0,017 ms** (synthetic Bun benchmark).
- **Web build search index:** 10k = **115,65 ms**, 50k = **680,43 ms** trong benchmark, được scheduling thành idle slices ở runtime web.
- **Quan sát một lần full snapshot store lớn nhất:** 3.463 sản phẩm, JSON **6.784.045 bytes** (~6,47 MiB), **2,46 giây** end-to-end. Không dùng một lần đo làm p95 hoặc ước lượng egress.
- Báo cáo ghi **59/59** test iOS catalog/selected-picker thành công và các bộ test catalog web pass. **Chưa có** đo Chrome/iPhone production đại diện hoặc lưu lượng V2 post-cutover đủ để khẳng định tiết kiệm Egress.

## Kế hoạch triển khai

1. **P0 — iOS search:** thêm benchmark có sample/counters cho 1k/10k/50k, sửa `page()` theo profile, regression cho ranking, variant/related grouping, stock/filter/pricing và pagination, đặc biệt các truy vấn broad.
2. **P1 — Web typing/render:** sửa dependency không ổn định; đo React Profiler; tối ưu local search/explorer mà không đổi candidate set, grouped view, thứ tự SKU hay POS picker behavior.
3. **P1 — iOS open screen:** single-flight, lazy-load Stocktakes/Inventory/Categories, cache-first và invalidation đúng sau mutation; kiểm tra launch sau kill app, switching tabs, offline.
4. **P1 — Web delta:** đo thời gian merge, full sort, IndexedDB, index patch và repeated refresh; chỉ đổi cấu trúc khi có cải thiện, giữ safe recovery.
5. **P2 — Supabase:** profile query và giảm full-snapshot payload/egress an toàn; thu thập post-cutover delta events và Dashboard usage trước khi kết luận hiệu quả.
6. **P2 — End-to-end:** test POS, hóa đơn, khách hàng, Hàng hóa, Thẻ kho và Dashboard trên data lớn, mạng chậm/offline, thiết bị iPhone thật và Chrome.

## Bộ tiêu chí chấp nhận

- Không mất/sai sản phẩm, liên kết nhóm, biến thể, giá theo bảng giá, tồn kho, đơn vị quy đổi, phân quyền, VAT, xóa/tombstone, recent-sales ranking hoặc kết quả bộ lọc.
- Catalog vẫn **offline-first** cho cả iOS/web; cùng một nguồn dữ liệu canonical; màn hình đã có cache hợp lệ hiển thị dữ liệu trước, không skeleton toàn màn hình chỉ vì refresh.
- Search/ranking theo quy chuẩn web, không sai thứ tự giữa các trang; query/out-of-order response không ghi đè kết quả mới.
- Delta/full recovery không làm rách snapshot: revision được công bố sau commit, rollback đúng và có test khi kill process / network fail.
- **Thẻ kho**: lịch sử chi tiết chỉ fetch khi mở sản phẩm, cache riêng theo product/page/actor, có offline fallback; không đưa lịch sử nhập/xuất toàn bộ vào catalog.
- Mỗi PR/commit phải báo cáo before/after: search p50/p95, keystroke responsiveness, screen-open cold/warm, RAM peak, request count, response bytes, SQLite/IndexedDB timing, backend SQL timing. Khi chưa có điều kiện đo, ghi rõ chưa xác minh.
- Test/TypeScript/lint/build iOS & web đạt trước khi merge/deploy; tránh sửa UI không liên quan.

## Phân biệt bằng chứng và giả thuyết

Các điểm liên quan vòng lặp/sort/duplicate trigger là **phát hiện mã nguồn**; mức độ tác động trong production vẫn cần đo. Số benchmark là dữ liệu lấy từ report ngày 06/11, chưa được chạy lại trong phiên review ngày 07/11. Không có thay đổi mã thực thi nào được áp dụng trong lần ghi note này.
