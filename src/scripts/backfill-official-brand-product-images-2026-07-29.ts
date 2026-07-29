import { and, eq, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../db";
import { brands, products } from "../db/schema";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  imageUrls: string[] | null;
};

type ImageRule = {
  key: string;
  source: string;
  sourcePage: string;
  skus?: readonly string[];
  brand?: string;
  name?: RegExp;
};

const NTP_PRODUCTS_PAGE = "https://nhuatienphong.vn/san-pham.html";
const PANASONIC_PRODUCTS_PAGE = "https://panasonic.net/pewvn/";

const imageRules: readonly ImageRule[] = [
  // Nhựa Tiền Phong — ảnh catalog chính thức. Các kích cỡ cùng một dòng dùng
  // chung ảnh đại diện vì catalog hãng cũng quản lý sản phẩm theo dòng/kết cấu.
  {
    key: "ntp-pvc-bac-chuyen-bac",
    source: "https://admin.nhuatienphong.vn/img/products/I08/tiny_img_1540800377.sn4VdUz27DyREe1tcJSr.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Bạc Chuyển Bậc\b/u,
  },
  {
    key: "ntp-pvc-dau-bit",
    source: "https://admin.nhuatienphong.vn/img/products/I17/tiny_img_1543980733.PhcrgsAESqDj7L0W3i92.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Bịt Ống\b/u,
  },
  {
    key: "ntp-pvc-bit-xa-thong-tac",
    source: "https://admin.nhuatienphong.vn/img/products/I22/tiny_img_1543979692.Bl6PcksALiXf9n5RuGtU.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Bịt Xả Thông Tắc\b/u,
  },
  {
    key: "ntp-ppr-noi-goc-45",
    source: "https://admin.nhuatienphong.vn/img/products/R06/tiny_img_1535007463.BMCWLqf3a7jwNYXViSut.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Chếch PPR\b/u,
  },
  {
    key: "ntp-pvc-noi-goc-45",
    source: "https://admin.nhuatienphong.vn/img/products/I09/tiny_img_1540800327.VUrwRNvzQI95Acmx2uoZ.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Chếch -/u,
  },
  {
    key: "ntp-ppr-noi-thang-chuyen-bac",
    source: "https://admin.nhuatienphong.vn/img/products/R05/tiny_img_1535007486.DG4m5SfM9YqrxCTKXPhN.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Côn Thu PPR\b/u,
  },
  {
    key: "ntp-pvc-noi-thang-chuyen-bac",
    source: "https://admin.nhuatienphong.vn/img/products/I07/tiny_img_1540800411.QfY1bx9vAHG68aEsTIdq.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Côn Thu PVC\b/u,
  },
  {
    key: "ntp-ppr-noi-goc-90",
    source: "https://admin.nhuatienphong.vn/img/products/R07/tiny_img_1535007437.N0feji8YarGd7UBPhsvo.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Cút Góc PPR\b/u,
  },
  {
    key: "ntp-ppr-noi-goc-ren-ngoai",
    source: "https://admin.nhuatienphong.vn/img/products/R10/tiny_img_1536915233.Qaxj2CF0NEPJWA7Zociw.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Cút Ren Ngoài PPR\b/u,
  },
  {
    key: "ntp-ppr-noi-goc-ren-trong",
    source: "https://admin.nhuatienphong.vn/img/products/R08/tiny_img_1541134010.bkZ3V8G9OLh2l6Pp47jF.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Cút Ren Trong PPR\b/u,
  },
  {
    key: "ntp-pvc-noi-goc-90",
    source: "https://admin.nhuatienphong.vn/img/products/I10/tiny_img_1540800303.N25uZRp1GXTCYbWmft0P.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Cút Góc -/u,
  },
  {
    key: "ntp-dien-hop-noi-3-duong",
    source: "https://admin.nhuatienphong.vn/img/products/D12/tiny_img_1538383280.OEyiczRgJFeV6Zb3B5Kw.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    name: /^(?:Hộp chia ba ngả Tiền Phong|Hộp Chia Ngả 4 Đường Tiền Phong)\b/u,
  },
  {
    key: "ntp-pvc-keo-dan",
    source: "https://admin.nhuatienphong.vn/img/products/D17/tiny_img_1638502646.QlueJEUkIw3ctoC1ar4h.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Keo Dán Ống\b/u,
  },
  {
    key: "ntp-dien-kep-do-ong",
    source: "https://admin.nhuatienphong.vn/img/products/D15/tiny_img_1538383892.GDPzadsYCq75bwihey6o.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    name: /^Kẹp đỡ ống Tiền Phong\b/u,
  },
  {
    key: "ntp-ppr-noi-thang-ren-ngoai",
    source: "https://admin.nhuatienphong.vn/img/products/R04/tiny_img_1535007529.vqpZXLiHwS3FlTsg1Rej.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Măng Sông Ren Ngoài PPR\b/u,
  },
  {
    key: "ntp-ppr-noi-thang-ren-trong",
    source: "https://admin.nhuatienphong.vn/img/products/R03/tiny_img_1536928151.jnFQ8wzkc1iPrRdSa5K0.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Măng Sông Ren Trong PPR\b/u,
  },
  {
    key: "ntp-ppr-noi-thang",
    source: "https://admin.nhuatienphong.vn/img/products/R02/tiny_img_1535007580.35qS8IQB7rpkMe6DLcgP.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Măng Sông PPR\b/u,
  },
  {
    key: "ntp-dien-khop-noi-tron",
    source: "https://admin.nhuatienphong.vn/img/products/D02/tiny_img_1538379221.P5ytv94rnbWUYFVhiKl0.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    name: /^Măng sông, Khớp nối trơn Tiền Phong\b/u,
  },
  {
    key: "ntp-pvc-noi-thang",
    source: "https://admin.nhuatienphong.vn/img/products/ISO003/tiny_img_1584411905.PSoZC7aBATr6tzLk1pdF.jpg",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Măng Sông -/u,
  },
  {
    key: "ntp-ppr-dau-bit",
    source: "https://admin.nhuatienphong.vn/img/products/R15/tiny_img_1535017299.UGOJnvx6YWK5Qupg72Mf.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Nút Bịt PPR\b/u,
  },
  {
    key: "ntp-dien-ong-luon-day",
    source: "https://admin.nhuatienphong.vn/img/products/D01/tiny_img_1538378651.wu9jik6oQb2TDtFEmVcy.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    name: /^[ÔỐ]ng luồn dây điện Tiền Phong\b/iu,
  },
  {
    key: "ntp-ppr-ong",
    source: "https://admin.nhuatienphong.vn/img/products/R01/tiny_img_1535007184.shSEw1x7ocgZrNA4RGTb.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Ống Nhựa PPR Tiền Phong\b/u,
  },
  {
    key: "ntp-pvc-ong",
    source: "https://admin.nhuatienphong.vn/img/products/I01/tiny_img_1544080703.2ahjczbm7o1DRvuKYILZ.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Ống Nhựa PVC Tiền Phong\b/u,
  },
  {
    key: "ntp-hdpe-ong",
    source: "https://admin.nhuatienphong.vn/img/products/E01/tiny_img_1535012975.HFXM0rxPeyKRU5zfvoVi.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    name: /^Ống HDPE Tiền Phong\b/u,
  },
  {
    key: "ntp-ppr-ong-tranh",
    source: "https://admin.nhuatienphong.vn/img/products/L20/tiny_img_1536802605.64b5vzmy1Dp8ga9BCTIM.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Ống Tránh(?: PPR)?\b/u,
  },
  {
    key: "ntp-ppr-zac-co",
    source: "https://admin.nhuatienphong.vn/img/products/R20/tiny_img_1535018676.qLOsn7gSZvjJuo5Y6tdI.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Rắc Co PPR\b/u,
  },
  {
    key: "ntp-ppr-zac-co-ren-ngoai",
    source: "https://admin.nhuatienphong.vn/img/products/R21/tiny_img_1535018915.QiH5PpZW3YFl8k4uG2hm.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Rắc Co Ren Ngoài PPR\b/u,
  },
  {
    key: "ntp-ppr-zac-co-ren-trong",
    source: "https://admin.nhuatienphong.vn/img/products/R22/tiny_img_1535019152.jDxsa1VwGhqnQItrUFfS.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Rắc Co Ren Trong PPR\b/u,
  },
  {
    key: "ntp-pvc-noi-ren-ngoai",
    source: "https://admin.nhuatienphong.vn/img/products/I06/tiny_img_1540800439.pm3J1LFXIdSDwuTHslqP.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Ren Ngoài\b/u,
  },
  {
    key: "ntp-pvc-noi-ren-trong",
    source: "https://admin.nhuatienphong.vn/img/products/I04/tiny_img_1540800566.vs0QX2NqAmbj8FaU7CVB.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Ren Trong\b/u,
  },
  {
    key: "ntp-ppr-ba-chac-90",
    source: "https://admin.nhuatienphong.vn/img/products/R11/tiny_img_1536548035.IRDOlQv47MfTd5XtKpAy.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Tê PPR\b/u,
  },
  {
    key: "ntp-ppr-ba-chac-ren-ngoai",
    source: "https://admin.nhuatienphong.vn/img/products/R13/tiny_img_1535009166.GYTKQMZcLR4qedjBAHl9.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Tê Ren Ngoài PPR\b/u,
  },
  {
    key: "ntp-ppr-ba-chac-ren-trong",
    source: "https://admin.nhuatienphong.vn/img/products/R12/tiny_img_1535008382.OWMHZQxYhzmkaIeLj81A.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Tê Ren Trong PPR\b/u,
  },
  {
    key: "ntp-ppr-ba-chac-chuyen-bac",
    source: "https://admin.nhuatienphong.vn/img/products/R14/tiny_img_1535012245.Ioayq2GhZD34YTXMzLOA.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Tê Thu PPR\b/u,
  },
  {
    key: "ntp-pvc-ba-chac-90",
    source: "https://admin.nhuatienphong.vn/img/products/I14/tiny_img_1540800053.c674YvKwybMAzHkNL5Xi.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Tê Cân\b/u,
  },
  {
    key: "ntp-pvc-ba-chac-cong-88",
    source: "https://admin.nhuatienphong.vn/img/products/ISOA010/tiny_img_1584673203.y1I63jF9ZnSlX7BtksOG.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Tê Cong\b/u,
  },
  {
    key: "ntp-pvc-ba-chac-chuyen-bac",
    source: "https://admin.nhuatienphong.vn/img/products/I16/tiny_img_1543980371.Fy2l4G37ei1CawQVISkj.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Tê Thu PVC\b/u,
  },
  {
    key: "ntp-ppr-van-cua",
    source: "https://admin.nhuatienphong.vn/img/products/R19/tiny_img_1535018475.tyBsTkFuOlCKWnZH1p5h.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Van Cửa PPR\b/u,
  },
  {
    key: "ntp-pvc-van-cau",
    source: "https://admin.nhuatienphong.vn/img/products/I20/tiny_img_1544080868.L8QDSahOsNBmpVM4cjZe.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    name: /^Van nhựa tiền phong\b/iu,
  },
  {
    key: "ntp-pvc-ba-chac-45",
    source: "https://admin.nhuatienphong.vn/img/products/I21/tiny_img_1543979720.5LnMkuva6f2diHrROYoI.png",
    sourcePage: NTP_PRODUCTS_PAGE,
    brand: "Nhựa Tiền Phong",
    name: /^Y\b/u,
  },

  // Panasonic Electric Works — ảnh sản phẩm từ JSON/catalog chính thức.
  {
    key: "panasonic-mcb-1p",
    source: "https://panasonic.net/pewvn/uploads/product/0e660c26-8838-4aac-a7ad-cd0b5bb290cb.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    brand: "Panasonic",
    name: /^Át Cài Đơn Panasonic 1P1E\b/u,
  },
  {
    key: "panasonic-mcb-2p",
    source: "https://panasonic.net/pewvn/uploads/product/db8412a5-5eea-484d-ad8b-3d94673d1f0e.jpg",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    brand: "Panasonic",
    name: /^Át Cài Đôi Panasonic 2P2E\b/u,
  },
  {
    key: "panasonic-mcb-3p",
    source: "https://panasonic.net/pewvn/uploads/product/45a00eca-8664-4b88-a69e-96e9759dfe9a.jpg",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    brand: "Panasonic",
    name: /^Át Cài 3 Pha Panasonic 3P3E\b/u,
  },
  {
    key: "panasonic-rcbo",
    source: "https://panasonic.net/pewvn/uploads/product/50c45c7e-da5a-4baf-9a3c-d6355f4e3a76.jpg",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    brand: "Panasonic",
    name: /^Át chống giật Panasonic\b/u,
  },
  {
    key: "panasonic-hb-breaker",
    source: "https://panasonic.net/pewvn/uploads/product/adf51119-f779-45ee-8af9-1325af8affc3.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    brand: "Panasonic",
    name: /^Át Khối Panasonic\b/u,
  },
  {
    key: "panasonic-wnv1081",
    source: "https://panasonic.net/pewvn/uploads/product/88d20708-b562-4649-a28c-ad4932573d88.png",
    sourcePage: "https://panasonic.net/pewvn/san-pham/thiet-bi-noi-day-dong-full-color-wnv1081-7w.html",
    skus: ["SP053238"],
  },
  {
    key: "panasonic-wnv5001",
    source: "https://panasonic.net/pewvn/uploads/product/8b14031a-6e2f-4de0-9070-e2287838aba5.png",
    sourcePage: "https://panasonic.net/pewvn/san-pham/thiet-bi-noi-day-dong-full-color-wnv5001-7w.html",
    skus: ["SP053237"],
  },
  {
    key: "panasonic-wev5001",
    source: "https://panasonic.net/pewvn/uploads/product/5d78ef30-4c11-49a2-ba95-4cbce86257af.png",
    sourcePage: "https://panasonic.net/pewvn/san-pham/thiet-bi-noi-day-dong-wide-series-wev5001-7.html",
    skus: ["SP000929"],
  },
  {
    key: "panasonic-wev5002",
    source: "https://panasonic.net/pewvn/uploads/product/23b82beb-919b-435c-b1df-cd7123c3bdae.png",
    sourcePage: "https://panasonic.net/pewvn/san-pham/thiet-bi-noi-day-dong-wide-series-wev5002-7sw.html",
    skus: ["SP000930"],
  },
  {
    key: "panasonic-wev5033",
    source: "https://panasonic.net/pewvn/uploads/product/fe11ccca-ab07-44fa-aacf-4cdc2305882f.jpg",
    sourcePage: "https://panasonic.net/pewvn/san-pham/thiet-bi-noi-day-dong-wide-series-wev5033-7sw.html",
    skus: ["SP053073"],
  },
  {
    key: "panasonic-wev1582",
    source: "https://panasonic.net/pewvn/uploads/product/1ca0c40a-4799-4211-9e0d-f92f6a03cff1.png",
    sourcePage: "https://panasonic.net/pewvn/san-pham/thiet-bi-noi-day-dong-wide-series-wev1582-7sw.html",
    skus: ["SP001481"],
  },
  {
    key: "panasonic-wev1181",
    source: "https://panasonic.net/pewvn/uploads/product/832708ed-1af3-4d81-9f43-2941941dbbca.png",
    sourcePage: "https://panasonic.net/pewvn/san-pham/thiet-bi-noi-day-dong-wide-series-wev1181-7sw.html",
    skus: ["SP001645"],
  },
  {
    key: "panasonic-wev1081",
    source: "https://panasonic.net/pewvn/uploads/product/fbe9ba0b-13c1-4d35-a232-11bf9e4762d5.png",
    sourcePage: "https://panasonic.net/pewvn/san-pham/thiet-bi-noi-day-dong-wide-series-wev1081-7sw.html",
    skus: ["SP000928"],
  },
  {
    key: "panasonic-wzv7841",
    source: "https://panasonic.net/pewvn/uploads/product/d938f45c-aaa2-47fe-b5d7-7bc9e99c3f6d.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    skus: ["SP002562"],
  },
  {
    key: "panasonic-wev68010",
    source: "https://panasonic.net/pewvn/uploads/product/9dd679ac-6b6e-46d7-9b23-965e77b3d37d.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    skus: ["SP000932"],
  },
  {
    key: "panasonic-wzv7842",
    source: "https://panasonic.net/pewvn/uploads/product/73a853d7-f006-474a-a7ae-b8e3c477a008.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    skus: ["SP053239"],
  },
  {
    key: "panasonic-wev68020",
    source: "https://panasonic.net/pewvn/uploads/product/cda00959-409d-4f1b-a601-6347c82c0246.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    skus: ["SP000933"],
  },
  {
    key: "panasonic-wzv7843",
    source: "https://panasonic.net/pewvn/uploads/product/0aac6a71-697f-45dc-8db8-4b96f7f381cd.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    skus: ["SP053240"],
  },
  {
    key: "panasonic-wev68030",
    source: "https://panasonic.net/pewvn/uploads/product/2edf5f38-ebe3-4dde-8d84-2922dd804df7.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    skus: ["SP000934"],
  },
  {
    key: "panasonic-wev68910",
    source: "https://panasonic.net/pewvn/uploads/product/1f90ade6-3086-4f8e-aa59-6409effa61f9.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    skus: ["SP002684"],
  },
  {
    key: "panasonic-wev7061",
    source: "https://panasonic.net/pewvn/uploads/product/2a8eab08-b7a3-4aec-94ab-9d28ab4c0227.jpg",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    skus: ["SP001646"],
  },
  {
    key: "panasonic-wev680290",
    source: "https://panasonic.net/pewvn/uploads/product/c7e46b34-ee3f-4743-bc46-72f06f87857b.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    skus: ["SP053074"],
  },
  {
    key: "panasonic-wev2488",
    source: "https://panasonic.net/pewvn/uploads/product/c7e4080e-4db8-435b-9ea1-8d20b6238143.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    skus: ["SP002142"],
  },
  {
    key: "panasonic-nrv3160",
    source: "https://panasonic.net/pewvn/uploads/product/f6fd7f11-ad8d-427d-9e56-907d75b47f14.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    skus: ["SP002139"],
  },
  {
    key: "panasonic-weg7903",
    source: "https://panasonic.net/pewvn/uploads/product/50ff34e7-c9aa-4776-8858-5c6ca8c1195b.png",
    sourcePage: PANASONIC_PRODUCTS_PAGE,
    skus: ["SP001920"],
  },

  // Rạng Đông — ảnh và trang sản phẩm trực tiếp từ rangdong.com.vn.
  {
    key: "rang-dong-m36-600",
    source: "https://rangdong.com.vn/uploads/products/den-led/bo-den/m36/m36-600-25w/m36-600-25w-1.jpg",
    sourcePage: "https://rangdong.com.vn/bo-den-led-noi-tran-m36-600-25w-pr2823.html",
    skus: ["SP000843"],
  },
  {
    key: "rang-dong-m36-1200",
    source: "https://rangdong.com.vn/uploads/products/den-led/bo-den/m36/m36-1200-50w/m36-1200-50w-1.jpg",
    sourcePage: "https://rangdong.com.vn/bo-den-led-noi-tran-m36-1200-50w-pr2822.html",
    skus: ["SP000844"],
  },
  {
    key: "rang-dong-m66-1200",
    source: "https://rangdong.com.vn/uploads/products/den-led/bo-den/m66/m66-1200-60w/m66-1200-60w-1.jpg",
    sourcePage: "https://rangdong.com.vn/bo-den-led-noi-tran-m66-1200-60w-pr2384.html",
    skus: ["SP000845"],
  },
  {
    key: "rang-dong-tr60n2-10w",
    source: "https://rangdong.com.vn/uploads/products/den-led/led-bulb/tr60n2-10w-h/tr60n2-10w-h-1.jpg",
    sourcePage: "https://rangdong.com.vn/bong-den-led-bulb-tru-nhom-nhua-tr60n2-10w-pr557.html",
    skus: ["SP000829"],
  },
  {
    key: "rang-dong-a70n1-12w",
    source: "https://rangdong.com.vn/uploads/products/den-led/led-bulb/a70n1-12w-h/a70n1-12w-h-1.jpg",
    sourcePage: "https://rangdong.com.vn/bong-den-led-bulb-tron-a70n1-12w-pr180.html",
    skus: ["SP000830"],
  },
  {
    key: "rang-dong-a80n1-15w",
    source: "https://rangdong.com.vn/uploads/products/den-led/led-bulb/a80n1-15w-h/a80n1-15w-h-1.jpg",
    sourcePage: "https://rangdong.com.vn/bong-den-led-bulb-tron-a80n1-15w-pr179.html",
    skus: ["SP000831"],
  },
  {
    key: "rang-dong-tr80n1-20w",
    source: "https://rangdong.com.vn/uploads/products/den-led/led-bulb/tr80n1-20w-h/tr80n1-20w-h-1.jpg",
    sourcePage: "https://rangdong.com.vn/bong-den-led-bulb-tru-nhom-nhua-tr80n1-20w-pr1634.html",
    skus: ["SP000832"],
  },
  {
    key: "rang-dong-a120n1-30w",
    source: "https://rangdong.com.vn/uploads/products/den-led/led-bulb/a120n1-30w-h/a120n1-30w-h-1.JPG",
    sourcePage: "https://rangdong.com.vn/bong-den-led-bulb-tron-a120n1-30w-pr177.html",
    skus: ["SP000833"],
  },
  {
    key: "rang-dong-tr120n1-40w",
    source: "https://rangdong.com.vn/uploads/products/den-led/led-bulb/tr120n1-40w-h/tr120n1-40w-h-1.jpg",
    sourcePage: "https://rangdong.com.vn/bong-den-led-bulb-tru-nhom-nhua-tr120n1-40w-pr1000.html",
    skus: ["SP000834"],
  },
  {
    key: "rang-dong-tr140n1-50w",
    source: "https://rangdong.com.vn/uploads/products/den-led/led-bulb/tr140n1-50w-h/tr140n1-50w-h-1.jpg",
    sourcePage: "https://rangdong.com.vn/bong-den-led-bulb-tru-nhom-nhua-tr140n1-50w-pr830.html",
    skus: ["SP000835"],
  },
  {
    key: "rang-dong-tr140nd-60w",
    source: "https://rangdong.com.vn/uploads/products/den-led/led-bulb/tr140nd-60w/tr140nd-60w-1.jpg",
    sourcePage: "https://rangdong.com.vn/bong-den-led-bulb-tru-nhom-duc-tr140nd-60w-pr941.html",
    skus: ["SP000836"],
  },
  {
    key: "rang-dong-a60n3-7w",
    source: "https://rangdong.com.vn/uploads/products/den-led/led-bulb/a60n3-7w-h/a60n3-7w-h-1.jpg",
    sourcePage: "https://rangdong.com.vn/bong-den-led-bulb-tron-a60n3-7w-pr151.html",
    skus: ["SP000828"],
  },
  {
    key: "rang-dong-ctcu-wf",
    source: "https://rangdong.com.vn/uploads/products/nha-thong-minh/cong-tac-thong-minh/cong-tac-cua-cuon/ctcu-wf-cn-dot-2w-sp/ctcu-wf-cn-dot-2w-sp-den.jpg",
    sourcePage: "https://rangdong.com.vn/cong-tac-cam-ung-cua-cuon-chu-nhat-2-chieu-thong-minh-wifi-pr2885.html",
    skus: ["SP052935"],
  },
  {
    key: "rang-dong-at04-90-10w",
    source: "https://rangdong.com.vn/uploads/products/den-led/downlight/at04/at04-90-10w/at04-90-10w-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-am-tran-downlight-at04-90-10w-pr2986.html",
    skus: ["SP002530"],
  },
  {
    key: "rang-dong-at04-90-8w",
    source: "https://rangdong.com.vn/uploads/products/den-led/downlight/at04/at04-90-8w/at04-90-8w-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-am-tran-downlight-at04-90-8w-pr2985.html",
    skus: ["SP000846", "SP053059"],
  },
  {
    key: "rang-dong-at10-110-12w-gold",
    source: "https://rangdong.com.vn/uploads/products/den-led/downlight/at10/at10-110-10w-g/at10-110-10w-g-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-am-tran-downlight-at10-110-10w-6500k-vien-vang-pr3645.html",
    skus: ["SP053161"],
  },
  {
    key: "rang-dong-at10-90-10w-gold",
    source: "https://rangdong.com.vn/uploads/products/den-led/downlight/at10/at10-90-10w-g/at10-90-10w-g-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-am-tran-downlight-at10-90-10w-6500k-vien-vang-pr3644.html",
    skus: ["SP000541"],
  },
  {
    key: "rang-dong-at10-90-8w-gold",
    source: "https://rangdong.com.vn/uploads/products/den-led/downlight/at10/at10-90-8w-g/at10-90-8w-g-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-am-tran-downlight-at10-90-8w-6500k-vien-vang-pr3643.html",
    skus: ["SP000847"],
  },
  {
    key: "rang-dong-gt16-round",
    source: "https://rangdong.com.vn/uploads/products/den-led/gan-tuong/gt16/gt16-pir-180x55-15w/gt16-pir-180x55-15w-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-gan-tuong-cam-bien-gt16-180x55-15w-pr2173.html",
    skus: ["SP053069"],
  },
  {
    key: "rang-dong-gt16-rectangle",
    source: "https://rangdong.com.vn/uploads/products/den-led/gan-tuong/gt16/gt16-pir-220x100-15w/gt16-pir-220x100-15w-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-gan-tuong-cam-bien-gt16-220x100-15w-pr2174.html",
    skus: ["SP053068"],
  },
  {
    key: "rang-dong-nt03-dm",
    source: "https://rangdong.com.vn/uploads/product/LED/LED_Downlight/NT03-120-12W/NT03.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-downlight-noi-tran-doi-mau-nt03-120-10w-pr2842.html",
    skus: ["SP053058"],
  },
  {
    key: "rang-dong-ln12-radar-round",
    source: "https://rangdong.com.vn/uploads/products/den-led/op-tran/ln12-rad/ln12-rad-220-18w-wc/ln12-rad-220-18w-wc-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-op-tran-tron-cam-bien-chuyen-dong-anh-sang-pr1848.html",
    skus: ["SP053070"],
  },
  {
    key: "rang-dong-ln12-radar-square",
    source: "https://rangdong.com.vn/uploads/products/den-led/op-tran/ln12-rad/ln12-rad-220x220-18w-hl/ln12-rad-220x220-18w-hl-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-op-tran-vuong-cam-bien-chuyen-dong-anh-sang-pr1847.html",
    skus: ["SP053071"],
  },
  {
    key: "rang-dong-cp06-50w",
    source: "https://rangdong.com.vn/uploads/products/den-led/chieu-pha/cp06/cp06-50w/cp06-50w-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-chieu-pha-cp06-50w-6500k-pr1213.html",
    skus: ["SP000598"],
  },
  {
    key: "rang-dong-ln12n-round-220",
    source: "https://rangdong.com.vn/uploads/products/den-led/op-tran/ln12n/ln12n-220-18w/ln12n-220-18w-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-op-tran-tron-ln12n-de-nhua-220-18w-pr1085.html",
    skus: ["SP000848"],
  },
  {
    key: "rang-dong-ln12n-round-300",
    source: "https://rangdong.com.vn/uploads/products/den-led/op-tran/ln12n/ln12n-300-24w/ln12n-300-24w-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-op-tran-tron-ln12n-de-nhua-300-24w-pr1975.html",
    skus: ["SP000849"],
  },
  {
    key: "rang-dong-ln12n-square-220",
    source: "https://rangdong.com.vn/uploads/products/den-led/op-tran/ln12n/ln12n-220x220-18w/ln12n-220x220-18w-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-op-tran-vuong-ln12n-de-nhua-220x220-18w-pr1084.html",
    skus: ["SP000850"],
  },
  {
    key: "rang-dong-ln12n-square-300",
    source: "https://rangdong.com.vn/uploads/products/den-led/op-tran/ln12n/ln12n-300x300-24w/ln12n-300x300-24w-1.jpg",
    sourcePage: "https://rangdong.com.vn/den-led-op-tran-vuong-ln12n-de-nhua-300x300-24w-pr1731.html",
    skus: ["SP001906"],
  },
  {
    key: "rang-dong-m9-double",
    source: "https://rangdong.com.vn/uploads/product/mang-den/FS-40-36x2-M9/FS-40-36x2-M9-1.jpg",
    sourcePage: "https://rangdong.com.vn/mang-den-led-tuyp-doi-pr195.html",
    skus: ["SP000841"],
  },
  {
    key: "rang-dong-m9-single",
    source: "https://rangdong.com.vn/uploads/product/mang-den/FS_40_36x1_M9_LED_TUBE/FS_40_36X1_M9_4.jpg",
    sourcePage: "https://rangdong.com.vn/mang-den-led-tuyp-don-pr221.html",
    skus: ["SP000840"],
  },
  {
    key: "rang-dong-dbm01",
    source: "https://rangdong.com.vn/uploads/products/thiet-bi-dien/den-bat-muoi-con-trung/dbm01-5w/dbm01-5w-6.jpg",
    sourcePage: "https://rangdong.com.vn/de-n-ba-t-muo-i-ra-ng-dong-dbm01-5w-pr2203.html",
    skus: ["SP053356"],
  },
] as const;

function isMissingImage(imageUrls: string[] | null) {
  return !Array.isArray(imageUrls) || imageUrls.every((url) => !url?.trim());
}

function matches(rule: ImageRule, product: ProductRow) {
  if (rule.skus && !rule.skus.includes(product.sku)) return false;
  if (rule.brand && rule.brand !== product.brand) return false;
  if (rule.name && !rule.name.test(product.name)) return false;
  return true;
}

function extensionFor(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function summarizeAssignments(
  assignments: ReadonlyMap<string, { product: ProductRow; rule: ImageRule }>,
) {
  const summary = new Map<string, number>();
  for (const { product } of assignments.values()) {
    const label = product.brand || "Không gắn hãng";
    summary.set(label, (summary.get(label) ?? 0) + 1);
  }
  return [...summary].map(([brand, count]) => ({
    Hãng: brand,
    "Sản phẩm": count,
  }));
}

async function main() {
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      brand: brands.name,
      imageUrls: products.imageUrls,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(eq(products.isActive, true));

  const missingProducts = rows.filter((row) => isMissingImage(row.imageUrls));
  const assignments = new Map<string, { product: ProductRow; rule: ImageRule }>();

  for (const product of missingProducts) {
    const matchingRules = imageRules.filter((rule) => matches(rule, product));
    if (matchingRules.length > 1) {
      throw new Error(
        `Sản phẩm ${product.sku} khớp nhiều quy tắc: ${matchingRules.map((rule) => rule.key).join(", ")}`,
      );
    }
    if (matchingRules[0]) {
      assignments.set(product.id, { product, rule: matchingRules[0] });
    }
  }

  if (assignments.size === 0) {
    console.log("Không còn sản phẩm phù hợp nào thiếu ảnh.");
    return;
  }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.table(summarizeAssignments(assignments));
    console.log(`Dry run: sẽ bổ sung ${assignments.size} sản phẩm.`);
    return;
  }

  const usedRules = [
    ...new Map(
      [...assignments.values()].map(({ rule }) => [rule.key, rule]),
    ).values(),
  ];
  const supabase = createSupabaseAdminClient();
  const publicUrls = new Map<string, string>();

  for (const rule of usedRules) {
    const response = await fetch(rule.source, {
      headers: { "User-Agent": "LumaPOS product catalog image backfill" },
    });
    if (!response.ok) {
      throw new Error(
        `Không tải được ảnh ${rule.key}: HTTP ${response.status} (${rule.sourcePage})`,
      );
    }

    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Nguồn ${rule.key} trả về ${contentType || "không rõ"}, không phải ảnh`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 120 || metadata.height < 120) {
      throw new Error(
        `Ảnh ${rule.key} quá nhỏ hoặc không đọc được kích thước: ${metadata.width ?? "?"}x${metadata.height ?? "?"}`,
      );
    }

    const path = `official-catalog-2026-07/${rule.key}.${extensionFor(contentType)}`;
    const { error } = await supabase.storage.from("products").upload(path, bytes, {
      contentType,
      upsert: true,
    });
    if (error) {
      throw new Error(`Không tải được ${rule.key} lên Storage: ${error.message}`);
    }

    const { data } = supabase.storage.from("products").getPublicUrl(path);
    publicUrls.set(rule.key, data.publicUrl);
  }

  await db.transaction(async (tx) => {
    for (const { product, rule } of assignments.values()) {
      const [updated] = await tx
        .update(products)
        .set({
          imageUrls: [publicUrls.get(rule.key)!],
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(products.id, product.id),
            sql`(${products.imageUrls} is null or jsonb_array_length(${products.imageUrls}) = 0)`,
          ),
        )
        .returning({ sku: products.sku });

      if (!updated) {
        throw new Error(`Không cập nhật được ${product.sku}; ảnh có thể vừa được thay đổi`);
      }
    }
  });

  const updatedIds = [...assignments.keys()];
  const verified = await db
    .select({
      id: products.id,
      sku: products.sku,
      imageUrls: products.imageUrls,
    })
    .from(products)
    .where(inArray(products.id, updatedIds));

  const verificationFailures = verified.filter((row) => isMissingImage(row.imageUrls));
  if (verified.length !== assignments.size || verificationFailures.length > 0) {
    throw new Error(
      `Xác minh thất bại: cần ${assignments.size}, đọc được ${verified.length}, thiếu ảnh ${verificationFailures.length}`,
    );
  }

  console.table(summarizeAssignments(assignments));
  console.log(
    `Đã bổ sung và xác minh ${verified.length} sản phẩm bằng ${usedRules.length} ảnh catalog chính thức.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
