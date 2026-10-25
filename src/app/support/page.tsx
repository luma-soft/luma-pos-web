import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hỗ trợ | Hải Đăng POS",
  description: "Liên hệ hỗ trợ Hải Đăng POS và LumaPOS.",
};

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-canvas px-5 py-12 text-foreground sm:px-8 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-3xl border border-border bg-surface p-6 shadow-e1 sm:p-10">
        <a className="text-sm font-semibold text-primary-700 hover:underline" href="/">
          Hải Đăng POS · LumaPOS
        </a>
        <h1 className="mt-6 text-3xl font-black tracking-tight sm:text-4xl">Hỗ trợ ứng dụng</h1>
        <p className="mt-4 leading-7 text-slate-700 dark:text-slate-300">
          Hải Đăng POS dành cho nhân viên và chủ cửa hàng đã được cấp tài khoản LumaPOS. Nếu bạn chưa có tài khoản hoặc không thể đăng nhập, hãy liên hệ quản trị viên của cửa hàng trước.
        </p>

        <section className="mt-8 rounded-2xl border border-border bg-surface-2 p-6">
          <h2 className="text-lg font-extrabold">Liên hệ hỗ trợ</h2>
          <dl className="mt-4 space-y-4 text-sm">
            <div>
              <dt className="font-semibold text-slate-500">Người liên hệ</dt>
              <dd className="mt-1">Cao Văn Thiện</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-500">Email</dt>
              <dd className="mt-1"><a className="text-primary-700 hover:underline" href="mailto:cvthien.dev@gmail.com">cvthien.dev@gmail.com</a></dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-500">Điện thoại</dt>
              <dd className="mt-1"><a className="text-primary-700 hover:underline" href="tel:+84868306286">+84 868 306 286</a></dd>
            </div>
          </dl>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-extrabold">Khi cần hỗ trợ</h2>
          <p className="mt-3 leading-7 text-slate-700 dark:text-slate-300">
            Hãy mô tả thao tác đang thực hiện, tên cửa hàng, dòng máy và phiên bản ứng dụng. Bạn có thể đính kèm ảnh chụp lỗi sau khi che thông tin khách hàng không liên quan. Không gửi mật khẩu, mã OTP hoặc thông tin thanh toán nhạy cảm.
          </p>
        </section>

        <footer className="mt-10 border-t border-border pt-6 text-sm text-slate-500">
          <a className="font-semibold text-primary-700 hover:underline" href="/privacy">Chính sách quyền riêng tư</a>
        </footer>
      </article>
    </main>
  );
}
