# 11 — Testing

## Framework

- **Vitest** for unit and route tests; **Supertest** for HTTP-level route tests.
- Config: `apps/api` `package.json` → `"test": "vitest run"`.
- Run all: `npm test -w @midtransport/api` (or `cd apps/api && npx vitest run`).
- Run one file: `cd apps/api && npx vitest run tests/importEngine/suggest.test.ts`.
- Watch mode while developing: `cd apps/api && npx vitest`.

> Environment note: on some Node/npm combinations `npx vitest` can fail at the npm layer (an unrelated minizlib issue). Running the binary directly works: `./node_modules/.bin/vitest run`.

## Layout

```
apps/api/tests/
├── sanity.test.ts
├── importEngine/            Pure engine unit tests
│   ├── suggest.test.ts      Column auto-match
│   ├── mapping.test.ts      columnMap → canonical row
│   ├── validate.test.ts     Validation rules/issues
│   ├── profiles.test.ts     detectProfile
│   ├── canonical.test.ts    Field defs / target validity
│   ├── datetime.test.ts     Date/time parsing
│   ├── encoding.test.ts     Decoding
│   ├── csvParse.test.ts     CSV structure
│   ├── normalize.test.ts    Value normalization
│   └── pipeline.test.ts     End-to-end engine pipeline
├── routes/                  HTTP tests (Supertest)
│   ├── importPermissions.test.ts
│   ├── importInline.test.ts
│   ├── importJobsCsv.test.ts
│   └── tripsCanonical.test.ts
├── importRunner.test.ts
└── importRunner.execute.test.ts
```

Current baseline: **122 tests across 18 files** (green on `main`).

## Conventions

- **Prefer pure-engine unit tests.** The `importEngine/` modules are pure functions — test behavior directly with representative inputs (see `suggest.test.ts` for the style: real vendor-style headers, explicit expectations, edge cases like ambiguous/duplicate inputs).
- **Test behavior, not mocks.** Assert on real outputs. Route tests exercise the actual Express app.
- **TDD for new engine/logic work** — write the failing test first, watch it fail, implement, watch it pass (this is how the auto-match feature was built).
- **One-to-one / edge coverage** — for matchers and validators, include ambiguous, empty, and duplicate inputs, not just the happy path.

## Adding tests

- New engine module → add `apps/api/tests/importEngine/<name>.test.ts` importing from `../../src/services/importEngine/<name>`.
- New endpoint → add `apps/api/tests/routes/<name>.test.ts` using Supertest against the exported `app` (`apps/api/src/app.ts`), covering auth/role gating and validation failures.

## Type & build checks

- API: `cd apps/api && npx tsc --noEmit` (or `npm run build`).
- Web: `cd apps/web && npx tsc --noEmit`.
- Run both plus the test suite before opening a PR — CI parity is: API tests green + both projects type-check clean.
