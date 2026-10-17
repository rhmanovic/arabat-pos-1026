// Guards the shared selling rules (ADR-0112): `@arabat/pos-core` and everything it imports must
// bundle for a browser / web view. Node built-ins, NestJS, database drivers or any other
// server-only module make this fail, so they can never slip into the device contract.
import { build } from 'esbuild';

const FORBIDDEN = [/^@nestjs\//, /^drizzle-orm/, /^pg$/, /^fastify/, /^socket\.io/];

const result = await build({
  entryPoints: ['packages/pos-core/src/index.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  conditions: ['source'],
  write: false,
  metafile: true,
  logLevel: 'silent',
  plugins: [
    {
      name: 'server-only-guard',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (args.path.startsWith('node:') || FORBIDDEN.some((re) => re.test(args.path)))
            return { errors: [{ text: `server-only import "${args.path}" in ${args.importer}` }] };
          return undefined;
        });
      },
    },
  ],
}).catch((error) => {
  for (const e of error.errors ?? []) console.error(`pos-core browser check: ${e.text}`);
  process.exit(1);
});

const inputs = Object.keys(result.metafile.inputs);
const bytes = result.outputFiles[0].contents.length;
console.log(`pos-core bundles for the browser: ${inputs.length} modules, ${bytes} bytes`);
