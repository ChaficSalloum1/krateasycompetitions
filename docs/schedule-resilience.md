# Schedule resilience evidence

`rankSchedulesByResilience` compares already valid candidate schedules. It is not
a substitute for the scheduler or independent hard-constraint validator.

Every candidate is first checked for completeness, identity, duration, resource
eligibility, calendars, closures, dependencies, locks, collisions and participant
rest. A rejected candidate is reported separately and cannot enter ranking.

Valid candidates are ranked lexicographically by:

1. worst contest count when one resource disappears;
2. conflicts caused by each declared overrun scenario;
3. maximum affected-participant notification blast radius;
4. negative minimum dependency-chain slack;
5. makespan.

The caller supplies explicit positive overrun scenarios. The initial product
evidence uses 10, 20 and 30 minutes. Reports include per-resource and per-overrun
contest/participant witnesses, stable objective vectors and canonical evidence
hashes. Candidate and assignment ordering cannot affect the result.

This layer makes robustness visible and selectable without silently converting a
hard rule into a trade-off.
