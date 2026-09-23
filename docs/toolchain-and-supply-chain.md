# Toolchain and supply-chain policy

This is the E0.5 record of which toolchain versions Krateasy supports, how each is
pinned, and how it may change. A version is supported only if the hosted release
gate (`.github/workflows/ci.yml`) passes on it.

## Supported versions

| Component | Supported version | Pinned by | Verified by |
|---|---|---|---|
| Node.js | 24.21.0 | `.nvmrc`; `node:24.21.0-bookworm-slim` in `deployment/Dockerfile` | CI `check`, `container`, `postgres-check` |
| npm | The npm bundled with the pinned Node.js | `package-lock.json` (lockfile v3) and `npm ci` | CI `check` |
| TypeScript and dev tools | As resolved by `package-lock.json` | `package-lock.json` | CI `check` |
| Production npm packages | As resolved by `package-lock.json` | `package-lock.json` | CI `check`; `npm audit --omit=dev` |
| Python (CI) | 3.11 | `actions/setup-python` | CI `check` |
| Python (runtime) | Debian bookworm `python3` (3.11) | Base image | CI `container` |
| OR-Tools CP-SAT | 9.15.6755 | `solver/requirements-cp-sat.txt`, `CP_SAT_BACKEND_VERSION`; the worker refuses any other version | CI `check` and in-image readiness probe |
| Solver Python dependencies | Exact versions | `packages/competition-engine/solver/constraints-cp-sat.txt` | CI `check`, `container` |
| PostgreSQL | 16 | `postgres:16` service in CI | CI `postgres-check` |
| Swift | Swift 6 toolchain (`swift-tools-version: 6.0`) on the `macos-15` runner's default Xcode | `apps/apple-client/Package.swift`; runner label | CI `apple` |
| GitHub Actions | Exact commits, with the release tag in a comment | `.github/workflows/ci.yml` | CI |

## Pinning rules

1. **Application dependencies** are installed only with `npm ci` from the committed
   lockfile. A runtime import must be declared by the package that imports it
   (E0.2), and `npm audit --omit=dev` must report no vulnerabilities.
2. **The solver** is pinned exactly: the OR-Tools version and every transitive Python
   package. OR-Tools, `CP_SAT_BACKEND_VERSION`, both requirement files and the image
   move together in one change, with the in-image readiness probe passing.
3. **Node.js** is pinned to an exact release in `.nvmrc` and in the base image tag,
   so CI and production run the same runtime.
4. **GitHub Actions** are pinned to full commit hashes, never to movable tags, and
   checkout does not leave credentials in the workspace.
5. **Container images** are pinned by tag. **Not yet pinned by digest:** the Node base
   image and the `postgres:16` CI service. Digest pinning is the next tightening; it
   needs registry access from the environment that makes the change.

## Updating a version

- Change one component per pull request, and state the reason (security fix, end of
  support, or a needed capability).
- Keep CI green on the change, including the container smoke test and, for the
  solver, its in-image readiness probe.
- Security fixes to production dependencies are applied as soon as they are
  available. Other updates are reviewed at least once a quarter.
- Node.js stays on an Active or Maintenance LTS line. Move to the next LTS before
  the current one leaves support.
- After changing production dependencies, regenerate `NOTICE`. Every production
  dependency must be under a licence compatible with proprietary distribution; the
  current set is MIT, ISC, BSD, Apache-2.0, PSF-2.0, 0BSD, Zlib and CC0-1.0.

## Release evidence

Each CI run keeps its evidence as build artifacts:

- `check-evidence`: JUnit test results (`test-results.xml`) and the protocol model
  check proof (`protocol-model-check.json`).
- `container-evidence`: the container smoke output, including the CP-SAT readiness
  probe, and the image metadata (`image-inspect.json`).

This is hosted CI evidence for the exact commit. It is not production, pilot or field
evidence (see the evidence vocabulary in `docs/AI_AGENT_IMPLEMENTATION_BRIEF.md`).

## Licence

Krateasy is proprietary; see `LICENSE`. Third-party components keep their own
licences; see `NOTICE`.
