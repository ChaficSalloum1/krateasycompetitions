# Critical protocol models

These TLA+ specifications are the portable formal definitions for the small,
dangerous protocols identified in the engineering roadmap. They intentionally do
not model tournament algorithms.

- `PublicationProtocol`: only the current approved and certified revision can publish.
- `IdempotentCommandProtocol`: replay has one effect and conflicting key reuse has none.
- `LiveChangeApprovalProtocol`: a live change uses its current base, a distinct approver and one application.

The repository test suite executes equivalent finite models through
`modelCheckCriticalProtocols()` and records deterministic state/transition counts
and proof hashes. The `.cfg` files can additionally be run with TLC when
`tla2tools.jar` is available:

```bash
java -cp tla2tools.jar tlc2.TLC -config formal/PublicationProtocol.cfg formal/PublicationProtocol.tla
java -cp tla2tools.jar tlc2.TLC -config formal/IdempotentCommandProtocol.cfg formal/IdempotentCommandProtocol.tla
java -cp tla2tools.jar tlc2.TLC -config formal/LiveChangeApprovalProtocol.cfg formal/LiveChangeApprovalProtocol.tla
```

TLC is not vendored in this repository. A release pipeline must pin and verify the
tool artefact before treating an external TLC run as release evidence.
