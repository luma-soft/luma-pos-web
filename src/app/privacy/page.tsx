import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chính sách quyền riêng tư | Hải Đăng POS",
  description: "Thông tin về dữ liệu được xử lý khi sử dụng Hải Đăng POS.",
};

const sections = [
  {
    title: "Dữ liệu được xử lý",
    paragraphs: [
      "Hải Đăng POS dành cho cửa hàng và tổ chức đang sử dụng LumaPOS. Tài khoản nhân viên do quản trị viên của tổ chức cấp. Tùy tính năng và quyền được cấp, hệ thống xử lý thông tin tài khoản như tên, email, số điện thoại, vai trò và cửa hàng được truy cập.",
      "Khi tổ chức sử dụng ứng dụng, dữ liệu nghiệp vụ có thể gồm sản phẩm, tồn kho, đơn hàng, khoản thanh toán được ghi nhận, khách hàng, nhà cung cấp, nhân viên, chứng từ, hồ sơ dịch vụ và tệp hoặc ảnh do người dùng chọn tải lên. Dữ liệu khách hàng do tổ chức nhập có thể chứa tên, thông tin liên hệ, địa chỉ và lịch sử giao dịch.",
      "Ứng dụng có thể xử lý thông tin kỹ thuật cần thiết để vận hành và bảo vệ dịch vụ, chẳng hạn phiên đăng nhập, phiên bản ứng dụng, phiên bản hệ điều hành và nhật ký lỗi hoặc bảo mật. Camera chỉ được dùng khi người dùng chủ động quét mã hoặc chụp ảnh trong tính năng tương ứng; ứng dụng không dùng dữ liệu vị trí chính xác.",
    ],
  },
  {
    title: "Cách dữ liệu được sử dụng",
    paragraphs: [
      "Dữ liệu được dùng để xác thực tài khoản, áp dụng quyền truy cập, đồng bộ dữ liệu cửa hàng, cung cấp các chức năng bán hàng và quản lý, hỗ trợ người dùng, xử lý sự cố và bảo vệ dịch vụ.",
      "Hải Đăng POS không bán dữ liệu cá nhân, không dùng dữ liệu để quảng cáo theo dõi người dùng giữa các ứng dụng hoặc trang web, và không tích hợp công cụ quảng cáo trong ứng dụng.",
    ],
  },
  {
    title: "Dịch vụ bên thứ ba và tích hợp",
    paragraphs: [
      "Dữ liệu cần thiết được xử lý trên hạ tầng cung cấp ứng dụng, cơ sở dữ liệu, xác thực và lưu trữ tệp. Một số chức năng có thể dùng Supabase, Vercel hoặc dịch vụ lưu trữ phương tiện được cấu hình cho hệ thống.",
      "Nếu tổ chức bật tích hợp bên ngoài hoặc tính năng AI, dữ liệu liên quan chỉ được gửi khi người dùng hoặc tổ chức chủ động sử dụng tính năng đó. Các nhà cung cấp AI có thể gồm OpenAI, Google Gemini hoặc DeepSeek theo cấu hình của cửa hàng; nội dung văn bản, hình ảnh hoặc dữ liệu nghiệp vụ cần thiết cho yêu cầu có thể được gửi tới nhà cung cấp được chọn để xử lý.",
      "Tổ chức sử dụng LumaPOS chịu trách nhiệm về dữ liệu do mình nhập, quyền truy cập nhân viên và việc bật các tích hợp cho cửa hàng. Nhà cung cấp bên thứ ba xử lý dữ liệu theo điều khoản và chính sách riêng của họ.",
    ],
  },
  {
    title: "Lưu trữ, quyền truy cập và yêu cầu riêng tư",
    paragraphs: [
      "Dữ liệu nghiệp vụ được lưu trong không gian cửa hàng và được giới hạn theo tài khoản, vai trò và quyền truy cập. Dữ liệu được giữ trong thời gian tổ chức còn sử dụng dịch vụ, theo hướng dẫn của tổ chức và các yêu cầu lưu trữ, an toàn hoặc pháp luật có liên quan. Bản sao lưu và nhật ký kỹ thuật có thể được lưu theo chu kỳ của hạ tầng cung cấp dịch vụ.",
      "Nhân viên nên liên hệ quản trị viên cửa hàng để yêu cầu xem, sửa hoặc xóa dữ liệu tài khoản và dữ liệu nghiệp vụ. Bạn cũng có thể liên hệ bộ phận hỗ trợ qua địa chỉ bên dưới. Việc xóa dữ liệu có thể phụ thuộc quyền quản trị của tổ chức và nghĩa vụ lưu hồ sơ của tổ chức.",
    ],
  },
  {
    title: "Liên hệ và cập nhật chính sách",
    paragraphs: [
      "Nếu có câu hỏi hoặc yêu cầu liên quan đến quyền riêng tư, hãy liên hệ Cao Văn Thiện qua email cvthien.dev@gmail.com hoặc số điện thoại +84 868 306 286. Vui lòng không gửi mật khẩu hoặc mã xác minh qua email.",
      "Chính sách này được cập nhật lần cuối ngày 25 tháng 10 năm 2026. Nếu cách xử lý dữ liệu thay đổi đáng kể, nội dung chính sách sẽ được cập nhật tại trang này.",
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-canvas px-5 py-12 text-foreground sm:px-8 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-3xl border border-border bg-surface p-6 shadow-e1 sm:p-10">
        <a className="text-sm font-semibold text-primary-700 hover:underline" href="/">
          Hải Đăng POS · LumaPOS
        </a>
        <h1 className="mt-6 text-3xl font-black tracking-tight sm:text-4xl">Chính sách quyền riêng tư</h1>
        <p className="mt-3 text-sm text-slate-500">Cập nhật lần cuối: 25 tháng 10 năm 2026</p>
        <p className="mt-6 leading-7 text-slate-700 dark:text-slate-300">
          Chính sách này mô tả cách Hải Đăng POS xử lý dữ liệu khi bạn đăng nhập và sử dụng ứng dụng. Ứng dụng phục vụ các cửa hàng dùng LumaPOS; tài khoản được tổ chức cấp cho nhân viên, không đăng ký công khai trong ứng dụng.
        </p>

        <nav aria-label="Mục lục chính sách" className="mt-8 rounded-2xl bg-surface-2 p-5">
          <h2 className="font-bold">Mục lục</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-primary-700">
            {sections.map((section, index) => (
              <li key={section.title}>
                <a className="hover:underline" href={`#section-${index + 1}`}>{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-9">
          {sections.map((section, index) => (
            <section key={section.title} id={`section-${index + 1}`}>
              <h2 className="text-xl font-extrabold">{section.title}</h2>
              <div className="mt-3 space-y-3 text-[15px] leading-7 text-slate-700 dark:text-slate-300">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-10 border-t border-border pt-6 text-sm text-slate-500">
          <a className="font-semibold text-primary-700 hover:underline" href="/support">Trang hỗ trợ</a>
        </footer>
      </article>
    </main>
  );
}
