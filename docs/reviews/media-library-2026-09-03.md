# Media library review and redesign

Scope: library changes since `58150e0^`, compared against repository standards and the user's request for shared sample photos, videos, quotation documents and greater storage capacity. Subsequent UI work includes responsive web and the native Flutter app. No schema change or migration in this redesign.

## Standards

1. **Documented violation — locale formatting.** The original byte formatter used `toFixed`, producing `1.5 MB` in Vietnamese instead of locale-aware formatting. `docs/i18n.md` requires locale formatting. Fixed with `Intl.NumberFormat` on web and the installed `intl` package on mobile.
2. **Judgment call — shared component reuse.** The original upload form used a raw comma-delimited tag input instead of the existing `TagInput`; `CLAUDE.md` calls for shared components. Web now reuses `TagInput` with explicit count/length bounds.

The original web picker already used a custom Luma control, not a native select. The shared Select additionally gained keyboard focus/navigation, Escape dismissal and focus restoration during this redesign. `docs/master-prompt.md`, referenced by CLAUDE.md, is absent and was not used as an invented standard.

## Spec

1. **P2 — silent 1,000-item ceiling.** The original query returned only the newest 1,000 items, so older files disappeared from search/albums despite the large-library requirement. Fixed with bounded keyset pagination, full-store album/usage counts and server-side filtering.
2. **P2 — metadata errors after uploading bytes.** Excess tags, oversized tags or long filename-derived titles could fail registration after R2 upload. Fixed with metadata prevalidation, bounded titles and retry state that retains completed uploads.
3. **P2 — expired private URLs.** Original preview/open reused URLs signed when the page loaded. Fixed with authenticated item resolution before viewing and a server-signed download redirect.

Native app support was clarified after the original feature, so its earlier absence is not counted as a historical violation. Oversized storage cards/upload forms were design findings, not unstated functional requirements.

Summary: Standards: one documented violation and one judgment call. Spec: three findings. The most consequential was the silent 1,000-item cutoff. All five were addressed.

## Implementation and verification

- Web: content-first gallery, compact expandable storage summary, desktop album navigation, responsive two-column gallery, compact upload dialog/full-screen mobile dialog, private preview and zoom.
- Native: More → Media library, image/video/document browsing, full-screen upload, sequential streaming of large files, no offline mutation queue, failed-file-only retry and private URL renewal.
- Web focused suite: 44 tests pass; targeted lint passes; production `bun run build` passes. Source-only TypeScript has zero diagnostics. Standalone whole-repository `tsc` still reports pre-existing test typing issues.
- Native initial implementation: 91 related tests pass; targeted Flutter analysis passes; iPhone 17 Pro Simulator builds/runs with a resident hot-reload session.
- Browser: inspected desktop and 390×844 layouts, opened custom picker, ArrowDown/End/Escape focus, dialog focus restoration, fixed mobile footer, local file selection/previews and mocked upload-error retry. Temporary QA route was removed before build.
- Native Simulator: real library item displayed without cropping its product code; upload and album-picker opened states inspected. No production uploads or deletions were performed during QA.
- The full web test runner stops on the existing mobile hit-area audit: seven findings in unchanged project, service and report screens. Library controls and shared-control checks pass that audit.

## Metadata boundary

The database records upload/registration timestamps, uploader, filename, MIME type, size, album, title, notes and tags. There is no dedicated capture timestamp, GPS coordinate, camera/EXIF or video metadata extraction/indexing in this feature. The web uploader sends the chosen file directly and creates thumbnails separately. Native image selection requests full metadata by default, but the pinned iOS plugin re-encodes selected images and attempts to reattach metadata; this is not a guarantee of byte-for-byte archival preservation. Device location is not collected as a substitute for capture location.
