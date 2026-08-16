# Camera Specification Image Copy Design QA

## Reference and capture

- Source visual truth: `/var/folders/js/gbpnrzl93hg1khxtsvkk8w040000gn/T/codex-clipboard-21a068c2-8ba4-4163-a476-354b6713c16e.png`
- Browser-rendered implementation: `/private/tmp/lumapos-camera-spec-implementation.png`
- Reference pixels: 2048 × 1152
- Canvas CSS size: 1500 × 820 pixels
- Browser capture: 3000 × 1640 pixels at 2× density
- Browser viewport: 1600 × 1000 CSS pixels
- Normalization: reference and implementation were opened together at original resolution; proportions were compared rather than rescaling either source.
- State: desktop, light theme, EZVIZ H6C G1 3K 5MP, specification-only copy action.

## Comparison history

1. Initial implementation placed the specification table at 36% of the canvas width, leaving materially more whitespace around the product image than the supplied reference.
2. Moved the table start from 540 px to 420 px and expanded it to 1030 px. The final 28%/72% image-to-table split now closely follows the source visual.
3. Re-captured the generated canvas and compared the source and implementation together. No actionable P0, P1, or P2 differences remained.

## Required fidelity surfaces

- Fonts and typography: Arial, bold labels, navy heading, readable 24 px values, and 32 px line height reproduce the existing price-list visual hierarchy. One long feature value wraps safely instead of clipping.
- Spacing and layout rhythm: the image occupies the left visual column while the eight-row technical table fills the right side with consistent row padding and borders.
- Colors and tokens: white background, `#14344d` heading, `#526675` labels, `#edf3f6` label cells, and slate borders match the source and existing Luma camera quote palette.
- Image quality and asset fidelity: the real catalog product image is decoded at source quality and scaled proportionally. The action stops with a clear message when an image is absent or cannot load, so it never produces a misleading placeholder.
- Copy and content: the canvas contains only installation location and catalog specifications. Prices, memory-card variants, installation fees, recommendation copy, and sales descriptions are excluded.

## Interaction and runtime evidence

- Both “Sao chép ảnh gói” and “Sao chép ảnh thông số” are available from each compact model row; the detailed model card also exposes both actions with 44 px mobile touch targets.
- Clicking “Sao chép ảnh thông số” for EZVIZ H6C G1 3K 5MP produced the success status `Đã sao chép ảnh thông số EZVIZ H6C G1 3K 5MP.`
- Clipboard fallback downloads `thong-so-camera-XX.png` when direct image copy is unavailable.
- Browser console errors checked after the primary interaction: none.
- Focused-region comparison was unnecessary because the product image, all labels, all values, borders, wrapping, and whitespace were legible in the original-resolution full-view comparison.
- Residual test gap: the in-app browser exposed a minimum effective width of 1280 px, so the mobile breakpoint was verified by the existing responsive branch and automated source contract rather than a separate phone-sized browser capture.

## Result

final result: passed

---

# Compact Inventory Overview Design QA

## Reference and capture

- Reference: `/var/folders/js/gbpnrzl93hg1khxtsvkk8w040000gn/T/codex-clipboard-19278753-7299-4a20-b506-ace1459925a9.png`
- Implementation capture: `/private/tmp/luma-inventory-compact-web-full.png`
- Side-by-side comparison: `/private/tmp/luma-inventory-compact-comparison-final.png`
- Reference pixels: 1274 × 743
- Browser viewport: 1280 × 720 CSS pixels, device scale factor 1
- Implementation pixels: 1280 × 720
- Normalization: the reference was cropped to 1274 × 720 and extended by 6 white pixels to compare at 1280 × 720 without scaling the UI.
- State: desktop, light theme, populated inventory overview

## Comparison history

1. The supplied reference showed the KPI/status area consuming roughly half of the visible content height.
2. Reduced the overview section gap, KPI strip height, status-card height, card padding, icon size, and supporting typography while preserving all four card links.
3. Re-captured the complete inventory view and compared it side by side with the supplied reference. The history table now begins about 250 px earlier without hiding content or reducing click targets below the product's desktop conventions.

## Checks

- Typography: the existing product font and weights are preserved; KPI values remain dominant while labels and descriptions use compact supporting sizes.
- Spacing: KPI cells are 80 px tall and status cards are 116 px minimum height, reducing the overview footprint by approximately 45%.
- Color: semantic red, amber, and green states use existing design tokens.
- Copy: all existing labels, counts, and stock-condition descriptions remain unchanged.
- Assets: no raster assets were required; icons use the existing Lucide icon library.
- Interaction: all four cards expose the expected detail URL; “Xem toàn bộ” opens and closes the history drawer.
- Runtime: no browser warnings or errors were present during the verified interaction.
- Responsive behavior: existing mobile responsiveness audit remains covered by automated tests.
- Focused comparison: no separate crop was needed because the full-view comparison keeps the KPI and four status cards legible at native resolution.

## Result

final result: passed
