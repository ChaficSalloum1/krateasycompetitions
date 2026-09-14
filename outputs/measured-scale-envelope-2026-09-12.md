# Measured scheduling scale envelope — 2026-09-12

Command: `npm run stress:scale`

Environment: Node v26.0.0, macOS arm64. Campaign proof hash:
`23f249fc94cc1b421882a5e18f94beb271bb41ae77acd87e8e55f205eb21f589`.

| Tasks | Resources | Tasks/resource | Result | Backend | Latency (ms) | Process RSS (MB) | Objective (min) | Gap |
|---:|---:|---:|---|---|---:|---:|---:|---:|
| 128 | 16 | 8 | CERTIFIED | OPTIMAL | 538.82 | 84.64 | 40 | 0 |
| 128 | 8 | 16 | CERTIFIED | OPTIMAL | 251.13 | 85.02 | 80 | 0 |
| 128 | 4 | 32 | CERTIFIED | OPTIMAL | 254.38 | 85.06 | 160 | 0 |
| 512 | 64 | 8 | CERTIFIED | OPTIMAL | 295.45 | 86.11 | 40 | 0 |
| 512 | 32 | 16 | CERTIFIED | OPTIMAL | 299.86 | 86.33 | 80 | 0 |
| 512 | 16 | 32 | CERTIFIED | OPTIMAL | 320.76 | 86.53 | 160 | 0 |
| 2,048 | 256 | 8 | CERTIFIED | OPTIMAL | 759.62 | 100.06 | 40 | 0 |
| 2,048 | 128 | 16 | CERTIFIED | OPTIMAL | 761.06 | 103.47 | 80 | 0 |
| 2,048 | 64 | 32 | CERTIFIED | OPTIMAL | 892.34 | 102.23 | 160 | 0 |

All nine returned schedules passed the independent hard-constraint validator with
zero validation findings. These are single-run measurements of deliberately
regular feasibility/optimality fixtures: fixed-resource chains, five-minute tasks,
no participant contention across tasks, no closures, and no disruption repair.
They do not certify arbitrary 2,048-contest tournaments, concurrency throughput,
tail latency, or a production capacity ceiling.

The reported RSS is the parent Node process reading after each solver invocation;
it is not a peak-memory measurement of the Python solver subprocess. The campaign
therefore remains `UNKNOWN`, by design, because repair quality was not exercised.
Production qualification still needs repeated warm/cold runs, peak child-process
memory, representative mixed constraints, adversarial infeasible cases, concurrent
tenants, repair fixtures, and deployment-shaped hardware.
