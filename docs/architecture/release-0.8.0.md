# 0.8.0 release checks

What was verified before publishing 0.8.0, how to repeat it, and what was not
verified. What changed is in the [changelog](../../CHANGELOG.md#080).

Checked on 2026-10-29, Windows 11, Node.js 24.22.1, pnpm 10, npm registry as of that day.

## How to repeat

```bash
pnpm install
pnpm build
pnpm test            # unit, integration and type tests, every package
pnpm typecheck
pnpm lint
pnpm --filter @nexo/benchmark-code-to-intent measure
pnpm release:check   # needs network access; see below
```

`pnpm release:check` ([scripts/release-check.mjs](../../scripts/release-check.mjs)) follows the
path a user takes. It packs every package as `npm publish` would, installs the packed
`create-nexo-app`, and generates all four templates with its CLI. It then installs each project
with `npm install`: third-party packages come from the registry, and `@nexo-alpha/*` from the
tarballs. Finally it builds and tests each project, starts it, and checks its HTTP answers. It
exits 1 on the first wrong answer. A deliberately wrong expectation was used to confirm that it fails.

## Results

| Check | Result |
|---|---|
| Build, typecheck, tests (`turbo run build typecheck test --force`) | 60 of 60 tasks pass, none cached |
| Lint | 0 errors; 3 existing warnings in `@nexo-alpha/frontend` (react-hooks) |
| `serve()` unit tests | 9 pass: CRUD, custom store/app/modules, auth, uploads, `.json` store, no file when nothing is stored, SIGINT, failed start |
| `serve()` end to end (`packages/hapi/test/serve-e2e.test.js`) | Passes. Covers every part with a non-default setting, then a restart on the same files |
| Frontend hosting (`frontend-http.test.js`) | 6 pass, including path traversal and dotfiles |
| code-to-intent benchmark | Both variants of all 8 features pass the same conformance tests; app startup 28 → 6 lines, 4 → 1 concepts |
| `pnpm release:check`, all four templates | Passes (details below) |

### Release check, per template

Every generated project asks for `^0.8.0` for each `@nexo-alpha` package.

| Template | Install, build, test | Answers checked |
|---|---|---|
| minimal | install, build | 400 on invalid input, create 201, update 200, delete 204, `GET /` |
| backend-api | install, build | 400 naming `body.title`, create 201, search, `/health` |
| agent-service | install, build, `npm test` | `/health` 200, `/workflows` 401 without a token |
| fullstack-react | install, build (real Vite build) | `/` and `/todos` serve the built `index.html`, the hashed JS bundle, `/api/todos` read and write, all on one port |

Third-party versions installed on 2026-10-29 included `@hapi/hapi` 21.4.12,
`@hapi/inert` 7.1.3, `typescript` 5.9.3, `vite` 5.4.21 and `react` 18.3.1.

## Fixed during the checks

- **`client.resources()` (frontend) answered 404 from every real server.** The cause was code from
  the parallel data-client API that 0.7.0 removed: it built `/users?where[role]=…&cursor=…` URLs.
  A stale test in `packages/data` checked that API against a fake client, which is why the bug
  wasn't caught. `resources()` now returns `client.resource(model)` for each model and is tested
  against a real server. The stale test was removed.
- **Template dependency ranges drifted from the release.** All templates now take the range
  from `create-nexo-app`'s own version, so a generated project always asks for the release that generated it.
- **The minimal template didn't build** (`@hapi/hapi`'s types import `joi`, which isn't
  installed). Its `tsconfig.json` now has `skipLibCheck`, like the other templates.
- **Several processes opening the same new SQLite database at once failed** with "database is
  locked" (found later, while testing migrations under load; commit `1253971`). Opening now sets the
  busy timeout first and retries briefly. A regression test opens one new file from six processes.
  After the fix, build, typecheck and tests (60 of 60) and `pnpm release:check` were run again on
  this branch and pass.

## Not verified

- **Docker images.** The Docker engine wasn't running on the check machine. The full-stack
  Dockerfile copies `backend/dist` and `frontend/dist`, and the backend serves `frontend/dist` when
  it exists, which `npm start` does in the release check. The image itself wasn't built.
- **Ctrl+C in a terminal.** Windows can't send SIGINT to a child process, so shutdown was checked by
  emitting SIGINT inside a child process (`serve.test.js`): the server and app stop and the process exits 0.
- **Other platforms.** Linux and macOS, and Node.js 20 and 22, weren't run. CI covers its own matrix.
- **The npm registry path itself.** Until 0.8.0 is published, `^0.8.0` can't resolve from the
  registry, so the release check installs `@nexo-alpha/*` from tarballs.

## Notes for publishing

- Publish every package together; the templates ask for `^0.8.0` of each one they use.
- `@nexo-alpha/hapi` depends on `@hapi/inert@^7.1.2`. The repository's lockfile has 7.1.2,
  but users get the newest 7.x (7.1.3 at the time of these checks, released on 2026-10-21).
  The release check ran against 7.1.3.
