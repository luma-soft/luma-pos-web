**Comparison target**

- Source visual truth: `/Users/cvthien/Library/Mobile Documents/com~apple~CloudDocs/Bao_gia_chi_tiet_lap_dat_camera_Hai_Dang_1994.pdf`, page 3 (detailed package layout).
- Implementation: `https://lumapos.shop/camera-price-list`.
- Intended state: public guest view, desktop, first EZVIZ package.

**Evidence**

- The source page was rendered at 160 DPI and reviewed at `/tmp/hai-dang-camera-pdf/page-03.png` (1323 x 1871 pixels).
- The production route was deployed successfully, but the in-app browser timed out while navigating and capturing it. A browser-rendered implementation screenshot is therefore unavailable for this run.

**Findings**

- [P1] Browser visual capture is blocked.
  Location: production route.
  Evidence: browser navigation/capture timed out before an implementation screenshot could be produced.
  Impact: the package image crop, text wrapping, and responsive layout cannot be visually compared against the PDF in this run.
  Fix: rerun this QA after the in-app browser can load the production page.

**Implementation Checklist**

- [x] Render a detailed per-package section with product image, technical specifications, price variants, and cost breakdown.
- [x] Use the product image URL stored in the database.
- [x] Include the product image in the copied package image where the browser can fetch it.
- [x] Keep Hikvision models out of this temporary price list.
- [ ] Capture and visually compare production in the browser.

**Comparison history**

- Initial run: implementation build and deployment passed; visual browser capture blocked by navigation timeout.

final result: blocked
