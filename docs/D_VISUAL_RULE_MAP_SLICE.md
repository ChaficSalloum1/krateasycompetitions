# D10 — organiser rule map and calmer review surface

JOB: Let an organiser read the whole proposed competition and its applicable rules without opening a technical ledger or guessing which card hides a rule.
INPUT: The current draft, catalog coverage, source facts, decisions, findings, membership/operations/lock projections.
OUTPUT: A visual stage map with plainly labelled rule/value/basis rows, questions beside the structure, a contextual editor, and a quiet technical evidence disclosure.
AUTHORITATIVE OWNER: The existing interpretation and draft aggregate own all rule values and revisions. This presentation owns no rule or Guard decision.
INVARIANTS: Every applicable catalog field appears exactly once in the visual rule map, including missing, conflicting and optional inherited/default fields. Non-applicable fields are excluded. Conflicts never display the last parsed claim as an accepted value. Edits use the existing revisioned commands; blocked edits do not change truth. The label READY TO REVIEW never implies Guard certification.
TELEMETRY: Existing node-opened, rule-changed, question, revision and hash events remain. No fabricated approval event.
ACCEPTANCE SCENARIO: An organiser reads a pools-to-two-cups definition, sees the unresolved cross-pool rule beside the qualification stage, answers it, changes only the second cup's policy, and can inspect every applicable rule from the main view. A contradictory statement is labelled conflicting and cannot be reviewed. Knockout does not show pool-only rules. Mobile and enlarged-text layout retains the same fields without hiding evidence columns.
NON-GOALS: New rules, language models, changing compiler/Guard/scheduler semantics, production auth, acceptance impersonation.
EXIT GATE: Deterministic UI test enumerates the visible applicable catalog paths exactly once for pools, knockout and round robin; interaction, contradiction, edit and source replacement checks pass; build and focused suite pass. Full D still requires organiser and real-browser/mobile/accessibility acceptance.
