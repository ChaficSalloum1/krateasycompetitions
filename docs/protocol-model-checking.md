# Critical protocol model checking

The repository uses bounded exhaustive state exploration for three small,
high-consequence protocols:

- published revision equals the current approved and certified revision;
- a command identity has at most one effect and conflicting reuse has none;
- a live change uses its current base, applies once and has a distinct approver.

Run the executable models with:

```bash
npm run stress:protocols
```

The current bounds explore 49 unique states and 133 enabled transitions. The
result is deterministic and hash-bound. A negative-control test supplies an
unsafe publication transition and verifies that breadth-first exploration returns
the one-action shortest counterexample.

Portable TLA+ equivalents and TLC configurations live in `formal/`. TLC is not
vendored and was not available in the local environment, so an external TLC run
is not claimed by repository tests. CI may add a pinned, checksum-verified TLC
artefact and archive its output as an additional release gate.
