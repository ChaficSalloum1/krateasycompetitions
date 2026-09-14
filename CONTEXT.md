# TournamentOS domain language

TournamentOS is a proof-carrying tournament compiler. These terms are part of its architecture and should be used consistently in code and product copy.

- **Competition compiler** — converts an approved tournament specification into executable contest, progression, scheduling, and result semantics. Compilation must fail closed when any required adapter is absent.
- **Format adapter** — the narrow seam implementing one competition primitive, such as Swiss pairing or double elimination. An adapter owns its constraints, deterministic output, findings, and proof evidence.
- **Sport semantics** — registered, versioned rules that turn raw sport results into placements, standings points, or ranked marks without branching on a sport name.
- **Capability level** — evidence-derived support status: `NATIVE`, `COMPOSABLE`, `EXTENSION_REQUIRED`, or `UNSUPPORTED`. Schema presence is never evidence of support.
- **Proof closure** — the state in which every required compilation and execution claim has positive evidence and no solver, tie, policy, or adapter remains unknown.
- **Verification space** — the declared finite Cartesian set of cases covered by a bounded exhaustive run.
- **Scale envelope** — the largest named workload and constraint profile actually exercised. It is evidence, not an unlimited-capacity claim.
- **Pool construction** — deterministic assignment of entrants to declared pools under size, fixed-placement, separation, togetherness, and attribute constraints. A feasible incumbent is distinct from an exhausted optimal proof.
- **Dynamic stage stream** — the authoritative append-only definition and command history for a result-dependent stage. Snapshots are disposable caches; replayed events are tournament truth.
- **Registered random source** — a versioned algorithm and seed mapping that produces reproducible random choices. Proof evidence binds the actual named algorithm, not only a seed string.
- **Declarative qualification** — an ordered, typed selector program over a finite candidate universe. Every selection records its selector, comparison set, metric or authority evidence, and global exclusion state; destination failure rolls back partial output.
- **Governed rule pack** — immutable, versioned sport semantics plus owner, approving authority, jurisdiction, effective dates, compatibility bounds, and hash-bound evidence. Illustrative conformance is not federation certification.
- **Capability conformance audit** — executable closure between every native ledger claim and a canonical primary-path fixture. It complements, and never replaces, each format's dedicated scale corpus.
- **Counterexample** — a concrete input and invariant violation showing why certification failed.
- **Certified** — all registered invariants for the stated capability and scale envelope passed. It never means “works for every possible tournament.”
- **Competition Guard** — the deterministic, solver-independent correctness module that evaluates an exact proposed competition revision and returns structured findings plus hash-bound evidence. Schedulers, people, imports, and AI may propose changes; only a passing Guard report can support publication. The Guard never claims operational events will occur as predicted or that a schedule is globally optimal unless a separate proof establishes that claim.
- **Publication certificate** — an immutable binding among the approved specification, competition graph, schedule, effective governed rule packs, requirement coverage, Guard report, and publication policy. Publication is valid only when every bound hash names the exact artefact being released and the certificate remains current.
