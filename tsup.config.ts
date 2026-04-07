import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  dts: false,
  sourcemap: true,
  // Some bundled transitive deps (yoctocolors-cjs) use CJS require()
  // for Node builtins. ESM doesn't have require() by default, so we
  // inject createRequire to make it available.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
})
