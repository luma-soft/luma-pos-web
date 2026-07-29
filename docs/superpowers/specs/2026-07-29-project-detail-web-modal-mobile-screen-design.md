# Project Detail: Web Modal and Mobile Screen

## Goal

Change project-item navigation so project details stay contextual on the web
while using native full-screen navigation in the Flutter mobile app.

## Scope

This change covers:

- the project list inside the web `Thi công & Dịch vụ` area;
- the existing web `/projects/[id]` project-detail experience;
- the Flutter mobile projects list and project-detail experience;
- automated tests for the new navigation and detail rendering behavior.

It does not change database schemas, project/service business rules, or API
response contracts.

## Web Experience

### Navigation

Clicking a project item or project name from the project list uses client-side
navigation to `/projects/{id}`. Next.js intercepts that route and renders the
detail as a modal over the current list.

The modal:

- preserves the list, active tab, filters, pagination, and scroll context;
- closes with the close button, Escape, backdrop click, or browser Back;
- reopens with browser Forward;
- fills the viewport on small screens;
- uses the existing large dialog treatment on desktop.

A hard navigation, shared link, or refresh at `/projects/{id}` continues to
render the standalone detail page.

### Detail Content

The standalone page and intercepted modal render the same shared project-detail
component. No detail UI or business behavior is duplicated.

The shared content includes all existing sections and service tabs, including:

- overview and workflow summary;
- related orders;
- service jobs;
- installed equipment;
- warranty claims;
- materials;
- handover documents;
- maintenance plans;
- cost and profitability information;
- activity timeline and status history;
- existing create, edit, print, and status actions.

The existing project edit dialog remains a separate nested dialog. Opening or
closing it must not close the project-detail modal.

### Web Architecture

Add a `projectModal` parallel-route slot to the authenticated app layout.
Intercept `/projects/[id]` in that slot using the same established approach as
the product-detail modal.

Extract the current `/projects/[id]` rendering into a shared server component
that accepts the loaded detail and any required form options. Both the regular
page and modal route load data through the existing project data functions and
render that component.

The modal shell is a client component responsible only for dialog semantics,
focusable close controls, Escape handling, backdrop handling, scrolling, and
Back navigation.

## Flutter Mobile Experience

### Navigation

Tapping a project card pushes a dedicated project-detail route with
`Navigator.push`. The current detail bottom sheet is removed from this flow.

The detail route:

- uses a normal full-screen `Scaffold`;
- has a top app bar with Back, project name, and customer context;
- returns to the existing list and preserves its filter and scroll state;
- causes the list to refresh after returning so mutations are reflected.

### Detail Content

The mobile detail screen loads the existing
`GET /api/mobile/projects/{id}` response. For service projects it provides
horizontally scrollable tabs for:

- Overview;
- Jobs;
- Equipment;
- Warranty;
- Materials;
- Handover;
- Maintenance;
- Costs;
- History.

Each tab uses mobile-native cards and compact rows. Empty collections show a
localized empty state. Loading and request failures use the existing mobile
sync/error components.

For non-service projects, the screen preserves the current project summary,
status action, financial metrics, and related orders without showing empty
service-only tabs.

Existing mobile mutations remain available where already supported. This
change does not add new mobile create/edit APIs for service sub-resources.

### Mobile Data Model

Extend the local project-detail mapping to consume the existing service fields
and collections returned by the API:

- service type, stage, progress, schedule, and site contact;
- jobs, assets, claims, materials, status logs, and cost entries;
- profitability and planned material cost;
- handover documents and maintenance plans.

Malformed collection rows are skipped rather than crashing the detail screen.
A malformed top-level response shows the existing error treatment.

## Accessibility and Interaction

The web modal has dialog semantics, a labelled title, keyboard close behavior,
and independent internal scrolling. Interactive child dialogs stop event
propagation and remain usable.

The mobile screen uses standard route and app-bar semantics. Tabs and cards
retain accessible labels, minimum touch targets, and the existing Be Vietnam
Pro visual system.

## Testing

### Web

- verify the authenticated app layout renders a `projectModal` slot;
- verify the intercepted project route renders the shared detail content in a
  dialog;
- verify project-list links still target `/projects/{id}`;
- verify the standalone project route uses the same shared detail component;
- run affected tests, lint, and production build.

### Mobile

- widget-test that tapping a project card pushes a full-screen detail route
  rather than opening a bottom sheet;
- widget-test Back navigation returns to the project list;
- mapping tests for service-project fields and each detail collection;
- widget coverage for service tabs, empty states, loading, and failure;
- run focused Flutter tests, analyzer, and the broader applicable test suite.

## Acceptance Criteria

1. Web project clicks open the complete current detail experience in a modal.
2. Closing the web modal restores the unchanged project list context.
3. Direct visits and refreshes at `/projects/{id}` still show a full page.
4. Web modal and full page share one detail implementation.
5. Flutter project clicks open a dedicated full-screen detail screen.
6. Flutter service projects expose all specified detail categories as tabs.
7. Existing supported actions continue to work.
8. No schema or API contract changes are required.
9. Relevant automated tests, lint/analyzer, and builds pass before delivery.
