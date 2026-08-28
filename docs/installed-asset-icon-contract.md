# Installed asset icon contract

Nguồn chuẩn: `artifacts/project-device-photo-audit-2026-08-28/06-selected-option-2-multi-product-flow.png`.

Không dùng emoji, ký tự Unicode, SVG viết tay hoặc `Icons.*` trong flow thiết bị mới. Web dùng `lucide-react`; mobile dùng `LumaDesignIcon` và node Lucide tương ứng trong design icon system dùng chung.

| Ngữ nghĩa trong thiết kế | Web | Mobile | Glyph | Màu/trạng thái |
| --- | --- | --- | --- | --- |
| Chọn từ sản phẩm | `FolderSearch`, 28 px, stroke 1.8 | `folderSearch`, 26 px, stroke 1.8 | Lucide `folder-search` | primary khi active; secondary khi inactive |
| Nhập thủ công | `SquarePen`, 28 px, stroke 1.8 | `edit`, 26 px, stroke 1.8 | Lucide `square-pen` | primary khi active; secondary khi inactive |
| Tìm kiếm | `Search`, 16 px | icon tìm kiếm của `ProductBrowseScaffold`, 20 px | Lucide/search của design system | tertiary |
| Bộ lọc | component filter dùng chung | `filter` trong `ProductBrowseScaffold`, 20 px | Lucide `filter` của design system | primary; nền/border active dùng primary soft |
| Chọn nhiều — đã chọn | `Check`, 14 px, stroke 3 trong ô 20 px | `check`, 14 px, stroke 2.6 trong vòng 22 px | Lucide `check` | glyph trắng, nền primary |
| Chọn nhiều — chưa chọn | ô vuông border 20 px | `circle`, 22 px | Lucide `circle` | border/text tertiary |
| Không trừ kho | `Info`, 16 px | `infoCircle`, 16 px | Lucide `info` / `circle-info` | secondary |
| Chụp ảnh | không áp dụng trên web | `camera`, 18 px | Lucide `camera` | secondary/default button |
| Chọn thư viện | không áp dụng trên web | `image`, 18 px | Lucide `image` | secondary/default button |
| Tải ảnh | `Plus`, 20 px | không áp dụng | Lucide `plus` | tertiary; primary khi hover/focus |
| Ảnh chính/đã tải | `Check`, 14 px | `check`, 14 px | Lucide `check` | trắng trên primary hoặc primary trên trắng |
| Xóa | `Trash2`, 16 px | `trash`, 18 px | Lucide `trash-2` | secondary; danger khi destructive state |
| Mở rộng/thu gọn | `ChevronDown` / `ChevronUp`, 16 px | `chevronDown` / `chevronUp`, 18 px | Lucide chevrons | secondary |
| Quay lại | header dùng chung | `MobileBackButton` | icon của header dùng chung | giữ nguyên component header |
| Đóng | `X`, 16 px trong `RowPreviewModal` | `x`, 14 px trên thumbnail | Lucide `x` | secondary |
| Lịch | control date hiện có | `calendar`, 20 px | Lucide `calendar` | secondary |

Touch target mobile tối thiểu 44 px; kích thước glyph giữ đúng bảng. Trạng thái disabled giảm opacity qua component button/picker dùng chung, không đổi sang glyph khác.
