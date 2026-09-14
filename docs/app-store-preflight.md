# Apple client preflight report

Date: 2026-09-07

Scope: the shared SwiftUI iOS/iPadOS 17 and macOS 14 client, reviewed against the
general, macOS, and AI-app preflight checklists. No subscription, advertising,
health, finance, children, social/UGC, or VPN behavior is present.

## Rejections found (0 in source/build)

No source-level rejection pattern was found. This is not yet an App Store
submission: the external metadata, legal, identity, signing, and device evidence
below must be completed first.

## Release blockers and warnings (7)

1. App Store Connect app/version records, description, keywords, categories,
   age rating, review notes, and localized metadata do not exist in this workspace.
2. Production privacy-policy and support URLs are not supplied. They must describe
   the real server, identity provider, diagnostics, retention, deletion, and any
   AI-assisted interpretation before submission.
3. Signing team, distribution certificates, provisioning profiles, and App Store
   credentials are intentionally absent.
4. Versioned production API contracts, including live operations, are connected
   at the client boundary, but the production base URL and authentication adapter
   are not supplied. The standalone app therefore opens in deterministic demo mode.
5. App Store screenshots and reviewer credentials/instructions need the final
   production or review environment.
6. VoiceOver, Voice Control, Full Keyboard Access, Dynamic Type, reduced motion,
   narrow iPad multitasking, and physical-device network/offline behavior need a
   recorded runtime test pass. Source affordances alone are not audit evidence.
7. If user accounts are introduced, in-app account deletion and Sign in with Apple
   applicability must be evaluated against the final identity design.

## Passed checks (12)

- One native SwiftUI codebase adapts with `NavigationSplitView` at regular width
  and independent `NavigationStack` histories inside compact tabs.
- The Apple client contains no competition, standings, draw, scheduling, or
  certification truth; it consumes versioned server DTOs and fails closed.
- Live now/next/late/blocked/unreported operations are authored by the server and
  presented with text, accessible labels, and platform-adaptive navigation.
- Offline commands are durable, idempotent, leased, retry-aware, and visibly
  conflict-reconciled rather than silently applied.
- Validation/certification status is textual and adjacent; colour is not the only
  status carrier.
- Interactive rows and primary controls have 44-point minimum targets on iOS.
- Loading, empty, failure, retry, and action-required states are explicit.
- Keyboard refresh is provided and navigation uses stable value routes.
- Privacy manifest is present, syntactically valid, declares no tracking or
  collected data for the current client, and is copied into the app bundle.
- macOS sandboxing is enabled with only outbound network client access; no
  temporary exception entitlements are present.
- There are no advertising, tracking, payment, account, third-party SDK, private
  API, background-mode, or generative-output claims in the client.
- A complete original AppIcon asset catalog is compiled into the iOS bundle.
- Swift package tests, iOS Simulator compilation, and macOS app compilation pass.

## Build evidence

- Swift/XCTest and Swift Testing: 19/19 passing.
- iOS Simulator target: Debug arm64 build passed with Xcode 26.6.
- macOS target: Debug arm64 build passed with Xcode 26.6.
- Privacy manifest and entitlements: `plutil` validation passed.

The app icon was generated with the built-in image-generation workflow and then
compiled at Apple-required sizes. Final prompt: “A professional square app icon
where an abstract tournament bracket resolves into a certification checkmark;
midnight navy, cobalt/cyan structure, restrained amber proof accent; modern
geometric 3D-vector hybrid; no text, people, trophies, balls, trademarks, border,
or watermark; strong small-size silhouette.”
