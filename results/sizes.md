
> solid-server-components-benchmarks@ sizes /home/claude/solid-server-component-benchmarks
> pnpm --filter sizes measure


> sizes@ measure /home/claude/solid-server-component-benchmarks/sizes
> node measure.mjs

| Entry | Eager JS (brotli) | Minified | Lazy, not counted (brotli) |
| --- | ---: | ---: | ---: |
| 1-csr | 13.4 KB | 37.1 KB | 0.0 KB |
| 2-hydrating | 18.4 KB | 53.5 KB | 0.0 KB |
| 3-hydrating-server-functions | 22.2 KB | 65.5 KB | 6.9 KB |
| 4-server-components | 33.3 KB | 101.5 KB | 21.5 KB |
