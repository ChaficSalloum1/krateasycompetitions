# D7 — interpretation clarity pass

JOB: Let an organiser see the proposed competition and the next needed decision at a glance.
INPUT: The existing revision-bound CreatorSession projection, source facts, open decisions and definition findings.
OUTPUT: A clearer source → structure → decisions editor with visible stage meaning, per-card attention cues and a plain-language review status.
AUTHORITATIVE OWNER: CompetitionDefinition owns rule truth; the draft editor only projects it. Source facts retain provenance. The organiser makes decisions. This presentation cannot approve or publish.
INVARIANTS: Do not invent a rule, identity, Guard result or schedule. Never hide a blocker behind a green status. Visual controls use the existing typed draft commands and preserve revision, undo and stale-answer semantics. Every issue cue must derive from an actual decision or finding.
TELEMETRY: Keep structure_node_opened, rule_changed, qualification_changed and validation_blocked events; this slice introduces no authoritative event.
ACCEPTANCE SCENARIO: On the pools-to-cups example, the first view shows the source, four pools, qualification, separate cups and one unresolved comparison. Selecting its cue opens the matching decision; answering it updates readiness. A count mismatch remains visible and links to the offending rule. At narrow widths and 200% text, the reading order remains source, structure, decisions.
NON-GOALS: New interpreter grammar, automatic repair, schedule certification, production approval, new auth or organisation surfaces.
EXIT GATE: Built UI interaction checks and core regression pass; organiser and real-browser/mobile/accessibility acceptance are recorded separately in D_REVIEW_GATE. This bounded pass does not close full D alone.
