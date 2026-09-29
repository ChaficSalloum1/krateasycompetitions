# Phase D organiser acceptance — pending

JOB: Establish that a non-developer can reproduce and alter the intended P&K format through source and visual controls.
INPUT: An organiser-confirmed complete P&K format, roster and operational constraints, with explicit unresolved policies. The existing historical planning fixture and synthetic results are supporting evidence, not confirmation of the real event.
OUTPUT: Completed review record with source version, exported draft, expected/observed outcomes and unresolved findings.
OWNER: Organiser confirms intended semantics; the draft editor proposes representations. Review does not publish or certify a competition.
INVARIANTS: No invented entrants, implicit cross-pool comparison or silently removed locks. Blocked edits preserve accepted draft state; source changes cannot reuse stale answers. Any missing control blocks this gate.
TELEMETRY: Exported source facts, answers, commands, revision transitions and hashes; record screenshots and viewport separately.
NON-GOALS: Schedule generation, automatic pre-event repair, publication, event operation.

## Acceptance steps

1. Enter the complete format as text or supported structured input. Inspect divisions, pool sizes, qualification, each cup's bracket capacity/seed protection/byes/rematch policy, scoring and tiebreaks. Compare each to the organiser-confirmed source. Change one second-cup policy and confirm the main cup is unchanged.
2. Answer an ambiguous runners-up comparison. Confirm that an unresolved or unsupported rule prevents review instead of becoming an invented default.
3. Attach the organiser-approved roster to the format. The downloadable St Albans planning CSV is a rehearsal only: its person IDs are illustrative. Verify pair/member identities and exact pool coverage. Swap pairs and add together/separate constraints. Deliberately conflict a rule and verify rejection leaves the previous draft unchanged.
4. Change pool count/size and qualification destinations. Verify a ten-qualifier/eight-slot mismatch exposes the missing destinations; undo restores the previous structure and clears review.
5. Change duration, rest and individual court windows. Pin a contest to a start and court. Try a closed window and a second overlapping pin on that court: both must reject. Unlock explicitly and verify undo restores the pin.
6. Review, then alter the source. Verify review becomes stale and questions/structure update. Export and compare the revised definition and separate Plan locks to the visible controls.
7. Repeat the critical controls on desktop and mobile, at 200% text enlargement and with keyboard navigation. Check visible focus, labels, reading order, error announcements and absence of clipped controls.

## Exit record

Status: PENDING. Record organiser identity, date, source hash, core commit/tree, browser/device, pass/fail per step and exact counterexamples. A developer/DOM test cannot impersonate organiser confirmation or browser evidence. Full D closes only after required capabilities and this acceptance are demonstrated; defects stay in D.
