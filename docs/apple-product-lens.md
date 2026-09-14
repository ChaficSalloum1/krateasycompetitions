# Apple Product and Human Interface Lens

## Product stance

Use one SwiftUI multiplatform client target for macOS, iPadOS, and iOS when the
Apple client milestone begins. It is an API client; tournament truth remains in
the TypeScript competition service.

Minimum initial platform assumption: iOS/iPadOS 17 and macOS 14, enabling modern
SwiftUI Observation, `NavigationStack`, and `NavigationSplitView`.

## Information architecture

- Mac/iPad regular width: three-column `NavigationSplitView` containing event
  sections, selected collection, and working detail/inspector.
- iPhone/compact width: task-oriented `TabView` with independent
  `NavigationStack` history for Today, Event, Alerts, and More.
- Stable routes carry lightweight identifiers, never view instances.
- Sheets use enum-driven `.sheet(item:)` presentation.
- Shared services enter through `@Environment`; feature state remains local or is
  explicitly injected.

## Platform jobs

- macOS: format authoring, rule inspection, scenario comparison, large schedules,
  keyboard shortcuts, menu commands, resizable panes, and multiple windows.
- iPadOS: live operations, court board, check-in, drag-aware schedule inspection,
  and responsive two/three-column layouts at all window widths.
- iPhone: next-action dashboard, check-in, score entry, incident alerts, participant
  lookup, and concise “why?” explanations. Do not squeeze the full graph editor
  into compact width.

## HIG release gates

1. Validation and solver status are adjacent to the object they describe.
2. Colour is never the only carrier of pass, warning, or failure state.
3. Destructive or activating actions show consequences and provide recovery.
4. iOS/iPadOS primary controls target 44x44 points; macOS controls use native sizing.
5. Dynamic Type, VoiceOver, Voice Control, Full Keyboard Access, and reduced motion
   are exercised in test plans.
6. Long operations expose progress, cancellation where safe, and persistent outcome.
7. Alerts are reserved for consequential interruption; routine status stays inline.
8. Mac provides menus, shortcuts, toolbars, sortable tables, and resizable inspectors.
9. iPad layouts are verified at narrow, intermediate, half, third, and full widths.
10. Offline/conflicted commands remain visibly pending until server certification.

## Core screens

1. Event portfolio and status
2. Compiler conversation with source-to-rule coverage
3. Formal rule inspector and assumption ledger
4. Competition graph and participant-path explorer
5. Scenario comparison and semantic plan/apply review
6. Court timeline and “why not?” inspector
7. Live operations board
8. Certification, replay, and export

The Apple client should be scaffolded only after the API contract, persistent
revision model, and authentication boundary exist.
