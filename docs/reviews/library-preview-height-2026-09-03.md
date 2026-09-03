# Library preview height regression

Scope: web library file preview, including responsive web. No Flutter, data,
storage, permission, upload or filter-flow changes.

## Reproduction and cause

Baseline `013ba7d`: at a 1280 × 800 viewport, the real `LibraryPreview` measured
584 px while resolving, 604 px after image resolution, and 736 px when zoomed.
The shared dialog used desktop `h-fit`; zoom enlarged the grid's intrinsic row,
and the whole body scrolled. Centering oversized content also put its left edge
outside the image scrollport.

## Fix

- Only preview opts into `min(800px, 100dvh - 4rem)` on desktop; mobile remains
  full-height. Other centered dialogs stay content-sized and drawers stay full-height.
- A bounded grid row keeps image and metadata scrollports independent on desktop.
- Zoom enlarges content inside the image scrollport, without moving header/footer.
  The image region can receive keyboard focus and scroll using Page Down.
- Mobile keeps a bounded image viewport and a vertically scrolling details body.

## Fresh browser evidence

Tested the real components with a temporary local fixture and mocked resolution;
no live records or network media were needed. Fixture removed before shipping.

| Viewport | Preview height | Verified states |
| --- | ---: | --- |
| 1280 × 800 | 736 px | Loading, image, zoom, expanded metadata, error, document, video frame |
| 1280 × 600 | 536 px | Image, zoom, expanded metadata, image panning |
| 1440 × 1000 | 800 px | Image, zoom, video frame, keyboard scrolling |
| 390 × 844 | 844 px | Loading, image, zoom, expanded metadata |

Header/footer bounds remained unchanged across image zoom and metadata expansion.
Expanded metadata scrolled only the desktop aside (1195 px content in a 572 px
viewport). Image panning reached both axes without moving the frame. Escape
closed the preview and restored focus to its opener. A short control dialog was
still content-sized at 192 px. Video verification covered layout, not playback.

The new SSR regression suite failed in two relevant cases before the fix and
passed all four afterward. It verifies the fixed loading frame, independent
metadata scrolling, and preservation of content-sized dialogs/filter drawers.
The existing library/source/file-info/project-dialog suites also passed (43 tests).
Focused ESLint and the production Next.js build passed. Existing unrelated
Open Graph `metadataBase` / `fit-content` warnings remain unchanged.
