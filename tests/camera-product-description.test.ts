import { describe, expect, test } from "bun:test";
import { buildCameraProductDescription } from "../src/scripts/camera-product-description";

describe("camera product description", () => {
  test("includes every customer-facing specification and warranty", () => {
    const description = buildCameraProductDescription({
      name: "EZVIZ C1C-B 2MP",
      fullCode: "CS-C1C-B-E0-1E2WF",
      resolution: "1920 x 1080 (2MP), H.265",
      lens: "2.8mm; ngang 91°, dọc 50°, chéo 108°",
      connection: "Wi-Fi 2.4GHz; đàm thoại hai chiều",
      nightAndProtection: "Hồng ngoại đến 12m",
      powerAndStorage: "5V/1A, tối đa 3W; microSD đến 256GB",
      features: "Phát hiện chuyển động, cảnh báo trên ứng dụng EZVIZ; micro và loa tích hợp.",
    });

    expect(description).toContain("EZVIZ C1C-B 2MP – mã CS-C1C-B-E0-1E2WF.");
    expect(description).toContain("• Độ phân giải: 1920 x 1080 (2MP), H.265.");
    expect(description).toContain("• Ống kính / góc nhìn: 2.8mm; ngang 91°, dọc 50°, chéo 108°.");
    expect(description).toContain("• Kết nối: Wi-Fi 2.4GHz; đàm thoại hai chiều.");
    expect(description).toContain("• Quan sát ban đêm / bảo vệ: Hồng ngoại đến 12m.");
    expect(description).toContain("• Nguồn / lưu trữ: 5V/1A, tối đa 3W; microSD đến 256GB.");
    expect(description).toContain("• Tính năng chính: Phát hiện chuyển động");
    expect(description).toContain("• Bảo hành: 24 tháng.");
    expect(description).not.toContain("tích hợp..");
    expect(description.split("\n")).toHaveLength(8);
  });
});
