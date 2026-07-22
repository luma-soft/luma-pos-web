import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { brands, categories, products } from "../db/schema";
import { buildCameraProductDescription } from "./camera-product-description";

type CatalogProduct = {
  sku: string;
  name: string;
  brand?: "EZVIZ" | "IMOU" | "Hikvision" | "Kioxia" | "Lexar";
  category: "Camera giám sát" | "Thẻ nhớ" | "Dịch Vụ";
  costPrice: number;
  retailPrice: number;
  description: string;
  image?: string;
  warrantyMonths?: number;
  specs: Record<string, string[]>;
};

const camera = (
  sku: string,
  name: string,
  brand: "EZVIZ" | "IMOU",
  costPrice: number,
  retailPrice: number,
  image: string,
  fullCode: string,
  resolution: string,
  lens: string,
  connection: string,
  nightAndProtection: string,
  powerAndStorage: string,
  features: string,
): CatalogProduct => ({
  sku,
  name,
  brand,
  category: "Camera giám sát",
  costPrice,
  retailPrice,
  image,
  description: buildCameraProductDescription({
    name,
    fullCode,
    resolution,
    lens,
    connection,
    nightAndProtection,
    powerAndStorage,
    features,
  }),
  specs: {
    "Mã đầy đủ": [fullCode],
    "Độ phân giải": [resolution],
    "Ống kính / góc nhìn": [lens],
    "Kết nối": [connection],
    "Ban đêm / bảo vệ": [nightAndProtection],
    "Nguồn / lưu trữ": [powerAndStorage],
    "Tính năng chính": [features],
  },
});

const catalog: CatalogProduct[] = [
  camera(
    "EZ-C1CB-2MP", "EZVIZ C1C-B 2MP", "EZVIZ", 395_000, 475_000,
    "c1c_b.jpg", "CS-C1C-B-E0-1E2WF", "1920 x 1080 (2MP), H.265",
    "2.8mm; ngang 91°, dọc 50°, chéo 108°", "Wi-Fi 2.4GHz; đàm thoại hai chiều",
    "Hồng ngoại đến 12m", "5V/1A, tối đa 3W; microSD đến 256GB",
    "Phát hiện chuyển động, cảnh báo trên ứng dụng EZVIZ; micro và loa tích hợp.",
  ),
  camera(
    "EZ-H1C-2MP", "EZVIZ H1C 2MP", "EZVIZ", 380_000, 460_000,
    "h1c.jpg", "CS-H1c", "1920 x 1080 (2MP), H.264",
    "2.8mm; ngang 91°, dọc 50°, chéo 108°", "Wi-Fi 2.4GHz; đàm thoại hai chiều",
    "Hồng ngoại đến 10m", "Type-C 5V/1A, tối đa 3W; microSD đến 512GB",
    "Phát hiện chuyển động, cảnh báo âm thanh và chế độ ngủ riêng tư.",
  ),
  camera(
    "EZ-H6CP-3MP", "EZVIZ H6C Pro 2K 3MP", "EZVIZ", 405_000, 490_000,
    "h6c.jpg", "CS-H6c-R105-1L3WF", "2304 x 1296 (3MP), H.264/H.265",
    "4mm F1.6; ngang 82°, dọc 48°, chéo 98°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "Xoay ngang 340°, dọc 55°; IR 10m, màu thông minh 5m", "Type-C 5V/1A, tối đa 5W; microSD đến 512GB",
    "Phát hiện người/tiếng động lớn, tuần tra, tự động theo dõi và nút gọi cảm ứng.",
  ),
  camera(
    "EZ-H6CP-5MP", "EZVIZ H6C Pro 3K 5MP", "EZVIZ", 489_000, 590_000,
    "h6c.jpg", "CS-H6c-R105-1J5WF", "2880 x 1620 (5MP), H.264/H.265",
    "4mm F1.6; ngang 87°, dọc 53°, chéo 104°", "Wi-Fi 2.4/5GHz, RJ45; đàm thoại hai chiều",
    "Xoay ngang 340°, dọc 55°; IR 10m, màu thông minh 5m", "Type-C 5V/2A, tối đa 8W; microSD đến 512GB",
    "Phát hiện người/tiếng động lớn, tuần tra, theo dõi có phóng to và nút gọi cảm ứng.",
  ),
  camera(
    "EZ-H6CG1-5MP", "EZVIZ H6C G1 3K 5MP", "EZVIZ", 495_000, 595_000,
    "h6c_g1.jpg", "CS-H6c-R200-1Q5WFL", "2880 x 1620 (5MP), H.264/H.265",
    "4mm F1.6; ngang 88°, dọc 46°, chéo 105°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "Xoay quét; IR 10m, màu thông minh", "Type-C 5V/2A, tối đa 8W; microSD đến 512GB",
    "Phát hiện người, tự động theo dõi, tuần tra và quan sát màu thông minh.",
  ),
  camera(
    "EZ-H6CG1-8MP", "EZVIZ H6C G1 4K 8MP", "EZVIZ", 625_000, 750_000,
    "h6c_g1.jpg", "CS-H6c-R200-8H8WFL", "3840 x 2160 (8MP/4K), H.264/H.265",
    "4mm F1.6; ngang 92°, dọc 51°, chéo 110°", "Wi-Fi 6 băng tần 2.4/5GHz, RJ45",
    "Xoay ngang 350°, dọc 85°; IR 10m", "Type-C 5V/2A, tối đa 8W; microSD đến 512GB",
    "Phát hiện người, thú cưng và tiếng động; theo dõi có phóng to, nút gọi và màn che riêng tư.",
  ),
  camera(
    "EZ-C6NP-3MP", "EZVIZ C6N Pro 2K 3MP", "EZVIZ", 405_000, 490_000,
    "c6n_pro.jpg", "CS-C6N-R105-1L3WF", "2304 x 1296 (3MP), H.264/H.265",
    "4mm F1.6; ngang 82°, dọc 48°, chéo 98°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "IR 10m; quan sát màu thông minh", "Type-C 5V/1A, tối đa 5W; microSD đến 512GB",
    "Phát hiện người/tiếng động lớn, theo dõi, tuần tra, nút gọi và chế độ riêng tư.",
  ),
  camera(
    "EZ-C6NG1-3MP", "EZVIZ C6N G1 2K 3MP", "EZVIZ", 430_000, 520_000,
    "c6n_g1.jpg", "CS-C6N-R200-1L3WFL", "2304 x 1296 (3MP), H.264/H.265",
    "4mm F2.0; ngang 83°, dọc 44°, chéo 98°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "Xoay ngang 350°, dọc 85°; IR 10m", "Type-C 5V/1A, tối đa 5W; microSD đến 512GB",
    "Phát hiện người/tiếng động, theo dõi, tuần tra và màn che riêng tư vật lý.",
  ),
  camera(
    "EZ-C60P-3P3", "EZVIZ C60p Dual Mix 2K (3MP+3MP)", "EZVIZ", 835_000, 1_000_000,
    "c60p.jpg", "CS-C60p-R100-8H33WF", "2 x 2304 x 1296 (3MP+3MP), H.264/H.265",
    "2 x 2.8mm F1.6; ngang 108°, dọc 103°", "Wi-Fi 6 băng tần 2.4/5GHz; đàm thoại hai chiều",
    "Xoay ngang 340°, dọc 96°; IR 10m", "Type-C 5V/2A, tối đa 8W; microSD đến 512GB",
    "Hai ống kính giảm điểm mù; phát hiện người, theo dõi, tuần tra và nút gọi cảm ứng.",
  ),
  camera(
    "EZ-H3C-3MP", "EZVIZ H3C 2K 3MP Color", "EZVIZ", 615_000, 740_000,
    "h3c.jpg", "CS-H3c-R100-1K3WKFL", "2304 x 1296 (3MP), H.264/H.265",
    "4mm F2.0; ngang 82°, chéo 98°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "IR 30m, hình màu; IP67", "12V/1A, tối đa 9W; microSD đến 512GB",
    "AI phát hiện người, cảnh báo chủ động bằng còi và đèn chớp.",
  ),
  camera(
    "EZ-H3C-4MP", "EZVIZ H3C 2K+ 4MP Color", "EZVIZ", 675_000, 810_000,
    "h3c_4mp.jpg", "CS-H3c-R100-1J4WKFL, bản 2.8mm", "2560 x 1440 (4MP), H.264/H.265",
    "2.8mm F2.0; ngang 100°, chéo 125°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "IR 30m, hình màu; IP67", "12V/1A, tối đa 9W; microSD đến 512GB",
    "AI phát hiện người, nhận biết vẫy tay, cảnh báo bằng còi và đèn.",
  ),
  camera(
    "EZ-H8CP-3MP", "EZVIZ H8C Pro 3MP", "EZVIZ", 730_000, 880_000,
    "h8c.jpg", "CS-H8c Pro (2K), bản 4mm", "2304 x 1296 (3MP), H.264/H.265",
    "4mm F1.6; ngang 89°, dọc 49°, chéo 104°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "Xoay ngang 350°, dọc 80°; IR 30m", "12V/1A, tối đa 12W; microSD đến 512GB",
    "Phát hiện người, tự động theo dõi, tuần tra, hình màu ban đêm và cảnh báo chủ động.",
  ),
  camera(
    "EZ-H8CP-5MP", "EZVIZ H8C Pro 3K 5MP", "EZVIZ", 875_000, 1_050_000,
    "h8c_family.jpg", "CS-H8c Pro (3K), bản 4mm", "2880 x 1620 (5MP), H.264/H.265",
    "4mm F1.6; ngang 91°, dọc 48°, chéo 108°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "Xoay ngang 350°, dọc 90°; IR 30m", "12V/1A; microSD đến 512GB",
    "AI phát hiện người/phương tiện, theo dõi, hình màu ban đêm và cảnh báo chủ động.",
  ),
  camera(
    "EZ-H8C-4G-3MP", "EZVIZ H8C 3MP 4G", "EZVIZ", 985_000, 1_180_000,
    "h8c_family.jpg", "CS-H8c-R200-1K3KFL4GA, bản 4mm", "2304 x 1296 (3MP), H.264/H.265",
    "4mm F1.6; ngang 86°, dọc 46°, chéo 102°", "SIM 4G LTE và RJ45; không dùng Wi-Fi",
    "Xoay ngang 350°, dọc 80°; IR 30m", "12V/1A; microSD đến 512GB",
    "Phát hiện người/phương tiện, tự động theo dõi, tuần tra và đàm thoại hai chiều.",
  ),
  camera(
    "EZ-H8C-POE-3MP", "EZVIZ H8C PoE 3MP", "EZVIZ", 735_000, 880_000,
    "h8c_family.jpg", "CS-H8c PoE (2K), bản 4mm", "2304 x 1296 (3MP), H.264/H.265",
    "4mm F1.6; ngang 89°, dọc 49°, chéo 104°", "RJ45 10/100Mbps, PoE; đàm thoại hai chiều",
    "Xoay ngang 350°, dọc 80°; IR 30m, hình màu 20m", "PoE hoặc 12V/1A, tối đa 12W; microSD 512GB",
    "Phát hiện người, theo dõi và cảnh báo chủ động; kết nối mạng dây PoE ổn định.",
  ),
  camera(
    "EZ-H8X-4MP", "EZVIZ H8X 2K+ 4MP", "EZVIZ", 1_475_000, 1_770_000,
    "h8x.png", "CS-H8x-R100-8H4WKFL", "2560 x 1440 (4MP), H.264/H.265",
    "4mm F1.0; ngang 92°, dọc 48°, chéo 108°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "Xoay ngang 340°, dọc 70°; ColorFULL Vision", "12V/1A; microSD đến 512GB",
    "Phát hiện người/phương tiện, theo dõi có phóng to, tuần tra và cảnh báo chủ động.",
  ),
  camera(
    "EZ-H9C-3P3", "EZVIZ H9C Dual 2K (3MP+3MP)", "EZVIZ", 1_235_000, 1_480_000,
    "h9c.jpg", "CS-H9c-R100-8H33WKFL", "2 x 2304 x 1296 (3MP+3MP), H.264/H.265",
    "Trên 2.8mm F1.6, ngang 108°; dưới 6mm F1.6, ngang 55°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "Xoay ngang 350°, dọc 80°; IR 30m, hình màu", "12V/1A; microSD đến 512GB",
    "Hai ống kính phối hợp phát hiện người/phương tiện, theo dõi liên kết và tuần tra.",
  ),
  camera(
    "EZ-H9C-5P5", "EZVIZ H9C Dual 3K (5MP+5MP)", "EZVIZ", 1_350_000, 1_620_000,
    "h9c.jpg", "CS-H9c-R100-8G55WKFL", "2 x 2880 x 1620 (5MP+5MP), H.264/H.265",
    "Trên 2.8mm F1.6, ngang 110°; dưới 6mm F1.6, ngang 56°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "Xoay ngang 350°, dọc 80°; IR 30m, hình màu đến 40m", "12V/1A; microSD đến 512GB",
    "Hai ống kính 5MP phối hợp phát hiện người/phương tiện, theo dõi liên kết và tuần tra.",
  ),
  camera(
    "EZ-H80X-8P2", "EZVIZ H80x Dual 4K (8MP+2MP)", "EZVIZ", 1_515_000, 1_820_000,
    "h80x.jpg", "CS-H80x-R100-8G82WKFL", "Ống chính 3840 x 2160 (8MP), ống phụ 1920 x 1080",
    "4K: 4mm F1.6; 2MP: 4mm F1.0; ngang 87°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "Xoay ngang 340°, dọc 70°; ColorFULL, IR 30m, IP65", "12V/1A, tối đa 12W; microSD đến 512GB",
    "Phát hiện người/phương tiện, theo dõi có phóng to, tuần tra và cảnh báo chủ động.",
  ),
  camera(
    "EZ-H90-4P4", "EZVIZ H90 Dual 2K+ (4MP+4MP)", "EZVIZ", 1_680_000, 2_020_000,
    "h90.jpg", "CS-H90-R100-8H44WKFL", "2 x 2560 x 1440 (4MP+4MP), H.264/H.265",
    "Trên 2.8mm F1.6, ngang 96°; dưới 6mm F1.6, ngang 52°", "Wi-Fi 2.4GHz, RJ45; đàm thoại hai chiều",
    "Hai cụm xoay độc lập; IR 30m, hình màu đến 40m", "12V/1A; microSD đến 512GB",
    "Hai ống kính xoay hai hướng, phát hiện người/phương tiện, theo dõi và tuần tra.",
  ),
  camera(
    "IM-A32EP-L-3MP", "IMOU IPC-A32EP-L 3MP", "IMOU", 415_000, 500_000,
    "a32.png", "IPC-A32EP-L", "2304 x 1296 (3MP), H.264/H.265",
    "3.6mm; ngang 83°, dọc 46°, chéo 100°", "Wi-Fi 2.4GHz; đàm thoại hai chiều",
    "Xoay ngang 355°, dọc -5° đến 80°; IR 10m", "5V/1A; microSD đến 256GB",
    "Phát hiện người/âm thanh bất thường, tự động theo dõi và chế độ riêng tư.",
  ),
  camera(
    "IM-F32FP-3MP", "IMOU IPC-F32FP 3MP", "IMOU", 655_000, 790_000,
    "f32.png", "IPC-F32FP, bản 2.8mm", "2304 x 1296 (3MP), H.264/H.265",
    "2.8mm; ngang 100°, dọc 54°, chéo 117°", "Wi-Fi 2.4GHz, RJ45; micro tích hợp",
    "Hồng ngoại đến 30m; IP67", "12V/1A; microSD đến 256GB",
    "Phát hiện người/chuyển động và vùng giám sát; chỉ thu âm, không đàm thoại hai chiều.",
  ),
  camera(
    "IM-K7FP-3MP", "IMOU IPC-K7FP-3H0WE 3MP", "IMOU", 735_000, 970_000,
    "k7.png", "IPC-K7FP-3H0WE", "2304 x 1296 (3MP), H.264/H.265",
    "3.6mm; ngang 82°, dọc 44°, chéo 104°", "Wi-Fi 6, RJ45; đàm thoại hai chiều",
    "Xoay ngang 355°, dọc 0°-90°; IR 30m, IP66", "12V/0.5A, dưới 6W; microSD đến 512GB",
    "Phát hiện người, tự động theo dõi, đèn trợ sáng và còi báo động 110dB.",
  ),
  {
    sku: "MEM-HIK-32GB",
    name: "Thẻ nhớ camera 32GB chính hãng chuyên dụng",
    brand: "Hikvision",
    category: "Thẻ nhớ",
    costPrice: 195_000,
    retailPrice: 250_000,
    description: "Thẻ nhớ chuyên dụng cho camera, dùng ghi hình liên tục hoặc theo sự kiện; bảo hành 24 tháng.",
    specs: {
      "Dung lượng": ["32GB"],
      "Loại sử dụng": ["Camera giám sát"],
      "Bảo hành": ["24 tháng"],
    },
  },
  {
    sku: "MEM-IMOU-64GB",
    name: "Thẻ nhớ camera 64GB chính hãng chuyên dụng",
    brand: "IMOU",
    category: "Thẻ nhớ",
    costPrice: 250_000,
    retailPrice: 300_000,
    description: "Thẻ nhớ chuyên dụng cho camera, dùng ghi hình liên tục hoặc theo sự kiện; bảo hành 24 tháng.",
    specs: {
      "Dung lượng": ["64GB"],
      "Loại sử dụng": ["Camera giám sát"],
      "Bảo hành": ["24 tháng"],
    },
  },
  {
    sku: "MEM-KIOXIA-128GB",
    name: "Thẻ nhớ Kioxia 128GB MicroSD",
    brand: "Kioxia",
    category: "Thẻ nhớ",
    costPrice: 0,
    retailPrice: 445_000,
    description: "Thẻ nhớ MicroSD Kioxia dung lượng 128GB.",
    warrantyMonths: 0,
    specs: {
      "Dung lượng": ["128GB"],
      "Chuẩn thẻ": ["MicroSD"],
      "Thương hiệu": ["Kioxia"],
    },
  },
  {
    sku: "MEM-LEXAR-512GB-LSDMI512BB633A",
    name: "Thẻ nhớ Lexar 512GB MicroSD - Thẻ xanh",
    brand: "Lexar",
    category: "Thẻ nhớ",
    costPrice: 0,
    retailPrice: 1_100_000,
    description: "Thẻ nhớ MicroSD Lexar dung lượng 512GB, phiên bản thẻ xanh.",
    warrantyMonths: 0,
    specs: {
      "Mã sản phẩm": ["LSDMI512BB633A"],
      "Dung lượng": ["512GB"],
      "Chuẩn thẻ": ["MicroSD"],
      "Phiên bản": ["Thẻ xanh"],
      "Thương hiệu": ["Lexar"],
    },
  },
  {
    sku: "SVC-CAM-INSTALL-200",
    name: "Công lắp đặt camera - cơ bản",
    category: "Dịch Vụ",
    costPrice: 0,
    retailPrice: 200_000,
    description: "Lắp camera tại vị trí cơ bản, cấu hình ứng dụng và hướng dẫn sử dụng.",
    specs: { "Loại dịch vụ": ["Lắp đặt camera"], "Mức công": ["Cơ bản"] },
  },
  {
    sku: "SVC-CAM-INSTALL-250",
    name: "Công lắp đặt camera - ngoài trời cố định",
    category: "Dịch Vụ",
    costPrice: 0,
    retailPrice: 250_000,
    description: "Lắp camera ngoài trời cố định, cấu hình ứng dụng và căn chỉnh góc quan sát.",
    specs: { "Loại dịch vụ": ["Lắp đặt camera"], "Mức công": ["Ngoài trời cố định"] },
  },
  {
    sku: "SVC-CAM-INSTALL-300",
    name: "Công lắp đặt camera - ngoài trời xoay quét",
    category: "Dịch Vụ",
    costPrice: 0,
    retailPrice: 300_000,
    description: "Lắp camera ngoài trời xoay quét, cấu hình ứng dụng và kiểm tra vùng theo dõi.",
    specs: { "Loại dịch vụ": ["Lắp đặt camera"], "Mức công": ["Ngoài trời xoay quét"] },
  },
  {
    sku: "MAT-CAM-BASIC-50",
    name: "Vật tư lắp camera - cơ bản",
    category: "Dịch Vụ",
    costPrice: 0,
    retailPrice: 50_000,
    description: "Vật tư cơ bản cho một điểm camera trong nhà.",
    specs: { "Loại chi phí": ["Vật tư camera"], "Mức": ["Cơ bản"] },
  },
  {
    sku: "MAT-CAM-OUT-80",
    name: "Vật tư lắp camera - ngoài trời cố định",
    category: "Dịch Vụ",
    costPrice: 0,
    retailPrice: 80_000,
    description: "Vật tư cơ bản cho một điểm camera ngoài trời cố định.",
    specs: { "Loại chi phí": ["Vật tư camera"], "Mức": ["Ngoài trời cố định"] },
  },
  {
    sku: "MAT-CAM-PTZ-100",
    name: "Vật tư lắp camera - ngoài trời xoay quét",
    category: "Dịch Vụ",
    costPrice: 0,
    retailPrice: 100_000,
    description: "Vật tư cơ bản cho một điểm camera ngoài trời xoay quét.",
    specs: { "Loại chi phí": ["Vật tư camera"], "Mức": ["Ngoài trời xoay quét"] },
  },
];

function productImageUrl(fileName: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!supabaseUrl) {
    throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL để tạo URL ảnh sản phẩm.");
  }
  return `${supabaseUrl}/storage/v1/object/public/products/camera-catalog/${encodeURIComponent(fileName)}`;
}

async function findOrCreateCategory(name: CatalogProduct["category"]) {
  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(categories)
    .values({ name })
    .returning({ id: categories.id });
  return created.id;
}

async function main() {
  const categoryIds = {
    "Camera giám sát": await findOrCreateCategory("Camera giám sát"),
    "Thẻ nhớ": await findOrCreateCategory("Thẻ nhớ"),
    "Dịch Vụ": await findOrCreateCategory("Dịch Vụ"),
  } as const;

  await db
    .insert(brands)
    .values(["EZVIZ", "IMOU", "Hikvision", "Kioxia", "Lexar"].map((name) => ({ name })))
    .onConflictDoNothing({ target: brands.name });

  const brandRows = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(inArray(brands.name, ["EZVIZ", "IMOU", "Hikvision", "Kioxia", "Lexar"]));
  const brandIds = new Map(brandRows.map((row) => [row.name, row.id]));

  await db.transaction(async (tx) => {
    for (const item of catalog) {
      const values = {
        sku: item.sku,
        name: item.name,
        fullName: item.name,
        description: item.description,
        categoryId: categoryIds[item.category],
        brandId: item.brand ? (brandIds.get(item.brand) ?? null) : null,
        baseUnit: item.category === "Dịch Vụ" ? "điểm" : "cái",
        costPrice: String(item.costPrice),
        lastPurchasePrice: String(item.costPrice),
        retailPrice: String(item.retailPrice),
        specs: item.specs,
        warrantyMonths: item.warrantyMonths ?? 24,
        imageUrls: item.image ? [productImageUrl(item.image)] : [],
        lifecycleStatus: "active",
        isActive: true,
        updatedAt: new Date(),
      } as const;

      await tx
        .insert(products)
        .values(values)
        .onConflictDoUpdate({
          target: products.sku,
          set: values,
        });
    }
  });

  const seeded = await db
    .select({
      sku: products.sku,
      name: products.name,
      costPrice: products.costPrice,
      retailPrice: products.retailPrice,
      imageUrls: products.imageUrls,
    })
    .from(products)
    .where(inArray(products.sku, catalog.map((item) => item.sku)));

  if (seeded.length !== catalog.length) {
    throw new Error(`Seed không đủ: cần ${catalog.length}, thực tế ${seeded.length}`);
  }

  console.log(`Đã đồng bộ ${seeded.length} sản phẩm camera/thẻ nhớ.`);
  console.table(
    seeded
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((row) => ({
        SKU: row.sku,
        "Sản phẩm": row.name,
        "Giá vốn": row.costPrice,
        "Giá bán": row.retailPrice,
        Ảnh: Array.isArray(row.imageUrls) && row.imageUrls.length > 0 ? "Có" : "-",
      })),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
