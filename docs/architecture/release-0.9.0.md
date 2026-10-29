# 0.9.0 release checks

What was verified before releasing 0.9.0 (migrations), how to repeat it, and what wasn't
verified. Branch `feat/migrations`, which includes all of 0.8.0. 0.8.0 should be published
first, from `feat/full-stack-0.7`; see [release-0.8.0.md](./release-0.8.0.md).

## How to repeat

```bash
pnpm install
pnpm build
npx turbo run build typecheck test --force
pnpm lint
pnpm release:check
```

## Results

| Check | Result |
|---|---|
| Build, typecheck, tests (`turbo run build typecheck test --force`) | 60 of 60 tasks pass, none cached |
| Lint | 0 errors; the 3 existing warnings in `@nexo-alpha/frontend` (react-hooks) |
| `pnpm release:check`, all four templates | Passes. Generated projects ask for `^0.9.0`. In `backend-api` it also creates a migration with the installed CLI, builds it, checks `plan`, restarts the app so `serve()` applies it, and checks `status`, `check` and the migrated record over HTTP |

Migration tests, each run against the memory, JSON file and SQLite stores where it applies
(the design's §13 acceptance tests):

| File | Tests | Covers |
|---|---|---|
| `core/test/migrations.test.js` | 25 | ids and validation, records, order, edits, the lock; two processes migrating one SQLite file |
| `core/test/write-batch.test.js` | 19 | all-or-nothing writes, including a SQLite trigger failing mid-transaction and a failed file rename |
| `core/test/migration-run.test.js` | 34 | rename, type change and new required field on real records; failures, conflicts, plan, production approval, `maxChanges`, `down`, `perProject` |
| `core/test/migration-backup.test.js` | 12 | backups taken and checked, restore gives back the same documents, failed backups stop the run, retention, damaged copies |
| `core/test/migration-files.test.js` | 18 | uploaded files released in the same batch, removed only by cleanup after its delay, kept when taken back |
| `core/test/migration-nexo.test.js` | 4 | Nexo's own migrations from modules: run first, recorded with their package, protected from the app |
| `hapi/test/serve-migrations.test.js` | 5 | `serve({ migrations })`: applied before listening; a failure leaves the port free |
| `cli/test/migrate.test.js` | 9 | every `nexo migrate` command through the real binary |

Several tests were checked to fail when the thing they guard is removed: the two-process test
without the lock, the file-release tests without the release writes (12 of 18 failed), and the
concurrent SQLite open test without its fix (2 runs in 5 failed).

## Not verified

- Linux and macOS: everything ran on Windows 11 with Node 24.
- Docker images.
- Migrations on large collections: the tests use small ones. One migration is limited to
  `maxChanges` (100,000) documents, held in memory while it is computed.
- Restoring a backup by hand on a production server; the restore path is tested on temporary files.

## Notes for publishing

- Publish 0.8.0 first. This branch merges `feat/full-stack-0.7` (including the SQLite fix), so
  0.9.0 contains everything in 0.8.0.
- Publish every package together: the templates ask for `^0.9.0` of each.
