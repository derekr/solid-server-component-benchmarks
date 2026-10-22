
> solid-server-components-benchmarks@ sizes /tmp/claude-0/-home-claude-solid/02161daa-5f89-56d6-b825-ff44d709d37e/scratchpad/sc-benchmarks
> pnpm --filter sizes measure


> sizes@ measure /tmp/claude-0/-home-claude-solid/02161daa-5f89-56d6-b825-ff44d709d37e/scratchpad/sc-benchmarks/sizes
> node measure.mjs

| Entry | Eager JS (brotli) | Minified | Lazy, not counted (brotli) |
| --- | ---: | ---: | ---: |
| 1-csr | 13.3 KB | 37.3 KB | 0.0 KB |
| 2-hydrating | 18.4 KB | 53.6 KB | 0.0 KB |
| 3-hydrating-server-functions | 22.2 KB | 65.6 KB | 6.1 KB |
| 4-server-components | 33.3 KB | 101.6 KB | 20.0 KB |
