import { build } from 'esbuild';
// Bundle application dependencies too: Next standalone tracing omits worker-only imports.
// Prisma remains external so its generated client and native engine retain their paths.
await build({
  entryPoints: { worker: 'scripts/queue/worker.ts', beat: 'scripts/queue/beat.ts' },
  outdir: 'dist', bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  external: ['@prisma/client', 'next', 'next/*', 'sharp'],
  plugins: [{ name: 'server-boundary', setup(builder) {
    builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'empty' }));
    builder.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' }));
  } }],
  logLevel: 'info',
});
