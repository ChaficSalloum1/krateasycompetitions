# Delivery gates

## Implemented reference phases

- Phase 0: repository archaeology
- Phase 1: canonical Tournament IR foundation
- Compiler safety: type checks, provenance, coverage, semantic revisions, critic
- Phase 2: competition graph and independent cardinality checks
- Phase 3: deterministic standings and qualification
- Phase 4: arbitrary-size bracket topology and deterministic draw placement
- Phase 5: constraint scheduling and independent shadow validation
- Phase 6: Scenario Lab facade over the same engine
- Phase 7: deterministic dry-run simulation and certification
- Phase 8: safe natural-language intent/compiler boundary
- Phase 9: interactive web compiler console
- Phase 10: dynamic Americano state machine
- Phase 11: seeded Monte Carlo duration-risk analysis
- Phase 12: certified external identity/result publication boundary

## Production-hardening queue

The reference implementation exercises every architectural phase, but a senior
production release still needs the following environment-dependent work:

The first Days 1–30 invariant from the bleeding-edge roadmap is now implemented:
all publication paths require an exact-revision Competition Guard certificate,
and the preferred operator path certifies and publishes atomically. The dashboard
exposes whether evidence is uncertified, current, stale, or already published.

1. Extend the shipped pinned CP-SAT adapter and exact minimal-change repair engine
   to larger measured envelopes. The post-solver resilience ranker now measures
   resource loss, overrun conflicts, notification blast radius, critical slack
   and makespan while rejecting invalid candidates before comparison.
2. Provision the shipped PostgreSQL event-store migration in a managed service;
   run the implemented transactional outbox lease/retry/dead-letter worker,
   backup/PITR and restore drills, and production monitoring around its forced-RLS
   tenant boundary.
3. Add organisation-specific rulesets only after historical fixtures are supplied.
4. Connect the existing least-privilege role policy to a real identity provider
   and deployment infrastructure.
5. Expand the registered NLP grammar or connect a model strictly as interpreter.
6. Add real Krateasy credentials/contracts when that external system is available,
   using the existing signed and idempotent gateway.

These are intentionally not fabricated in a projectless workspace. Each future
addition must extend the same IR and truth pipeline, never create a separate
scenario, live-event, or AI competition engine.
