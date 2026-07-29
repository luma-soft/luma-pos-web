import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { brands, categories, products } from "../db/schema";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

type CatalogItem = {
  sku: string;
  name: string;
  fullName: string;
  costPrice: number;
  retailPrice: number;
  description: string;
  specs: Record<string, string[]>;
  imageSource: string;
  sourceQuantity: number;
};

const BRAND = "Hunonic";
const CATEGORY = "Thiết bị điện thông minh";
const WARRANTY_MONTHS = 12;

const daticSpecs = (
  sku: string,
  buttonCount: number,
  color: "Đen" | "Trắng",
): Record<string, string[]> => ({
  "Mã sản phẩm": [sku],
  "Dòng sản phẩm": ["Hunonic Datic All New"],
  "Số nút": [`${buttonCount} nút`],
  "Màu sắc": [color],
  "Kết nối": ["Wi-Fi 2.4GHz / Bluetooth Mesh"],
  "Điện áp hoạt động": ["90-240VAC / 50Hz"],
  "Công suất tải": ["Tối đa 500W/kênh"],
  "Nhiệt độ làm việc": ["0-80°C"],
  "Tiêu chuẩn chống nước": ["IP40"],
  "Chất liệu": ["Mặt kính cường lực, đế nhựa ABS chống cháy"],
  "Kích thước": ["120 × 72 × 32mm"],
  "Tính năng": [
    "Điều khiển từ xa qua ứng dụng Hunonic",
    "Hẹn giờ tự động",
    "Điều khiển giọng nói",
    "Tạo ngữ cảnh và chia sẻ thiết bị",
  ],
  "Bảo hành": ["12 tháng"],
});

const daticSwitches: CatalogItem[] = [
  {
    sku: "HNSW01D",
    name: "Công tắc cảm ứng Wi-Fi Hunonic Datic 1 nút màu đen",
    fullName: "Công tắc cảm ứng Wi-Fi Hunonic Datic All New 1 nút màu đen",
    costPrice: 280_000,
    retailPrice: 375_000,
    description:
      "Công tắc cảm ứng Hunonic Datic All New 1 nút, mặt kính cường lực màu đen; điều khiển cảm ứng hoặc từ xa qua ứng dụng Hunonic, hỗ trợ hẹn giờ và ngữ cảnh thông minh.",
    specs: daticSpecs("HNSW01D", 1, "Đen"),
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/11/wifi-hunonic-datic-1-den.jpg",
    sourceQuantity: 3,
  },
  {
    sku: "HNSW01T",
    name: "Công tắc cảm ứng Wi-Fi Hunonic Datic 1 nút màu trắng",
    fullName: "Công tắc cảm ứng Wi-Fi Hunonic Datic All New 1 nút màu trắng",
    costPrice: 280_000,
    retailPrice: 375_000,
    description:
      "Công tắc cảm ứng Hunonic Datic All New 1 nút, mặt kính cường lực màu trắng; điều khiển cảm ứng hoặc từ xa qua ứng dụng Hunonic, hỗ trợ hẹn giờ và ngữ cảnh thông minh.",
    specs: daticSpecs("HNSW01T", 1, "Trắng"),
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/11/wifi-hunonic-datic-1-trang.jpg",
    sourceQuantity: 3,
  },
  {
    sku: "HNSW02D",
    name: "Công tắc cảm ứng Wi-Fi Hunonic Datic 2 nút màu đen",
    fullName: "Công tắc cảm ứng Wi-Fi Hunonic Datic All New 2 nút màu đen",
    costPrice: 300_000,
    retailPrice: 395_000,
    description:
      "Công tắc cảm ứng Hunonic Datic All New 2 nút, mặt kính cường lực màu đen; điều khiển cảm ứng hoặc từ xa qua ứng dụng Hunonic, hỗ trợ hẹn giờ và ngữ cảnh thông minh.",
    specs: daticSpecs("HNSW02D", 2, "Đen"),
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/11/wifi-hunonic-datic-2-den.jpg",
    sourceQuantity: 8,
  },
  {
    sku: "HNSW02T",
    name: "Công tắc cảm ứng Wi-Fi Hunonic Datic 2 nút màu trắng",
    fullName: "Công tắc cảm ứng Wi-Fi Hunonic Datic All New 2 nút màu trắng",
    costPrice: 300_000,
    retailPrice: 395_000,
    description:
      "Công tắc cảm ứng Hunonic Datic All New 2 nút, mặt kính cường lực màu trắng; điều khiển cảm ứng hoặc từ xa qua ứng dụng Hunonic, hỗ trợ hẹn giờ và ngữ cảnh thông minh.",
    specs: daticSpecs("HNSW02T", 2, "Trắng"),
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/11/wifi-hunonic-datic-2-trang.jpg",
    sourceQuantity: 4,
  },
  {
    sku: "HNSW03T",
    name: "Công tắc cảm ứng Wi-Fi Hunonic Datic 3 nút màu trắng",
    fullName: "Công tắc cảm ứng Wi-Fi Hunonic Datic All New 3 nút màu trắng",
    costPrice: 325_000,
    retailPrice: 410_000,
    description:
      "Công tắc cảm ứng Hunonic Datic All New 3 nút, mặt kính cường lực màu trắng; điều khiển cảm ứng hoặc từ xa qua ứng dụng Hunonic, hỗ trợ hẹn giờ và ngữ cảnh thông minh.",
    specs: daticSpecs("HNSW03T", 3, "Trắng"),
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/11/wifi-hunonic-datic-3-trang.jpg",
    sourceQuantity: 4,
  },
  {
    sku: "HNSW03D",
    name: "Công tắc cảm ứng Wi-Fi Hunonic Datic 3 nút màu đen",
    fullName: "Công tắc cảm ứng Wi-Fi Hunonic Datic All New 3 nút màu đen",
    costPrice: 325_000,
    retailPrice: 410_000,
    description:
      "Công tắc cảm ứng Hunonic Datic All New 3 nút, mặt kính cường lực màu đen; điều khiển cảm ứng hoặc từ xa qua ứng dụng Hunonic, hỗ trợ hẹn giờ và ngữ cảnh thông minh.",
    specs: daticSpecs("HNSW03D", 3, "Đen"),
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/11/wifi-hunonic-datic-3-den.jpg",
    sourceQuantity: 5,
  },
  {
    sku: "HNSW04D",
    name: "Công tắc cảm ứng Wi-Fi Hunonic Datic 4 nút màu đen",
    fullName: "Công tắc cảm ứng Wi-Fi Hunonic Datic All New 4 nút màu đen",
    costPrice: 350_000,
    retailPrice: 465_000,
    description:
      "Công tắc cảm ứng Hunonic Datic All New 4 nút, mặt kính cường lực màu đen; điều khiển cảm ứng hoặc từ xa qua ứng dụng Hunonic, hỗ trợ hẹn giờ và ngữ cảnh thông minh.",
    specs: daticSpecs("HNSW04D", 4, "Đen"),
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/11/wifi-hunonic-datic-4-den.jpg",
    sourceQuantity: 10,
  },
  {
    sku: "HNSW04T",
    name: "Công tắc cảm ứng Wi-Fi Hunonic Datic 4 nút màu trắng",
    fullName: "Công tắc cảm ứng Wi-Fi Hunonic Datic All New 4 nút màu trắng",
    costPrice: 350_000,
    retailPrice: 465_000,
    description:
      "Công tắc cảm ứng Hunonic Datic All New 4 nút, mặt kính cường lực màu trắng; điều khiển cảm ứng hoặc từ xa qua ứng dụng Hunonic, hỗ trợ hẹn giờ và ngữ cảnh thông minh.",
    specs: daticSpecs("HNSW04T", 4, "Trắng"),
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/11/wifi-hunonic-datic-4-trang.jpg",
    sourceQuantity: 6,
  },
];

const safetySwitchSpecs = (
  sku: string,
  color: "Đen" | "Trắng",
): Record<string, string[]> => ({
  "Mã sản phẩm": [sku],
  "Dòng sản phẩm": ["Hunonic Datic CSL chống giật"],
  "Số nút": ["1 nút"],
  "Màu sắc": [color],
  "Kết nối": ["Wi-Fi 2.4GHz / Bluetooth Mesh"],
  "Điện áp hoạt động": ["90-250VAC / 50-60Hz"],
  "Công suất tải": ["Tối đa 3000W"],
  "Ngưỡng phát hiện dòng rò": ["15mA"],
  "Kích thước": ["120 × 72 × 32mm"],
  "Tính năng": [
    "Tự động ngắt khi phát hiện dòng rò",
    "Cảnh báo lập tức về điện thoại",
    "Điều khiển từ xa và hẹn giờ",
    "Điều khiển giọng nói",
  ],
  "Bảo hành": ["12 tháng"],
});

const linkedBathroomSpecs = (
  sku: string,
  color: "Đen" | "Trắng",
): Record<string, string[]> => ({
  ...daticSpecs(sku, 3, color),
  "Dòng sản phẩm": ["Hunonic Datic 3 nút liên kết nhà vệ sinh (CSL)"],
  "Ứng dụng": [
    "Liên kết đèn, quạt thông gió và thiết bị nhà vệ sinh",
    "Điều khiển từng kênh bằng cảm ứng hoặc ứng dụng Hunonic",
  ],
});

const catalog: CatalogItem[] = [
  ...daticSwitches,
  {
    sku: "HNSWU1D",
    name: "Công tắc chống giật Wi-Fi Hunonic Datic CSL màu đen",
    fullName:
      "Công tắc cảm ứng chống giật Wi-Fi Hunonic Datic CSL 3000W màu đen",
    costPrice: 390_000,
    retailPrice: 535_000,
    description:
      "Công tắc bình nóng lạnh thông minh Hunonic Datic CSL màu đen, phát hiện dòng rò 15mA, tự động ngắt và gửi cảnh báo về điện thoại; công suất tải tối đa 3000W.",
    specs: safetySwitchSpecs("HNSWU1D", "Đen"),
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/11/wifi-hunonic-datic-chong-giat-den.jpg",
    sourceQuantity: 6,
  },
  {
    sku: "HNSWU1T",
    name: "Công tắc chống giật Wi-Fi Hunonic Datic CSL màu trắng",
    fullName:
      "Công tắc cảm ứng chống giật Wi-Fi Hunonic Datic CSL 3000W màu trắng",
    costPrice: 390_000,
    retailPrice: 535_000,
    description:
      "Công tắc bình nóng lạnh thông minh Hunonic Datic CSL màu trắng, phát hiện dòng rò 15mA, tự động ngắt và gửi cảnh báo về điện thoại; công suất tải tối đa 3000W.",
    specs: safetySwitchSpecs("HNSWU1T", "Trắng"),
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/11/wifi-hunonic-datic-chong-giat-trang-1.jpg",
    sourceQuantity: 10,
  },
  {
    sku: "HN-DOOR-S-T",
    name: "Công tắc cửa cuốn Wi-Fi Hunonic Door S màu trắng",
    fullName:
      "Công tắc cửa cuốn thông minh Wi-Fi Hunonic Door S màu trắng",
    costPrice: 495_000,
    retailPrice: 815_000,
    description:
      "Công tắc cửa cuốn Hunonic Door S màu trắng, điều khiển bằng cảm ứng hoặc ứng dụng Hunonic; hỗ trợ hẹn giờ, chia sẻ người dùng, thông báo trạng thái và remote RF.",
    specs: {
      "Dòng sản phẩm": ["Hunonic Door S"],
      "Màu sắc": ["Trắng"],
      "Kết nối": ["Wi-Fi 2.4GHz / Bluetooth"],
      "Điện áp hoạt động": ["90-240VAC / 50Hz"],
      "Công suất tải": ["1500W/kênh; phiên bản CSL tối đa 3000W"],
      "Nhiệt độ làm việc": ["0-80°C"],
      "Tiêu chuẩn chống nước": ["IP40"],
      "Điều khiển": ["Cảm ứng, ứng dụng Hunonic, remote RF"],
      "Chất liệu": ["Mặt kính cường lực, đế nhựa ABS chống cháy"],
      "Kích thước": ["120 × 72 × 32mm"],
      "Bảo hành": ["12 tháng"],
    },
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/08/hunonic-door-s.jpg",
    sourceQuantity: 3,
  },
  {
    sku: "HN-DOOR-S-D",
    name: "Công tắc cửa cuốn Wi-Fi Hunonic Door S màu đen",
    fullName:
      "Công tắc cửa cuốn thông minh Wi-Fi Hunonic Door S màu đen",
    costPrice: 495_000,
    retailPrice: 815_000,
    description:
      "Công tắc cửa cuốn Hunonic Door S màu đen, điều khiển bằng cảm ứng hoặc ứng dụng Hunonic; hỗ trợ hẹn giờ, chia sẻ người dùng, thông báo trạng thái và remote RF.",
    specs: {
      "Dòng sản phẩm": ["Hunonic Door S"],
      "Màu sắc": ["Đen"],
      "Kết nối": ["Wi-Fi 2.4GHz / Bluetooth"],
      "Điện áp hoạt động": ["90-240VAC / 50Hz"],
      "Công suất tải": ["1500W/kênh; phiên bản CSL tối đa 3000W"],
      "Nhiệt độ làm việc": ["0-80°C"],
      "Tiêu chuẩn chống nước": ["IP40"],
      "Điều khiển": ["Cảm ứng, ứng dụng Hunonic, remote RF"],
      "Chất liệu": ["Mặt kính cường lực, đế nhựa ABS chống cháy"],
      "Kích thước": ["120 × 72 × 32mm"],
      "Bảo hành": ["12 tháng"],
    },
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/08/hunonic-door-s.jpg",
    sourceQuantity: 4,
  },
  {
    sku: "HN-ENTEC",
    name: "Bộ kiểm soát điện năng thông minh Wi-Fi Hunonic Entec",
    fullName:
      "Công tơ điện thông minh Wi-Fi Hunonic Entec 63A có màn hình LCD",
    costPrice: 340_000,
    retailPrice: 455_000,
    description:
      "Hunonic Entec giám sát điện năng tiêu thụ theo thời gian thực, hiển thị trên màn hình LCD và ứng dụng Hunonic; hỗ trợ biểu đồ, cảnh báo quá tải và theo dõi điện mặt trời hòa lưới.",
    specs: {
      "Dòng sản phẩm": ["Hunonic Entec"],
      "Kết nối": ["Wi-Fi 2.4GHz b/g/n"],
      "Điện áp hoạt động": ["220-250VAC / 50Hz"],
      "Dòng điện tối đa": ["5(63)A"],
      "Màn hình LCD": ["U, I, P, mA, kWh"],
      "Chức năng": [
        "Đo điện năng theo thời gian thực",
        "Biểu đồ tiêu thụ",
        "Cảnh báo quá tải",
        "Theo dõi điện mặt trời hòa lưới",
      ],
      "Chất liệu": ["Nhựa ABS chống cháy"],
      "Kích thước": ["93 × 36 × 65mm"],
      "Bảo hành": ["12 tháng"],
    },
    imageSource:
      "https://hunonic.com/wp-content/uploads/2025/03/bo-kiem-soat-dien-nang-entec.jpg",
    sourceQuantity: 3,
  },
  {
    sku: "DATIC-DOOR-T",
    name: "Công tắc cửa cuốn Wi-Fi Hunonic Datic Smart Door màu trắng",
    fullName:
      "Công tắc cửa cuốn Wi-Fi Hunonic Datic Smart Door viền cam màu trắng",
    costPrice: 435_000,
    retailPrice: 625_000,
    description:
      "Công tắc cửa cuốn Datic Smart Door màu trắng, điều khiển qua Wi-Fi bằng ứng dụng Hunonic hoặc remote RF; hỗ trợ thông báo trạng thái, hẹn giờ và chia sẻ nhiều người dùng.",
    specs: {
      "Mã sản phẩm": ["DATIC-DOOR-T"],
      "Dòng sản phẩm": ["Hunonic Datic Smart Door"],
      "Màu sắc": ["Trắng, viền cam"],
      "Kết nối": ["Wi-Fi 2.4GHz / Bluetooth"],
      "Điện áp hoạt động": ["90-240VAC / 50Hz"],
      "Công suất tải": ["1500W/kênh"],
      "Nhiệt độ làm việc": ["0-80°C"],
      "Tiêu chuẩn chống nước": ["IP40"],
      "Điều khiển": ["Cảm ứng, ứng dụng Hunonic, remote RF"],
      "Chất liệu": ["Mặt kính cường lực, đế nhựa ABS chống cháy"],
      "Kích thước": ["120 × 72 × 32mm"],
      "Bảo hành": ["12 tháng"],
    },
    imageSource:
      "https://hunonic.com/wp-content/uploads/2022/09/cong-tac-cua-cuon-datic-smart-door-mau-trang-1.jpg",
    sourceQuantity: 4,
  },
  {
    sku: "DATIC-DOOR-D",
    name: "Công tắc cửa cuốn Wi-Fi Hunonic Datic Smart Door màu đen",
    fullName:
      "Công tắc cửa cuốn Wi-Fi Hunonic Datic Smart Door viền cam màu đen",
    costPrice: 435_000,
    retailPrice: 625_000,
    description:
      "Công tắc cửa cuốn Datic Smart Door màu đen, điều khiển qua Wi-Fi bằng ứng dụng Hunonic hoặc remote RF; hỗ trợ thông báo trạng thái, hẹn giờ và chia sẻ nhiều người dùng.",
    specs: {
      "Mã sản phẩm": ["DATIC-DOOR-D"],
      "Dòng sản phẩm": ["Hunonic Datic Smart Door"],
      "Màu sắc": ["Đen, viền cam"],
      "Kết nối": ["Wi-Fi 2.4GHz / Bluetooth"],
      "Điện áp hoạt động": ["90-240VAC / 50Hz"],
      "Công suất tải": ["1500W/kênh"],
      "Nhiệt độ làm việc": ["0-80°C"],
      "Tiêu chuẩn chống nước": ["IP40"],
      "Điều khiển": ["Cảm ứng, ứng dụng Hunonic, remote RF"],
      "Chất liệu": ["Mặt kính cường lực, đế nhựa ABS chống cháy"],
      "Kích thước": ["120 × 72 × 32mm"],
      "Bảo hành": ["12 tháng"],
    },
    imageSource:
      "https://hunonic.com/wp-content/uploads/2022/09/cong-tac-cua-cuon-datic-smart-door-mau-den-1.jpg",
    sourceQuantity: 3,
  },
  {
    sku: "HNSWP3T",
    name: "Công tắc Wi-Fi Hunonic Datic 3 nút CSL màu trắng",
    fullName:
      "Công tắc cảm ứng Wi-Fi Hunonic Datic 3 nút liên kết nhà vệ sinh (CSL) màu trắng",
    costPrice: 370_000,
    retailPrice: 535_000,
    description:
      "Công tắc cảm ứng Wi-Fi Hunonic Datic 3 nút CSL màu trắng, thiết kế cho cụm thiết bị nhà vệ sinh; hỗ trợ điều khiển đèn, quạt thông gió và thiết bị điện qua ứng dụng Hunonic.",
    specs: linkedBathroomSpecs("HNSWP3T", "Trắng"),
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/11/wifi-hunonic-datic-csl-trang.jpg",
    sourceQuantity: 6,
  },
  {
    sku: "SK01",
    name: "Ổ cắm thông minh Wi-Fi Hunonic SK01",
    fullName: "Ổ cắm thông minh Wi-Fi Hunonic SK01 công suất 4000W",
    costPrice: 290_000,
    retailPrice: 360_000,
    description:
      "Ổ cắm thông minh Hunonic SK01 biến thiết bị điện thông thường thành thiết bị điều khiển từ xa; hỗ trợ hẹn giờ, điều khiển giọng nói và chia sẻ cho nhiều người dùng.",
    specs: {
      "Mã sản phẩm": ["SK01"],
      "Kết nối": ["Wi-Fi 2.4GHz"],
      "Điện áp hoạt động": ["90-240VAC / 50Hz"],
      "Công suất tối đa": ["4000W"],
      "Kích thước": ["70 × 45 × 23mm"],
      "Tính năng": [
        "Điều khiển từ xa",
        "Hẹn giờ bật/tắt",
        "Chia sẻ nhiều người dùng",
        "Điều khiển giọng nói",
      ],
      "Bảo hành": ["12 tháng"],
    },
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/03/O-CAM-THONG-MINH-HUNONIC-SK01.jpg",
    sourceQuantity: 6,
  },
  {
    sku: "HNIR",
    name: "Bộ điều khiển hồng ngoại Wi-Fi Hunonic IR Smart",
    fullName:
      "Bộ điều khiển hồng ngoại Wi-Fi Hunonic IR Smart cho TV, điều hòa và quạt",
    costPrice: 185_000,
    retailPrice: 238_000,
    description:
      "Hunonic IR Smart thay thế remote hồng ngoại để điều khiển TV, điều hòa, quạt và thiết bị gia dụng tương thích từ xa qua ứng dụng Hunonic.",
    specs: {
      "Mã sản phẩm": ["HNIR"],
      "Kết nối": ["Wi-Fi 2.4GHz"],
      "Nguồn điện": ["5V / 1A qua cổng USB Type-C"],
      "Điều khiển": ["Hồng ngoại IR qua ứng dụng Hunonic"],
      "Thiết bị tương thích": ["TV, điều hòa, quạt và thiết bị dùng remote IR"],
      "Tính năng": [
        "Điều khiển từ xa",
        "Hẹn giờ",
        "Tạo ngữ cảnh thông minh",
      ],
      "Bảo hành": ["12 tháng"],
    },
    imageSource:
      "https://hunonic.com/wp-content/uploads/2021/03/bo-dieu-khien-tivi-dieu-hoa-tu-xa-bang-dien-thoai-hunonic-ir-smart-4.jpg",
    sourceQuantity: 3,
  },
  {
    sku: "HNCT01",
    name: "Thiết bị chống trộm và báo khách Wi-Fi Hunonic CT01",
    fullName:
      "Thiết bị chống trộm và báo khách đa năng Wi-Fi Hunonic CT01",
    costPrice: 360_000,
    retailPrice: 495_000,
    description:
      "Hunonic CT01 kết hợp cảm biến hồng ngoại và còi báo động; hỗ trợ chế độ chống trộm, báo khách, cảnh báo tại chỗ và gửi thông báo về điện thoại.",
    specs: {
      "Mã sản phẩm": ["HNCT01"],
      "Kết nối": ["Wi-Fi 2.4GHz"],
      "Điện áp hoạt động": ["90-240VAC / 50Hz"],
      "Cảm biến": ["Hồng ngoại phát hiện chuyển động"],
      "Âm lượng báo động": ["115dB"],
      "Chế độ": ["Chống trộm, báo khách, báo động tại chỗ"],
      "Chất liệu": ["Nhựa ABS chống cháy"],
      "Kích thước": ["72 × 56.5 × 68mm"],
      "Bảo hành": ["12 tháng"],
    },
    imageSource:
      "https://hunonic.com/wp-content/uploads/2023/08/thiet-bi-chong-trom-va-bao-khach-1.jpg",
    sourceQuantity: 5,
  },
  {
    sku: "HN-HOME-SERVER",
    name: "Bộ điều khiển trung tâm Hunonic Home Server",
    fullName:
      "Bộ điều khiển trung tâm Bluetooth Mesh Hunonic Home Server",
    costPrice: 440_000,
    retailPrice: 850_000,
    description:
      "Hunonic Home Server kết nối và điều phối các thiết bị Bluetooth Mesh trong hệ thống nhà thông minh; lưu ngữ cảnh, lịch hẹn giờ và cho phép hệ thống hoạt động nội bộ khi mất Internet.",
    specs: {
      "Dòng sản phẩm": ["Hunonic Home Server"],
      "Kết nối": ["Bluetooth Mesh"],
      "Nguồn điện": ["5V qua cổng USB Type-C"],
      "Chất liệu": ["Nhựa ABS nguyên sinh"],
      "Kích thước": ["100 × 100mm"],
      "Tính năng": [
        "Kết nối thiết bị Bluetooth Mesh",
        "Lưu ngữ cảnh và lịch hẹn giờ",
        "Hoạt động nội bộ khi mất Internet",
      ],
      "Bảo hành": ["12 tháng"],
    },
    imageSource:
      "https://hunonic.com/wp-content/uploads/2021/09/bo-dieu-khien-trung-tam-hunonic-home-server-1-1.jpg",
    sourceQuantity: 1,
  },
  {
    sku: "HNSWP3D",
    name: "Công tắc Wi-Fi Hunonic Datic 3 nút CSL màu đen",
    fullName:
      "Công tắc cảm ứng Wi-Fi Hunonic Datic 3 nút liên kết nhà vệ sinh (CSL) màu đen",
    costPrice: 370_000,
    retailPrice: 535_000,
    description:
      "Công tắc cảm ứng Wi-Fi Hunonic Datic 3 nút CSL màu đen, thiết kế cho cụm thiết bị nhà vệ sinh; hỗ trợ điều khiển đèn, quạt thông gió và thiết bị điện qua ứng dụng Hunonic.",
    specs: linkedBathroomSpecs("HNSWP3D", "Đen"),
    imageSource:
      "https://hunonic.com/wp-content/uploads/2024/11/wifi-hunonic-datic-csl-den.jpg",
    sourceQuantity: 8,
  },
];

async function findOrCreateCategory() {
  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, CATEGORY))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(categories)
    .values({ name: CATEGORY })
    .returning({ id: categories.id });
  return created.id;
}

async function uploadProductImages() {
  const supabase = createSupabaseAdminClient();
  const urls = new Map<string, string>();

  for (const item of catalog) {
    const response = await fetch(item.imageSource);
    if (!response.ok) {
      throw new Error(`Không tải được ảnh ${item.sku}: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (!contentType?.startsWith("image/")) {
      throw new Error(`Nguồn ảnh ${item.sku} trả về ${contentType ?? "không rõ"}`);
    }

    const path = `catalog-2026-07/hunonic/${item.sku.toLowerCase()}.jpg`;
    const { error } = await supabase.storage
      .from("products")
      .upload(path, await response.arrayBuffer(), {
        contentType,
        upsert: true,
      });
    if (error) {
      throw new Error(`Không tải được ảnh ${item.sku} lên Storage: ${error.message}`);
    }

    const { data } = supabase.storage.from("products").getPublicUrl(path);
    urls.set(item.sku, data.publicUrl);
  }

  return urls;
}

async function main() {
  if (catalog.length !== 21) {
    throw new Error(`Danh sách phải có 21 sản phẩm, hiện có ${catalog.length}`);
  }
  for (const item of catalog) {
    if (item.retailPrice <= item.costPrice) {
      throw new Error(`Giá bán không cao hơn giá nhập: ${item.sku}`);
    }
  }

  const [categoryId, imageUrls] = await Promise.all([
    findOrCreateCategory(),
    uploadProductImages(),
  ]);

  await db
    .insert(brands)
    .values({ name: BRAND })
    .onConflictDoNothing({ target: brands.name });
  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.name, BRAND))
    .limit(1);
  if (!brand) throw new Error(`Không tạo được thương hiệu ${BRAND}`);

  await db.transaction(async (tx) => {
    for (const item of catalog) {
      const values = {
        name: item.name,
        fullName: item.fullName,
        description: item.description,
        categoryId,
        brandId: brand.id,
        baseUnit: "bộ",
        costPrice: String(item.costPrice),
        lastPurchasePrice: String(item.costPrice),
        retailPrice: String(item.retailPrice),
        specs: item.specs,
        warrantyMonths: WARRANTY_MONTHS,
        imageUrls: [imageUrls.get(item.sku)!],
        lifecycleStatus: "active",
        isActive: true,
        updatedAt: sql`now()`,
      };

      await tx
        .insert(products)
        .values({ sku: item.sku, ...values })
        .onConflictDoUpdate({
          target: products.sku,
          set: values,
        });
    }
  });

  const saved = await db
    .select({
      sku: products.sku,
      name: products.name,
      costPrice: products.costPrice,
      retailPrice: products.retailPrice,
      imageUrls: products.imageUrls,
      specs: products.specs,
    })
    .from(products)
    .where(inArray(products.sku, catalog.map((item) => item.sku)));

  if (saved.length !== catalog.length) {
    throw new Error(`Lưu thiếu sản phẩm: cần ${catalog.length}, có ${saved.length}`);
  }

  const sourceBySku = new Map(
    catalog.map((item) => [item.sku, item.sourceQuantity]),
  );
  console.table(
    saved
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((row) => ({
        SKU: row.sku,
        "Sản phẩm": row.name,
        "SL nguồn": sourceBySku.get(row.sku),
        "Giá nhập": row.costPrice,
        "Giá bán": row.retailPrice,
        "Thông số": row.specs ? "Đủ" : "-",
        Ảnh:
          Array.isArray(row.imageUrls) && row.imageUrls.length > 0 ? "Có" : "-",
      })),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
