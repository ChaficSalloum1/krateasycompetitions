# Design System: TournamentOS Operations Studio

## 1. Visual Theme & Atmosphere

A calm, high-trust tournament control room: cockpit-dense without visual panic,
asymmetric where it improves scanning, and restrained in motion. The interface
must remain legible from a busy tournament desk and predictable for keyboard,
touch, screen-reader, and reduced-motion users. Proof is nearby but never allowed
to bury the next operational action.

Density: 8/10. Variance: 4/10. Motion: 3/10. Operational clarity takes priority
over decorative novelty.

## 2. Color Palette & Roles

- **Warm Canvas** (#F4F2EC) — application background.
- **Paper Surface** (#FFFDF8) — working surfaces and editable regions.
- **Deep Forest Ink** (#17201D) — primary text and navigation depth; never pure black.
- **Slate Metadata** (#65706B) — timestamps, supporting descriptions, and inactive states.
- **Quiet Border** (#D8D7CF) — structural separators.
- **Signal Terracotta** (#B74E30) — the single accent for primary action, active focus,
  and exceptional attention. Status meaning must always include text or icon shape.
  The original #C95635 measured 4.25:1 as text on Paper Surface and 4.32:1 under white
  button labels, below WCAG AA 4.5:1; #B74E30 keeps the hue at 4.98:1 and 5.07:1.

All web surfaces take these values from one token set in `src/design-system.ts`; a page
never defines its own palette, fonts or organiser navigation.

Green, amber, and red may appear only as semantic status tokens, never as accents,
and must always be paired with explicit words.

## 3. Typography Rules

- **Display and body:** Geist or the closest platform-native sans-serif fallback.
- **Operational numbers and evidence:** Geist Mono or the closest platform-native
  monospaced fallback.
- Headings remain compact and weight-led; no oversized marketing typography.
- Body copy uses relaxed leading and a maximum readable measure of 65 characters.
- Generic serif faces and Inter are not used in this dashboard.

## 4. Component Stylings

- **Primary buttons:** Signal Terracotta fill, 10px radius, strong label, 44px
  minimum target, and a one-pixel pressed translation. No glow.
- **Secondary buttons:** transparent or Paper Surface with a Quiet Border.
- **Operational rows:** border-top separators and whitespace rather than a card
  around every item. Started, frozen, delayed, and blocked are textual badges.
- **Incident panel:** an inline proposal surface containing cause, affected people,
  schedule changes, proof status, and approve/reject actions in that order.
- **Inputs:** labels above, evidence/helper text below, and errors directly adjacent.
- **Loading:** skeletons matching the eventual control-room rows.
- **Empty states:** explain why the list is empty and the safe next action.

## 5. Layout Principles

- The primary information architecture follows organiser jobs: Plan (Home, New
  tournament), Operate (Run event, Schedule, Player view), Library (People &
  places, Format library), then Advanced (Rules interpreter, Format structure,
  Evidence). Engine vocabulary never leads the default experience.
- Home answers one question first: "What needs me now?" Decisions and incidents
  precede passive counts, tournament lists, club administration, and evidence.
  Organisation switching and club scoping remain visible.
- Guided creation preserves one explicit sequence: Participants -> Format ->
  Rules -> Resources -> Priorities -> Review. A user can go back without losing
  validated work, while review seals one immutable definition revision.
- Player view begins with a named participant/team search and answers time,
  opponent, court, and schedule changes before exposing verification details.
- Desktop and iPad use a resource board plus an asymmetric incident/attention rail.
- Mobile collapses to one column with Now, Next, Attention, then remaining courts.
- No horizontal page overflow. Wide schedules may scroll only inside a named table
  region with an accessible description.
- The main working area is capped at 1480px and uses CSS Grid.
- Every operational control remains at least 44px on touch platforms.
- The next consequential action is visible without opening a modal.
- The pilot-ready golden journey uses one decision spine: exact organiser intent,
  valid schedule trade-offs, certificate-bound publication, live impact preview,
  independent approval, and the resulting player-visible change.
- On desktop, evidence and approvals remain in a 360px sticky rail beside the
  decision narrative. On mobile, the rail becomes part of the single reading
  order so there is no hidden parallel workflow.
- A resilience recommendation and the approved plan are labelled separately.
  Informational comparisons must never masquerade as controls that alter the
  certificate-bound publication artefact.

## 6. Motion & Interaction

- Motion is limited to opacity and transform and is disabled for reduced motion.
- Active live-state indicators may use a subtle low-frequency opacity pulse; no
  other perpetual animation is appropriate during tournament operations.
- Rows update without reordering while focused. Stale revisions remain visible
  until the operator acknowledges or refreshes them.
- Keyboard shortcuts are discoverable beside their actions, not hidden in help.

## 7. Anti-Patterns (Banned)

- No emojis, neon gradients, outer glows, pure black, fake metrics, or fabricated
  availability claims.
- No generic three-card dashboard rows.
- No colour-only state, unlabeled icon-only actions, or hover-only information.
- No optimistic apply without a semantic and operational impact preview.
- No hidden automatic schedule movement.
- No model-generated competition truth or opaque AI confidence percentage.
- No full-page spinner, destructive overwrite, or modal cascade during live play.
