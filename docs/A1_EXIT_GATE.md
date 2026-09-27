# Ticket 1 / A1 exit evidence

Phase: A — Freeze & Observe. Slice: A1 — Documentation authority reset.
Branch: `architecture/compiler-runtime-reset`.
Entry condition: supplied finite plan/domain contract and repository baseline `71b7160b60295d8f43aba9ba51cd221dc8a4b146`; conflicting historical authority trees present; no new active eight-file set.

## Four-question fresh-agent handoff

| Question | Answer from active files | Evidence location |
|---|---|---|
| What are we building? | General Krateasy competition compiler/runtime plus independent assurance/Guard, consumed by branded P&K through domain contracts | PRODUCT destination; ARCHITECTURE integration boundary |
| What are we not building? | A second P&K/browser engine, premature platform/format expansion, or product features in A1 | PRODUCT finite scope; BUILD_PLAN A1 non-goals |
| What owns each truth? | CompetitionDefinition owns intent; CompetitionPlan owns approved assignments; CompetitionRuntime owns append-only Reality; revisions preserve lineage; assurance verifies; Guard protects commits | DOMAIN truth/universe tables; MODULE_CONTRACTS |
| What is the current slice? | Ticket 1/A1 documentation reset only; stop after this change set. A2 freeze record then A3 harness is next; B waits for all A evidence | BUILD_PLAN current slice; CLAUDE |

## Acceptance checks

The accompanying verification checks the exact eight required files, classifications for every baseline Markdown/PDF, original content preservation beneath status notices, local Markdown link targets, and documentation-only diff. It also verifies that the module contract and slice fields exist and that all A–N rows remain ordered. Results are recorded below after execution.

These are documentation/scope checks, not a new engine test run, browser rehearsal, independent team review or production certification. No claim is made that a separate fresh agent was actually run; the handoff answers above establish the self-contained acceptance scenario.

## Exit condition and boundary

A1 passes only when those checks pass and the change set is preserved for review. The full Phase A gate remains open. A2's freeze is documented as policy but the P&K repository has not been inspected/changed in this ticket. A3 corpus/trace/corruption implementation is not delivered here. No other-chat prototype or requirement is changed/imported.

Next allowed slice: A2 freeze verification, then Ticket 2 / A3 audit harness. Do not proceed beyond this ticket in this change set. Subsequent work uses the same finite programme, not a new roadmap.

## Executed result — 2026-09-27

**PASS (local documentation acceptance).** Eight required authorities and four routing/evidence records exist. All 59 pre-existing documentation files are classified; the 58 Markdown files preserve their complete original bytes beneath a status notice and the PDF is unchanged. All local links in the active set resolve. All nine slice fields and fourteen module-contract fields are present. Phases are ordered A through N. The changed/new-file inventory contains Markdown only. `git diff --check` passed.

No runtime tests were rerun because no executable code changed. The branch review, not this document, determines merge status. Full Phase A and production readiness remain unestablished.

### Reproduce the documentation acceptance check

From the repository root, save/run this Python body or execute it through a Python heredoc. It compares against the immutable baseline rather than trusting status labels:

```python
from pathlib import Path
import subprocess,re,hashlib,json
root=Path.cwd()
base='71b7160b60295d8f43aba9ba51cd221dc8a4b146'
required=['PRODUCT.md','DOMAIN.md','ARCHITECTURE.md','MODULE_CONTRACTS.md','BUILD_PLAN.md','TELEMETRY.md','CLAUDE.md','FUTURE.md']
active=required+['AGENTS.md','docs/AUTHORITY_SOURCES.md','docs/DOCUMENT_REGISTRY.md','docs/A1_EXIT_GATE.md']
files=subprocess.check_output(['git','ls-tree','-r','--name-only',base],cwd=root,text=True).splitlines()
docs=[p for p in files if p.endswith(('.md','.pdf','.rst'))]
registry=(root/'docs/DOCUMENT_REGISTRY.md').read_text()
errors=[]
for f in active:
 if not (root/f).is_file():errors.append('Missing '+f)
for f in docs:
 raw=subprocess.check_output(['git','show',base+':'+f],cwd=root)
 current=(root/f).read_bytes()
 if f.endswith('.md'):
  if not current.endswith(raw) or not current.startswith(b'> Documentation status:'):errors.append('Preservation/status '+f)
 else:
  if current!=raw:errors.append('Binary preservation '+f)
 if f'[{f}]' not in registry or hashlib.sha256(raw).hexdigest() not in registry:errors.append('Classification/hash '+f)
for f in active:
 for link in re.findall(r'\]\(([^)]+)\)',(root/f).read_text()):
  if '://' in link or link.startswith('#'):continue
  if not ((root/f).parent/link.split('#')[0]).exists():errors.append('Broken link '+f+': '+link)
changed=subprocess.check_output(['git','diff','--name-only',base],cwd=root,text=True).splitlines()
new=subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=root,text=True).splitlines()
if any(not p.endswith('.md') for p in changed+new):errors.append('Non-document change')
fields=['JOB','INPUT','OUTPUT','AUTHORITATIVE OWNER','INVARIANTS','TELEMETRY','ACCEPTANCE SCENARIO','NON-GOALS','EXIT GATE']
plan=(root/'BUILD_PLAN.md').read_text()
for f in fields:
 if '- '+f+':' not in plan:errors.append('Missing slice field '+f)
phases=re.findall(r'^\| ([A-N]) — ',plan,re.M)
if phases!=list('ABCDEFGHIJKLMN'):errors.append('Phase order '+str(phases))
contracts=(root/'MODULE_CONTRACTS.md').read_text()
for h in ['MODULE','JOB','INPUTS','OUTPUTS','OWNS','DOES NOT OWN','STATE','COMMANDS','INVARIANTS','FAILURE MODES','EVENTS','TELEMETRY','TESTS','ACCEPTANCE PROOF']:
 if h not in contracts:errors.append('Module field '+h)
result={'baseline':base,'required_authority_files':len(required),'active_files':len(active),'existing_documents_classified_and_preserved':len(docs),'existing_files_modified':len(changed),'new_documents':len(new),'local_active_links':'PASS' if not any('link' in e for e in errors) else 'FAIL','phase_order':phases,'errors':errors,'result':'PASS' if not errors else 'FAIL'}
print(json.dumps(result,indent=2))
raise SystemExit(bool(errors))
```
