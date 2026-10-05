import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkBundle, headingSlugs, parseYaml, splitFrontmatter, trustTier, validateConcept } from '../src/knowledge/okf.mjs';

const concept = (fields = {}, body = '# Title\n') => `---\n${Object.entries({
  type: 'Guide', title: '"Title"', description: '"One sentence."', generated: '{ by: "codex/unknown", at: 2026-09-16T12:00:00Z }', ...fields,
}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}`;
const bundle = files => {
  const root = mkdtempSync(join(tmpdir(), 'okf-'));
  const all = { 'index.md': '---\nokf_version: "0.2"\n---\n# Concepts\n\n* [Title](a.md) - One sentence.\n', 'a.md': concept(), ...files };
  for (const [path, text] of Object.entries(all)) if (text !== null) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
  return root;
};
const errorsFor = (files, options) => {
  const root = bundle(files);
  try { return checkBundle(root, options); } finally { rmSync(root, { recursive: true, force: true }); }
};

test('the repository knowledge bundle conforms to OKF v0.2 and the bundle profile', { skip: !existsSync('knowledge') && 'code-only deployment bundles omit knowledge/' }, () => {
  const result = checkBundle('knowledge', { repoRoot: '.' });
  assert.deepEqual(result.errors, []);
  assert.ok(result.concepts.length > 40);
  assert.ok(result.concepts.every(c => ['unverified', 'machine-confirmed', 'human-reviewed'].includes(c.tier)));
});
test('YAML subset parses scalars, flow collections and block lists of mappings', () => {
  const data = parseYaml([
    'type: Checkpoint Report', 'title: "Phase 1: source contract" # comment', "note: 'it''s quoted'", 'count: 12', 'ratio: -0.5', 'flag: true', 'empty:',
    'tags: [weather, "a, b", \'c\']', 'generated: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }',
    'sources:', '  - id: one', '    resource: "../reports/x.json"', '  - { id: two, resource: https://example.com/a#b }',
    'executor:', '  resource: run.md', '  receipt: [job_id, result]', 'list:', '- plain', '- [1, 2]', 'apostrophe: Owner\'s plan',
  ].join('\n'));
  assert.equal(data.title, 'Phase 1: source contract');
  assert.equal(data.note, "it's quoted");
  assert.equal(data.count, 12); assert.equal(data.ratio, -0.5); assert.equal(data.flag, true); assert.equal(data.empty, null);
  assert.deepEqual(data.tags, ['weather', 'a, b', 'c']);
  assert.deepEqual(data.generated, { by: 'process:documentation-review', at: '2026-09-23T04:16:15Z' });
  assert.deepEqual(data.sources, [{ id: 'one', resource: '../reports/x.json' }, { id: 'two', resource: 'https://example.com/a#b' }]);
  assert.deepEqual(data.executor, { resource: 'run.md', receipt: ['job_id', 'result'] });
  assert.deepEqual(data.list, ['plain', [1, 2]]);
  assert.equal(data.apostrophe, "Owner's plan");
});
test('YAML subset rejects ambiguous or unsupported syntax with line numbers', () => {
  for (const [source, message] of [
    ['title: a: b', /line 1: quote this value/], ['a: 1\na: 2', /duplicate key/], ['a: 1\n  b: 2', /line 2: unexpected indentation/],
    ['text: |\n  more', /block scalars/], ['tags: [a, b', /unclosed flow list/], ['tags: [a, , b]', /empty flow collection entry/],
    ['\tkey: 1', /tabs/], ['just text', /expected "key: value"/], ['x: "bad \\q"', /unsupported escape/], ['x: *alias', /quote this value/],
  ]) assert.throws(() => parseYaml(source), message, source);
  assert.throws(() => splitFrontmatter('---\ntype: Guide\n'), /not closed/);
  assert.equal(splitFrontmatter('# No frontmatter'), null);
});
test('concept validation enforces provenance, trust, lifecycle and footnote attribution', () => {
  const base = { type: 'Guide', title: 'T', description: 'D', generated: { by: 'human:owner', at: '2026-09-16T12:00:00-05:00' } };
  assert.deepEqual(validateConcept(base, '').errors, []);
  const bad = validateConcept({ ...base, type: '', status: 'retired', generated: { by: 'someone', at: '2026-09-16' },
    verified: [{ by: 'process:x' }], sources: [{ id: 'a', resource: 'x' }, { id: 'a', resource: 'y' }, { title: 'no resource' }] }, 'Claim.[^missing]').errors;
  for (const message of [/"type"/, /"status"/, /"generated"/, /"verified"/, /duplicate source id a/, /requires a "resource"/, /\[\^missing\]/])
    assert.ok(bad.some(e => message.test(e)), `${message} in ${bad}`);
  const stale = validateConcept({ ...base, stale_after: '2026-10-01T00:00:00Z' }, '', { now: Date.parse('2026-10-02T00:00:00Z') });
  assert.deepEqual(stale.errors, []); assert.match(stale.warnings[0], /stale since/);
  assert.match(validateConcept({ ...base, type: 'Attested Computation' }, '').errors[0], /runtime/);
  assert.equal(trustTier(base), 'unverified');
  assert.equal(trustTier({ verified: { by: 'process:nightly', at: '2026-09-16T00:00:00Z' } }), 'machine-confirmed');
  assert.equal(trustTier({ verified: [{ by: 'process:nightly' }, { by: 'human:owner' }] }), 'human-reviewed');
});
test('bundle checks cover frontmatter, index and log structure, links and anchors', () => {
  assert.deepEqual(errorsFor({}).errors, []);
  const cases = [
    [{ 'a.md': '# No frontmatter\n' }, /a.md: missing YAML frontmatter/],
    [{ 'a.md': concept({ type: undefined }) }, /non-empty "type"/],
    [{ 'b.md': concept() }, /index.md: does not list b.md/],
    [{ 'index.md': '---\nokf_version: "0.2"\n---\n# Concepts\n\n* [Title](a.md) - Another sentence.\n' }, /description must match/],
    [{ 'index.md': '---\nokf_version: "0.1"\n---\n# Concepts\n\n* [Title](a.md) - One sentence.\n' }, /okf_version: "0.2"/],
    [{ 'index.md': '# Concepts\n\nSome prose.\n* [Title](a.md) - One sentence.\n' }, /only headings/],
    [{ 'sub/x.md': concept() }, /does not list sub\//],
    [{ 'sub/x.md': concept(), 'index.md': '# C\n\n* [Title](a.md) - One sentence.\n* [Sub](sub/) - Nested.\n' }, /sub: missing index.md/],
    [{ 'a.md': concept({}, '# Title\n\nSee [missing](nope.md) and [anchor](#absent).\n') }, /broken link nope.md/],
    [{ 'a.md': concept({}, '# Title\n\nSee [anchor](#absent).\n') }, /missing heading anchor #absent/],
    [{ 'log.md': '# Log\n\n## 2026-09-16\n* Old\n\n## 2026-09-17\n* New\n' }, /newest first/],
    [{ 'log.md': '# Log\n\nUndated entry\n' }, /under a "## YYYY-MM-DD" heading/],
    [{ 'log.md': '# Log\n\n## 2026-02-30\n* Bad date\n' }, /invalid date/],
  ];
  for (const [files, message] of cases) {
    const { errors } = errorsFor(files);
    assert.ok(errors.some(e => message.test(e)), `${message} not in ${JSON.stringify(errors)}`);
  }
  const fenced = errorsFor({ 'a.md': concept({}, '# Title\n\n## Next step — today\n\n[ok](#next-step--today)\n\n```\n[ignored](nope.md)\n```\n`[^code]`\n') });
  assert.deepEqual(fenced.errors, []);
});
test('repository checks keep knowledge out of reports/ and the repository root', () => {
  const repo = mkdtempSync(join(tmpdir(), 'okf-repo-'));
  try {
    const root = bundle({});
    mkdirSync(join(repo, 'reports'));
    writeFileSync(join(repo, 'reports', 'NEW_STATUS.md'), '# Status\n');
    writeFileSync(join(repo, 'NOTES.md'), '# Notes\n');
    writeFileSync(join(repo, 'README.md'), '# Readme\n');
    const { errors } = checkBundle(root, { repoRoot: repo });
    assert.ok(errors.some(e => /reports\/NEW_STATUS.md/.test(e)));
    assert.ok(errors.some(e => /^NOTES.md/.test(e)));
    assert.ok(!errors.some(e => /README/.test(e)));
    rmSync(root, { recursive: true, force: true });
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
test('heading anchors follow GitHub slug rules, including duplicates', () => {
  assert.deepEqual([...headingSlugs('# Completed 24-hour local review — September 17\n## Notes\n## Notes\n```\n# not a heading\n```')],
    ['completed-24-hour-local-review--september-17', 'notes', 'notes-1']);
});
