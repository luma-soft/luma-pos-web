# Inventory redesign QA — web

- Source visual truth: `/var/folders/js/gbpnrzl93hg1khxtsvkk8w040000gn/T/codex-clipboard-58a7c353-686c-41a3-8c9a-321884d0b496.png`
- Intended viewport: 1619 × 971 px
- Intended state: Inventory / Stock, active stocktake banner visible
- Browser target: `http://127.0.0.1:3000/inventory?tab=stock`
- Browser evidence: `artifacts/inventory-web-auth-block.png`

**Findings**

- [P1] Runtime capture is blocked by authentication.
  Evidence: the local route redirects to `/login?tab=stock` in the in-app browser, so the implemented inventory screen cannot be captured at the matching state.
  Impact: typography, spacing, color, copy, responsive layout, and menu-open fidelity cannot be signed off from browser evidence.
  Fix: repeat capture in an authenticated local browser session.

**Implementation evidence available**

- The navigation source exposes only Products, Purchases, Stock, and More at the primary level.
- Stocktake remains reachable through the stock action menu and is no longer a primary tab.
- Focused ESLint passes for all changed web inventory files.

**Comparison history**

- Iteration 1: source opened; local implementation navigation was attempted; authentication redirect blocked same-state capture.

**Required fidelity surfaces**

- Fonts and typography: blocked by authentication.
- Spacing and layout rhythm: blocked by authentication.
- Colors and visual tokens: blocked by authentication.
- Image quality and assets: no custom image assets are required by this screen; runtime verification blocked.
- Copy and content: source/code mapping inspected; runtime verification blocked.

final result: blocked
