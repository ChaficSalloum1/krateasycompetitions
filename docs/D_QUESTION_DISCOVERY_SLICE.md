# D11 — visible questions and honest checking status

JOB: An organiser can immediately find missing decisions, understand why an answer is needed, and distinguish a checked draft from an assured tournament.

INPUT: Current revision's Interpretation decisions, coverage, source failures and existing compilation findings. Existing hosted D10 source.

OUTPUT: A prominent question/check panel before the editor, an explicit Check my tournament action, a readable coverage boundary, and content-addressed browser assets.

AUTHORITATIVE OWNER: CreatorSession owns draft commands; Interpretation owns questions; existing compiler owns its findings. UI projects these without issuing Guard certificates.

INVARIANTS: No fabricated questions or PASS evidence. Missing/unsupported semantics remain unresolved. Zero questions cannot imply draw/schedule safety. Editing invalidates review as before. Each applicable rule remains visible once. No stale asset pair through fixed filenames in new generated HTML.

TELEMETRY: Reuse structure_node_opened for question/check panel navigation and existing source/answer/review events.

ACCEPTANCE SCENARIO: Incomplete pools-to-cups input visibly asks for comparison before the description/editor; answering removes that question; source changes invalidate the answer. An invalid destination blocks draft review. A complete description explicitly leaves draw/schedule assurance unchecked. Unknown text remains unresolved. HTML references assets by content hash, and the referenced bundle is the one exercised by DOM tests.

NON-GOALS: No universal NLP guarantee, Phase E/F implementation, production publication authority, or changes to tournament outcomes. Browser sign-in retry is not part of this slice.

EXIT GATE: Build and bundled interaction checks pass on the exact site-bound assets; private deployment succeeds. Full D remains open for real organiser and browser accessibility acceptance. The reported old appearance is not presumed to be proven cache failure without browser evidence.
