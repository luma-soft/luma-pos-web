<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Database migrations

- Khi thay đổi schema hoặc thêm/sửa file trong `drizzle/`, phải tự động chạy `bun run src/db/apply-migrations.ts` trên database được cấu hình sau khi kiểm tra migration. Không được chỉ tạo file migration rồi bàn giao.
- Sau khi chạy, phải xác minh không còn migration pending và truy vấn được các bảng/cột vừa thay đổi trước khi báo hoàn tất.
- Dùng migration runner có tracking `_migrations`; không dùng `db:push` chỉ để apply một migration đã tồn tại.

## Git workflow preference

- Mặc định làm việc trực tiếp trên branch `main`; không tự tạo branch hoặc mở PR.
- Sau khi hoàn tất một task thay đổi code, mặc định commit các thay đổi thuộc task và push trực tiếp lên `origin/main`, trừ khi người dùng nói rõ không push.
- Không chờ người dùng nhắc lại việc commit/push; luôn kiểm tra `git status`, không đưa file tạm hoặc thay đổi ngoài phạm vi task vào commit.

## Picker và dropdown hiển thị cho người dùng

- Không dùng `<select>` hoặc `<datalist>` native làm bề mặt tương tác hiển thị
  cho picker, bộ lọc hay menu của Luma web. Popup native phụ thuộc hệ điều hành
  và không khớp design system Luma.
- Mặc định phải dùng picker Luma tùy biến: trigger được style, popover/listbox
  có kiểm soát (hoặc responsive sheet đã được duyệt), đầy đủ trạng thái đang
  chọn, hover/focus, điều hướng bàn phím, đóng khi click ra ngoài và nhãn tiếng
  Việt nhất quán.
- Chỉ được dùng control native khi người dùng yêu cầu rõ UI native hoặc làm
  fallback form/accessibility không hiển thị. Không được dùng native chỉ vì
  triển khai nhanh hơn.
- Khi chuyển flow từ mobile sang web, phải đồng bộ cả business logic lẫn interaction
  model; không được thay Luma picker trên mobile bằng dropdown native trên web.
- Trước khi chốt UI picker, bắt buộc kiểm tra trạng thái đã mở trên browser mục
  tiêu. Chỉ kiểm tra trigger khi đang đóng là chưa đủ.
