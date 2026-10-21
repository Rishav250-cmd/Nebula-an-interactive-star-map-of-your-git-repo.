# Test repositories for Nebula

We use these 3 public repos to test every feature. All are JavaScript/TypeScript,
which is what our parser (Babel) supports.
File counts were measured on 21 Oct 2026 using our own `server/ignore.js`
(so they exclude node_modules, dist, build, .git, lock files, minified files and images).

| Size   | Repo | URL | Files after ignore | JS/TS files | Why we picked it |
|--------|------|-----|-------------------:|------------:|------------------|
| Small  | chalk/chalk | https://github.com/chalk/chalk | 32 | 20 | Tiny, fast: use for quick live analysis in the demo |
| Medium | fastify/fastify | https://github.com/fastify/fastify | 391 | 298 | Realistic backend project with real import structure: main Day 4 test repo |
| Large  | facebook/react | https://github.com/facebook/react | 7,079 | 4,456 | Famous, so judges recognise it. Tests our ~2000 file cap and performance |

## Backup repos (if one of the above gives trouble)

| Size   | Repo | URL | Files after ignore | JS/TS files |
|--------|------|-----|-------------------:|------------:|
| Small  | lodash/lodash | https://github.com/lodash/lodash | 94 | 48 |
| Medium | axios/axios | https://github.com/axios/axios | 484 | 277 |
| Large  | vuejs/core | https://github.com/vuejs/core | 699 | 526 |

## Notes
- React is far above the ~2000 file cap in the plan, so it is a good test that the cap and the "show top-level folders first" fallback work.
- Pre-cache fastify and react (Rishav, Day 5) so the live demo never waits on a clone.
