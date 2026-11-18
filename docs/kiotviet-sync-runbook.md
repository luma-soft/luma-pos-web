# Đồng bộ KiotViet → Luma POS (Hải Đăng)

KiotViet không cấp API cho cửa hàng này, nên mỗi lần đồng bộ gồm hai việc: xuất file Excel trên KiotViet bằng Chrome, rồi chạy `kiotviet-sync-run` để nhập vào POS.

## Nguyên tắc

1. **Luma POS giữ mã của mình.** Chứng từ, khách, NCC và sản phẩm tạo từ KiotViet nhận mã POS (`DH-`, `PN-`, `TH-`, `THN-`, `KH-`, `NCC-`, SKU `SP…`). Mã KiotViet chỉ lưu trong `kiotviet_source_mappings` và `product_source_mappings`. Ngoại lệ duy nhất là ĐVT quy đổi (Hộp, Viên…): POS không có mã riêng cho ĐVT, nên ĐVT giữ SKU KiotViet trong `product_units.sku`.
2. **Không tạo trùng.**
   - Chứng từ POS đã tự ghi được nối với chứng từ KiotViet tương ứng bằng mapping `linked`. Chứng từ được nối không bị tạo lại, cũng không bị ghi đè.
   - Điều kiện nối: cùng khách/NCC, số tiền lệch không quá 1.000đ (làm tròn), và hai chứng từ gần nhau nhất theo cả hai chiều. Cửa sổ thời gian là 3 ngày cho bán/trả hàng, 8 ngày cho nhập/trả hàng nhập.
   - Chứng từ giống một phiếu POS nhưng không rõ ràng thì bị **giữ lại chờ duyệt**, không được tạo.
3. **Chỉ tạo phần còn thiếu.** Chứng từ đã khớp không bị sửa. Importer chứng từ không đổi tồn kho.
4. **Không chép sản phẩm ngừng kinh doanh.** Hàng có "Đang kinh doanh" = 0 không bao giờ được tạo. Chứng từ dùng hàng đó bị giữ lại.
5. **Không sửa DB tay.** Chỉ dùng các script dưới đây và API của POS.

## 1. Xuất file trên KiotViet (Chrome)

Tất cả file lưu vào một thư mục trống. Tên file giữ nguyên dạng `…_KVddmmyyyy-hhmmss-nnn.xlsx`.

| Trang KiotViet | Nút | File |
|---|---|---|
| Hàng hóa | Xuất file (chọn tất cả cột) | `DanhSachSanPham` |
| Khách hàng | ⋯ → Xuất file | `DanhSachKhachHang` (đầy đủ, không lọc) |
| Nhà cung cấp, Trạng thái **Tất cả** | Xuất file | `DanhSachNhaCungCap` |
| Hóa đơn | Xuất file → File chi tiết. Tích đủ cột, gồm **VAT, Giá trị VAT, VAT(%)** | `DanhSachChiTietHoaDon` |
| Nhập hàng | Xuất file → File chi tiết | `DanhSachChiTietNhapHang` |
| Trả hàng | Xuất file → File chi tiết | `DanhSachChiTietTraHang` |
| Trả hàng nhập | Xuất file → File chi tiết | `DanhSachChiTietTraHangNhap` |
| Đặt hàng (`#/Orders/`) | Xuất file → File chi tiết | `DanhSachChiTietDatHang` (có thể rỗng) |

- Chứng từ: lọc theo khoảng thời gian cần đồng bộ, ví dụ "Tháng này". Chứng từ nằm ngoài file được giữ nguyên.
- Nếu file có cột tiền tổng (Tổng tiền hàng, Cần trả…) mà thiếu cột VAT, importer coi VAT = 0. Phiếu nào thật sự có VAT sẽ bị đối soát chặn lại.
- Ghi lại hai số tổng ở đầu bảng:
  - Trang **Khách hàng**: "Nợ hiện tại" và "Tổng bán trừ trả hàng".
  - Trang **Nhà cung cấp**: "Nợ cần trả hiện tại" và "Tổng mua trừ trả hàng" (bật cột nếu đang ẩn).

## 2. Chạy thử

```bash
DATABASE_URL=… bun run src/scripts/kiotviet-sync-run.ts <thư-mục> --store=hai-dang --report=<báo-cáo.md>
```

Báo cáo liệt kê:
- chứng từ được nối,
- chứng từ sẽ tạo,
- chứng từ **giữ lại** kèm lý do,
- sản phẩm mới còn kinh doanh cần tạo,
- ĐVT sẽ gắn,
- blocker của importer.

## 3. Sản phẩm mới (nếu báo cáo có)

1. Tạo sản phẩm gốc bằng `POST /api/mobile/products` (phiên Owner trên POS) hoặc trên giao diện. **Không truyền `sku`** để POS tự sinh mã; không thêm ĐVT; nhập tên, nhóm, thương hiệu, ĐVT gốc, giá vốn và giá bán trước thuế theo báo cáo.
2. Nối SKU KiotViet vào sản phẩm vừa tạo:
   ```bash
   bun run src/scripts/kiotviet-pos-codes.ts --store=hai-dang --map-product=<SKU_KV>=<SKU_POS> --apply
   ```
3. Chạy lại bước 2. ĐVT quy đổi sẽ được gắn tự động khi chạy `--apply`.

## 4. Ghi

```bash
DATABASE_URL=… bun run src/scripts/kiotviet-sync-run.ts <thư-mục> --store=hai-dang --apply \
  --reviewed-customer-totals=<NỢ>:<TỔNG_BÁN_TRỪ_TRẢ> --reviewed-supplier-totals=<NỢ>:<TỔNG_MUA_TRỪ_TRẢ> \
  --report=<báo-cáo.md>
```

- `--only=sales,purchases,returns,purchase-returns` chỉ ghi chứng từ, không đụng số dư.
- Phase customers và suppliers đặt **công nợ** bằng số trong file. Chỉ dùng hai phase này với file vừa xuất ngay trước khi chạy.
- Trước khi ghi, dump DB: `pg_dump -Fc`.
- Mỗi phase tự lập lại kế hoạch sau khi ghi và phải ra 0 khác biệt. Chạy lại cùng bộ file thì không ghi thêm gì.

## 5. Sau khi chạy

- Xem các chứng từ **giữ lại** trong báo cáo. Nếu đúng là cùng một giao dịch, nối tay bằng mapping `linked`; nếu không, xử lý trên POS.
- Tồn kho không tự đồng bộ. Lệch tồn do chứng từ vừa nhập thì cân bằng bằng phiếu kiểm kho trên POS. Lệch không rõ nguyên nhân thì giữ tồn POS và kiểm thực tế.
- **Xoá các file đã xuất từ KiotViet**, gồm cả thư mục Downloads.

## Công cụ

| Script | Việc |
|---|---|
| `src/scripts/kiotviet-sync-run.ts` | Chạy trọn một lần đồng bộ (nối → lọc → sản phẩm → importer → báo cáo) |
| `src/scripts/kiotviet-link-documents.ts` | Chỉ nối chứng từ POS đã có |
| `src/scripts/sync-kiotviet-data.ts` | Importer theo từng phase (`--map-customer=KV=POS` để nối khách) |
| `src/scripts/kiotviet-pos-codes.ts` | Đổi sang mã POS, `--map-product`, `--unit` |
| `src/scripts/sync-kiotviet-products.ts` | Đồng bộ ghi đè cả catalog. **Đã khoá** với định dạng xuất hiện tại, không dùng |
