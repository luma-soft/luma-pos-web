# Bảng giá và chiết khấu bán hàng

Quyết định ngày 2026-09-04: bảng hiển thị theo thứ tự **Giá vốn → Giá nhập cuối → Giá chưa chiết khấu → Giá chung**, sau đó đến các bảng tự tạo. Mỗi dòng là một SKU bán được; sản phẩm cha không đại diện cho giá của các biến thể.

| Bảng | Nguồn | Sửa giá | Quyền sử dụng |
| --- | --- | --- | --- |
| Giá vốn | `products.costPrice`, do luồng tính vốn quản lý | Không sửa tại bảng giá | Chủ cửa hàng/quản lý |
| Giá nhập cuối | Phiếu đã nhận gần nhất: tổng dòng sau giảm trừ chiết khấu cả phiếu phân bổ, chia số lượng đơn vị gốc | Tự động | Chủ cửa hàng/quản lý |
| Giá chưa chiết khấu | Giá niêm yết công ty lưu riêng trong `product_prices`, `system_type=list` | Chủ cửa hàng/quản lý | Nhân viên được bán hàng |
| Giá chung | `products.retailPrice` | Chủ cửa hàng/quản lý | Nhân viên được bán hàng |

Tên, loại và việc xóa bảng hệ thống vẫn bị khóa. Khóa siêu dữ liệu độc lập với quyền sửa giá. Bảng giá công ty không lấy giá vốn, giá nhập hay giá chung làm giá thay thế khi thiếu. Không sao chép giá mua nội bộ sang bảng giá công ty trong migration. Giá 0 được giữ; thiếu giá là `null`.

## Nhập hàng

Đơn giá trên phiếu là giá trước chiết khấu NCC. Chiết khấu dòng và chiết khấu cả phiếu độc lập với chiết khấu khách hàng khi bán. Giá nhập cuối chưa gồm VAT/phí vận chuyển. Tổng dòng đã ghi là nguồn chính cho chứng từ nhập lịch sử; nhiều dòng cùng SKU được tính bình quân theo số lượng đơn vị gốc. Phiếu nháp/hủy không được dùng. Thứ tự là thời điểm nhận (`cost_effective_at` nếu có, nếu không dùng `created_at`), không phải lúc người dùng sửa ghi chú.

Giá nhập cuối được truy vấn từ chứng từ hiện hành nên sửa/hủy phiếu tự phản ánh mà không cần ghi một bộ nhớ đệm giá khác. `products.lastPurchasePrice` vẫn giữ nghĩa cũ là **gross nhập**, phục vụ lịch sử/tính vốn; API dùng trường riêng `lastPurchaseNetPrice` cho bảng Giá nhập cuối.

Chủ cửa hàng/quản lý có thể chọn **Cập nhật giá công ty** trên từng dòng nhập. Mặc định tắt, kể cả khi sao chép/sửa phiếu. Khi chọn, ghi đơn giá trước chiết khấu, trước VAT theo đơn vị gốc vào bảng công ty trong cùng giao dịch lưu phiếu; ghi lịch sử thay đổi kèm phiếu nguồn. Nhập hàng bình thường không thay đổi bảng công ty. Các dòng cùng SKU yêu cầu cập nhật hai giá khác nhau bị từ chối.

## Bán hàng

Giá chung vẫn là lựa chọn bán mặc định, bất kể thứ tự hiển thị. Có thể chọn bảng khác từng dòng trong đơn hỗn hợp. Bảng công ty quy đổi trực tiếp theo đơn vị gốc, không dùng giá bán riêng của đơn vị thay thế. Giá được hiểu trước VAT; thuế theo thiết lập hóa đơn hiện có.

Chọn Giá chưa chiết khấu rồi nhập chiết khấu `%` hoặc tiền cho khách. Web có thao tác áp dụng chiết khấu cho các dòng đang dùng giá công ty; các dòng khác không thay đổi. Bảng công ty không tự cộng thêm khuyến mại. Giảm toàn hóa đơn vẫn là thao tác riêng và theo quy tắc quyền hiện có.

Chiết khấu làm tròn trên mỗi đơn vị trước khi nhân số lượng, thống nhất preview web/mobile và server. Ví dụ 9.999 × 3 giảm 20%: giảm mỗi đơn vị 2.000; tổng 23.997. Các công thức hàng loạt chỉ áp dụng SKU có giá nền, không tự lấp giá thiếu.

Đơn mới lưu giá trước giảm, loại/giá trị chiết khấu đã nhập, tổng tiền giảm của dòng, giá sau giảm, tên/ID bảng giá. Chiết khấu dòng `discount` là **tổng dòng**, `unit_price` vẫn là giá **sau giảm** để giữ tương thích tổng tiền. Xem lại, sửa/sao chép và in dùng các giá trị đã lưu. Dữ liệu cũ không bị suy diễn tỷ lệ chiết khấu; bộ đọc dùng tổng tiền đã ghi để tránh trừ giảm hai lần.

## Sửa sản phẩm có nhiều đơn vị

Web và mobile giữ ID đơn vị, hệ số thập phân và giá riêng khi sửa thông tin sản phẩm. `priceOverride: null` nghĩa là quy đổi từ Giá chung; `0` là giá riêng hợp lệ. Client cũ bỏ qua trường giá riêng không được xóa giá đã có. Tiền lưu tối đa 2 số lẻ, hệ số 4 số lẻ; bản xem trước và dữ liệu gửi lưu dùng cùng độ chính xác.

Form hiển thị giá gốc cùng tên đơn vị; đơn vị bổ sung có giá riêng hoặc giá quy đổi. Khi bấm **Lưu** một SKU hiện có, thay đổi giá/hệ số/đơn vị sẽ mở xác nhận trước/sau; sửa tên, mô tả hoặc mã vạch không bật xác nhận giá. Web dùng dialog, mobile dùng Luma modal sheet. Hủy xác nhận không gửi cập nhật.

- **Giữ giá riêng** (mặc định): giữ giá đã nhập, gồm giá riêng bằng 0; đơn vị không có giá riêng tiếp tục theo giá gốc.
- **Đồng bộ theo tỷ lệ**: chọn đơn vị làm nguồn. Giá gốc = giá nguồn / hệ số, làm tròn 2 số lẻ; xóa giá riêng của các đơn vị về `null`, giá quy đổi làm tròn đến đồng. Nếu nhiều giá vừa sửa không cùng tỷ lệ, phải chọn rõ nguồn trước khi xác nhận.
- Chỉ đổi giá vốn hoặc bảng riêng: xem trước ảnh hưởng của bảng đó, không đề nghị xóa giá riêng của Giá chung. Đồng bộ Giá chung không ghi lại giá gốc của các bảng khác; giá đơn vị thuộc bảng tự tạo vẫn theo chính sách tỷ lệ hiện có và được xem trước nếu thay đổi.
- Không tự lan giá sang SKU khác. Luồng sửa nhóm biến thể giữ quy tắc riêng. Nếu người dùng đã chọn áp dụng giá/đơn vị cho sản phẩm cùng loại, web cảnh báo phạm vi đó; bảng xem trước chỉ đại diện SKU đang sửa.

Mobile POS đọc giá riêng theo cùng chính sách web. Đổi đơn vị/bảng giá lấy giá hiện hành; chỉ sửa số lượng/chiết khấu của dòng đã lưu giữ giá và hệ số lịch sử. Đơn giá nhập tay thuộc đơn vị đang bán, không bị nhân hệ số hai lần.

## Thiết lập giá trên web và mobile

Mỗi SKU hiển thị đơn vị gốc và các đơn vị bổ sung cùng hệ số, giá hiện hành. Một dòng `product_units` trùng tên đơn vị gốc không được coi là đơn vị bổ sung; đơn vị khác tên có hệ số 1 vẫn hợp lệ.

- Giá chung: sửa đơn vị bổ sung ở chế độ **Giữ giá riêng** chỉ đổi giá riêng của đơn vị đó; xóa giá riêng để trở lại quy đổi. Chọn **Đồng bộ theo tỷ lệ** lấy đơn vị vừa sửa làm nguồn, cập nhật giá gốc và xóa giá riêng của SKU trong một giao dịch.
- Giá chưa chiết khấu: giá đơn vị bổ sung quy đổi theo hệ số. Sửa giá đơn vị bổ sung quy ngược về giá gốc của bảng này, không đổi Giá chung.
- Bảng tự tạo: giữ chính sách tỷ lệ giá riêng hiện có so với Giá chung. Khi không thể quy ngược duy nhất (giá gốc/giá riêng bằng 0), đơn vị bổ sung chỉ đọc và yêu cầu sửa giá theo đơn vị gốc. Xóa giá bảng chỉ thực hiện tại đơn vị gốc.
- Giá vốn/Giá nhập cuối chỉ đọc. Giá thiếu khác giá 0; nhập sai định dạng không được hiểu là xóa giá. Giá đầu vào được chuẩn hóa 2 số lẻ trước quy đổi; phép tính tiền dùng số thập phân chính xác, gồm trường hợp đúng nửa xu.
- Xác nhận hiển thị trước/sau và mặc định giữ giá riêng. Hủy hoặc lưu không thay đổi không gửi cập nhật. Payload của màn Thiết lập giá gửi snapshot đã xem; server so sánh giá gốc, Giá chung, tên/hệ số/giá riêng các đơn vị dưới khóa trước khi ghi. Nếu dữ liệu đã đổi, yêu cầu tải lại và xác nhận lại, không ghi đè âm thầm. Client cũ chưa gửi snapshot vẫn tương thích.

Công thức hàng loạt dùng cùng bộ lọc với danh sách, qua **mọi trang**, và chỉ áp dụng SKU đang bán, bán trực tiếp, có giá nền. Số hiển thị là số lượng **tối đa** trong danh sách lọc, không cam kết tất cả có giá nền. Bộ lọc không hợp lệ bị từ chối, không bỏ qua để mở rộng phạm vi. Đồng bộ đơn vị hàng loạt chỉ có ở Giá chung và chỉ xóa giá riêng của SKU thực sự được cập nhật. Giá chưa chiết khấu là một nguồn công thức; kết quả làm tròn 2 số lẻ và không âm.

## Bảng giá POS và làm mới catalog

Web/mobile dùng cùng chính sách khi đổi bảng giá:

- Toàn hóa đơn: giữ dòng giá nhập tay cùng chiết khấu; lấy giá mới và bỏ chiết khấu dòng không nhập tay. Nếu có ảnh hưởng giá/chiết khấu thì xác nhận trước khi thay đổi.
- Từng dòng: đổi bảng giá hoặc đơn vị có xác nhận khi cần bỏ giá nhập tay/chiết khấu. Không cập nhật một phần giỏ nếu một dòng không có giá ở bảng đích.
- Chọn khách hàng không tự đổi bảng giá theo các nhãn retail/wholesale/vip cố định. Giá chung vẫn là mặc định.
- Khuyến mại tự động dùng số lượng đã quy đổi về đơn vị gốc và không cộng vào Giá chưa chiết khấu, giá nhập tay hoặc dòng có chiết khấu riêng. Chiết khấu tiền nhập ở POS là tiền trên mỗi đơn vị; draft mobile cũ lưu tiền cả dòng được chuyển đổi một lần để giữ nguyên tổng tiền.

Catalog mobile lưu bảng giá và khuyến mại theo cửa hàng/người dùng; tập rỗng từ server xóa dữ liệu cũ, trường vắng mặt từ API cũ không xóa nhầm. Khi ứng dụng trở lại hoặc catalog thay đổi, cập nhật danh mục nhưng giữ snapshot giá/hệ số đang bán. Trước checkout, mobile kiểm tra lại catalog/khuyến mại, kể cả khi revision không đổi (khuyến mại có thể bắt đầu/kết thúc theo giờ). Nếu giá, hệ số hoặc tổng tiền thay đổi, dừng trước tạo đơn/thu tiền để người bán xem lại. Báo giá đã lưu dùng snapshot riêng. Bước kiểm tra này không phải khóa giá phía server trong khoảng giữa kiểm tra và tạo đơn.

## Migration và kiểm tra

`0129_four_price_books.sql` đã áp dụng bằng migration runner có tracking/session lock. Giữ ID bảng nhập nội bộ cũ; tạo ID mới cho bảng công ty và lưu tên bảng cũ trên các dòng đơn lịch sử trước khi đổi tên. Không sửa giá trị sản phẩm hoặc tổng chứng từ. Catalog web tăng schema version để bỏ giá nhập gross đã cache dưới loại purchase cũ.

`0130_pricing_catalog_revision.sql` đã áp dụng ngày 2026-09-04 sau xác nhận của người dùng, bằng migration runner có session/advisory lock và tracking. Migration bổ sung trigger revision cho thay đổi bảng giá và khuyến mại, đồng thời làm mới các snapshot cũ một lần. Không đổi giá hoặc chứng từ. Kiểm thử biệt lập xác nhận phạm vi theo cửa hàng; hậu kiểm database xác nhận cả hai trigger bật và không còn migration chờ.

Kiểm tra tập trung bao gồm migration/RLS, giá net theo chứng từ và đơn vị, nguồn giá/role POS, giá thiếu/0, hai biến thể RAP2200, công thức và ghi giá, opt-in nhập hàng, snapshot chiết khấu, đơn cũ và bản in A4/K80, làm tròn và mở lại đơn trên mobile. Bộ chọn giá nền đã được kiểm tra trạng thái mở trong trình duyệt.
