// Vitest resolves `server-only` here (see vitest.config.ts). The real package's
// default entry throws by design — it is a marker that only makes sense inside
// Next's `react-server` module graph, where it resolves to a no-op. Under a plain
// node test runner there is no such graph, so we stub it to nothing. This does not
// weaken the guarantee: `next build` still resolves the real package and fails if
// a Client Component ever imports a `server-only` module.
export {};
