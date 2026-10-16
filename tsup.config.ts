import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  clean: true,
  noExternal: true, // This forces tsup to bundle all dependencies into one file
  sourcemap: true,
  minify: false,
});
