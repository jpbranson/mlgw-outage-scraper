import { checkBundle } from '../src/knowledge/okf.mjs';

const bundle = process.argv[2] ?? 'knowledge', result = checkBundle(bundle, { repoRoot: '.' });
for (const warning of result.warnings) console.warn(`warning: ${warning}`);
for (const error of result.errors) console.error(`error: ${error}`);
const count = key => Object.entries(Object.groupBy(result.concepts, c => c[key])).map(([name, list]) => `${list.length} ${name}`).join(', ');
console.log(`${bundle}: ${result.concepts.length} concepts (${count('type')})`);
console.log(`trust: ${count('tier')}; status: ${count('status')}; stale: ${result.concepts.filter(c => c.stale).map(c => c.path).join(', ') || 'none'}`);
console.log(result.errors.length ? `${result.errors.length} errors` : 'OKF v0.2 conformance and bundle profile checks passed');
if (result.errors.length) process.exitCode = 1;
