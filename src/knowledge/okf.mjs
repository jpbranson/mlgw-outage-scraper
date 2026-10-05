// Open Knowledge Format (OKF) v0.2 conformance checks for the knowledge/ bundle, without dependencies.
// Frontmatter uses a YAML subset: key/value lines, quoted or plain scalars, flow lists/maps and block lists of mappings.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const OKF_VERSION = '0.2';
const ACTOR = /^(?:(?:human|process):[\w.@-]+|[\w.-]+\/[\w.-]+)$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const STATUSES = new Set(['draft', 'stable', 'deprecated']);
const RESERVED = new Set(['index.md', 'log.md']);
const REPO_ROOT_DOCUMENTS = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md']);
const LINK = /\[(?:[^\[\]]|\[[^\]]*\])*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const ENTRY = /^[*-] \[((?:[^\[\]]|\[[^\]]*\])*)\]\(([^)\s]+)\)(?: - (.+))?$/;

// ---- YAML subset --------------------------------------------------------------------------------------
const startsQuote = (text, i) => { const prev = text.slice(0, i).trimEnd().slice(-1); return prev === '' || ':-[{,'.includes(prev); };
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === '\\' && quote === '"') i++; else if (c === quote) quote = null; }
    else if ((c === '"' || c === "'") && startsQuote(line, i)) quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}
function splitFlow(inner, where) {
  const parts = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) { if (quote === "'" && inner[i + 1] === "'") i++; else quote = null; }
    } else if ((c === '"' || c === "'") && startsQuote(inner.slice(start), i - start)) quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
  }
  if (quote || depth) throw Error(`${where}: unbalanced flow collection`);
  parts.push(inner.slice(start));
  if (parts.length === 1 && !parts[0].trim()) return [];
  if (parts.some(p => !p.trim())) throw Error(`${where}: empty flow collection entry`);
  return parts.map(p => p.trim());
}
function scalar(text, where) {
  const s = text.trim();
  if (!s) return null;
  if (s[0] === '"') {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(s)) throw Error(`${where}: malformed double-quoted string`);
    try { return JSON.parse(s); } catch { throw Error(`${where}: unsupported escape in double-quoted string`); }
  }
  if (s[0] === "'") {
    if (!/^'(?:[^']|'')*'$/.test(s)) throw Error(`${where}: malformed single-quoted string`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s[0] === '[') {
    if (!s.endsWith(']')) throw Error(`${where}: unclosed flow list`);
    return splitFlow(s.slice(1, -1), where).map(part => scalar(part, where));
  }
  if (s[0] === '{') {
    if (!s.endsWith('}')) throw Error(`${where}: unclosed flow mapping`);
    const out = {};
    for (const part of splitFlow(s.slice(1, -1), where)) {
      const m = part.match(/^([A-Za-z_][\w-]*):(?:\s+([\s\S]*))?$/);
      if (!m) throw Error(`${where}: expected "key: value" in flow mapping`);
      if (Object.hasOwn(out, m[1])) throw Error(`${where}: duplicate key ${m[1]}`);
      out[m[1]] = scalar(m[2] ?? '', where);
    }
    return out;
  }
  if (/^[|>]/.test(s)) throw Error(`${where}: block scalars are not supported`);
  if (/^[&*!%@`\]}]/.test(s) || /^[-?:](?:\s|$)/.test(s) || /:\s|:$/.test(s)) throw Error(`${where}: quote this value`);
  if (s === 'true' || s === 'false') return s === 'true';
  if (s === 'null' || s === '~') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)) return Number(s);
  return s;
}
const isItem = line => line.text === '-' || line.text.startsWith('- ');
export function parseYaml(source, firstLine = 1) {
  const lines = [];
  source.split(/\r?\n/).forEach((raw, k) => {
    if (/\t/.test(raw.match(/^\s*/)[0])) throw Error(`line ${firstLine + k}: indent with spaces, not tabs`);
    const text = stripComment(raw);
    if (text.trim()) lines.push({ indent: text.length - text.trimStart().length, text: text.trim(), no: firstLine + k });
  });
  let i = 0;
  const at = line => `line ${line.no}`;
  const deeper = indent => { if (i < lines.length && lines[i].indent > indent) throw Error(`${at(lines[i])}: unexpected indentation`); };
  const block = indent => isItem(lines[i]) ? sequence(indent) : mapping(indent);
  function mapping(indent) {
    const out = {};
    while (i < lines.length && lines[i].indent === indent && !isItem(lines[i])) {
      const line = lines[i], m = line.text.match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
      if (!m) throw Error(`${at(line)}: expected "key: value"`);
      if (Object.hasOwn(out, m[1])) throw Error(`${at(line)}: duplicate key ${m[1]}`);
      i++;
      if (m[2] !== undefined) out[m[1]] = scalar(m[2], at(line));
      else if (i < lines.length && (lines[i].indent > indent || (lines[i].indent === indent && isItem(lines[i])))) out[m[1]] = block(lines[i].indent);
      else out[m[1]] = null;
    }
    deeper(indent);
    return out;
  }
  function sequence(indent) {
    const out = [];
    while (i < lines.length && lines[i].indent === indent && isItem(lines[i])) {
      const line = lines[i], rest = line.text.slice(1).trimStart();
      if (!rest) { i++; out.push(i < lines.length && lines[i].indent > indent ? block(lines[i].indent) : null); }
      else if (/^[A-Za-z_][\w-]*:(?:\s|$)/.test(rest)) {
        const inner = indent + line.text.length - rest.length;
        lines[i] = { ...line, indent: inner, text: rest };
        out.push(mapping(inner));
      } else { i++; out.push(scalar(rest, at(line))); }
    }
    deeper(indent);
    return out;
  }
  if (!lines.length) return {};
  if (lines[0].indent) throw Error(`${at(lines[0])}: unexpected indentation`);
  const data = mapping(0);
  if (i < lines.length) throw Error(`${at(lines[i])}: unexpected content`);
  return data;
}
export function splitFrontmatter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) throw Error('frontmatter is not closed by a --- line');
  return { yaml: lines.slice(1, end).join('\n'), body: lines.slice(end + 1).join('\n'), bodyLine: end + 2 };
}

// ---- Markdown helpers ----------------------------------------------------------------------------------
function proseLines(body) {
  let fence = null;
  return body.split(/\r?\n/).map(line => {
    const marker = line.match(/^\s*(```|~~~)/)?.[1];
    if (marker && (!fence || fence === marker)) { fence = fence ? null : marker; return ''; }
    return fence ? '' : line;
  });
}
export const slugify = text => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
export function headingSlugs(body) {
  const counts = new Map(), slugs = new Set();
  for (const line of proseLines(body)) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const base = slugify(m[1]), n = counts.get(base) ?? 0;
    counts.set(base, n + 1); slugs.add(n ? `${base}-${n}` : base);
  }
  return slugs;
}
function links(body, firstLine) {
  const out = [];
  proseLines(body).forEach((line, k) => { for (const m of line.replace(/`[^`]*`/g, '').matchAll(LINK)) out.push({ href: m[1], line: firstLine + k }); });
  return out;
}
const footnotes = body => new Set(proseLines(body).join('\n').replace(/`[^`]*`/g, '').match(/\[\^[^\]\s]+\]/g)?.map(f => f.slice(2, -1)));
export function trustTier(data) {
  const events = [data.verified ?? []].flat().filter(Boolean);
  return !events.length ? 'unverified' : events.some(v => String(v.by).startsWith('human:')) ? 'human-reviewed' : 'machine-confirmed';
}

// ---- Concept validation ----------------------------------------------------------------------------------
const isText = value => typeof value === 'string' && value.trim() !== '';
const isTime = value => typeof value === 'string' && DATETIME.test(value) && Number.isFinite(Date.parse(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateConcept(data, body, { now = Date.now() } = {}) {
  const errors = [], warnings = [], need = (ok, message) => { if (!ok) errors.push(message); };
  need(isText(data.type), 'frontmatter requires a non-empty "type"');
  need(isText(data.title), 'frontmatter requires a non-empty "title"');
  need(isText(data.description), 'frontmatter requires a one-line "description"');
  if (data.tags !== undefined) need(Array.isArray(data.tags) && data.tags.every(isText), '"tags" must be a list of strings');
  if (data.status !== undefined) need(STATUSES.has(data.status), '"status" must be draft, stable or deprecated');
  if (data.resource !== undefined) need(isText(data.resource), '"resource" must be a path or URI');
  const generated = data.generated;
  need(isObject(generated) && isText(generated.by) && ACTOR.test(generated.by) && isTime(generated.at),
    '"generated" requires { by: <actor>, at: <ISO 8601 datetime with offset> }');
  if (data.verified !== undefined) for (const event of [data.verified].flat())
    need(isObject(event) && isText(event.by) && ACTOR.test(event.by) && isTime(event.at), '"verified" entries require { by: <actor>, at: <datetime> }');
  if (data.stale_after !== undefined) {
    need(isTime(data.stale_after), '"stale_after" must be an ISO 8601 datetime with offset');
    if (isTime(data.stale_after) && now >= Date.parse(data.stale_after)) warnings.push(`stale since ${data.stale_after}`);
  }
  const window = value => isObject(value) && isTime(value.from) && isTime(value.to);
  if (data.usage_window !== undefined) need(window(data.usage_window), '"usage_window" requires { from, to } datetimes');
  const ids = new Set();
  if (data.sources !== undefined) {
    need(Array.isArray(data.sources), '"sources" must be a list');
    for (const source of [data.sources].flat()) {
      if (!isObject(source) || !isText(source.resource)) { errors.push('each "sources" entry requires a "resource"'); continue; }
      if (source.id !== undefined) {
        need(typeof source.id === 'string' && /^[\w.-]+$/.test(source.id), `source id ${source.id} must be a simple identifier`);
        need(!ids.has(source.id), `duplicate source id ${source.id}`); ids.add(source.id);
      }
      if (source.last_modified !== undefined) need(isTime(source.last_modified), `source ${source.id ?? source.resource}: "last_modified" must be a datetime`);
      if (source.usage_count !== undefined) need(Number.isInteger(source.usage_count) && source.usage_count >= 0, `source ${source.id ?? source.resource}: "usage_count" must be a non-negative integer`);
      if (source.usage_window !== undefined) need(window(source.usage_window), `source ${source.id ?? source.resource}: "usage_window" requires { from, to }`);
    }
  }
  for (const label of footnotes(body)) need(ids.has(label), `footnote [^${label}] does not match a sources id`);
  if (data.type === 'Attested Computation') {
    need(isText(data.runtime), 'Attested Computation requires "runtime"');
    if (data.parameters !== undefined) need(Array.isArray(data.parameters) && data.parameters.every(p => isObject(p) && isText(p.name)), '"parameters" entries require a name');
    for (const key of ['executor', 'attester']) if (data[key] !== undefined) need(isObject(data[key]) && isText(data[key].resource), `"${key}" requires a resource`);
  }
  return { errors, warnings };
}

// ---- Bundle validation ------------------------------------------------------------------------------------
function walk(dir, dirs, files) {
  dirs.push(dir);
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, dirs, files); else if (entry.name.endsWith('.md')) files.push(path);
  }
}
export function checkBundle(bundleDir, { now = Date.now(), repoRoot = null } = {}) {
  const root = resolve(bundleDir), dirs = [], files = [], errors = [], warnings = [], docs = new Map();
  if (!existsSync(root) || !statSync(root).isDirectory()) return { errors: [`${bundleDir}: bundle directory not found`], warnings, concepts: [] };
  walk(root, dirs, files);
  const rel = path => relative(root, path).split(sep).join('/') || '.';
  const fail = (path, message) => errors.push(`${rel(path)}: ${message}`);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    let fm;
    try { fm = splitFrontmatter(text); } catch (error) { fail(file, error.message); docs.set(file, { body: text, bodyLine: 1 }); continue; }
    const doc = { body: fm ? fm.body : text, bodyLine: fm ? fm.bodyLine : 1, fm };
    docs.set(file, doc);
    if (RESERVED.has(basename(file))) continue;
    if (!fm) { fail(file, 'missing YAML frontmatter'); continue; }
    try { doc.data = parseYaml(fm.yaml, 2); } catch (error) { fail(file, `frontmatter ${error.message}`); continue; }
    const result = validateConcept(doc.data, doc.body, { now });
    result.errors.forEach(message => fail(file, message));
    result.warnings.forEach(message => warnings.push(`${rel(file)}: ${message}`));
    const resource = doc.data.resource;
    if (isText(resource) && !/^[a-z][\w+.-]*:/i.test(resource) && !existsSync(resolve(dirname(file), resource))) warnings.push(`${rel(file)}: resource ${resource} not found`);
  }
  const slugCache = new Map(), slugsOf = path => {
    if (!slugCache.has(path)) slugCache.set(path, headingSlugs(docs.get(path)?.body ?? readFileSync(path, 'utf8')));
    return slugCache.get(path);
  };
  for (const [file, doc] of docs) for (const { href, line } of links(doc.body, doc.bodyLine)) {
    if (/^[a-z][\w+.-]*:/i.test(href)) continue;
    const [path, anchor] = href.split('#'), target = path ? resolve(dirname(file), decodeURI(path)) : file;
    if (!existsSync(target)) { fail(file, `line ${line}: broken link ${href}`); continue; }
    if (anchor && target.endsWith('.md') && statSync(target).isFile() && !slugsOf(target).has(decodeURIComponent(anchor))) fail(file, `line ${line}: missing heading anchor ${href}`);
  }
  for (const dir of dirs) checkIndex(dir, dir === root, docs, fail);
  for (const file of files) if (basename(file) === 'log.md') checkLog(file, docs.get(file), fail);
  if (repoRoot) {
    const top = resolve(repoRoot);
    for (const name of readdirSync(top)) if (name.endsWith('.md') && !REPO_ROOT_DOCUMENTS.has(name)) errors.push(`${name}: project knowledge belongs in ${bundleDir} (see maintaining-this-bundle.md)`);
    const reports = join(top, 'reports');
    if (existsSync(reports)) for (const name of readdirSync(reports)) if (name.endsWith('.md')) errors.push(`reports/${name}: reports/ holds machine evidence only; add knowledge to ${bundleDir}`);
  }
  const concepts = [...docs].filter(([, doc]) => doc.data).map(([file, doc]) => ({
    path: rel(file), type: doc.data.type, status: doc.data.status ?? 'stable', tier: trustTier(doc.data),
    stale: isTime(doc.data.stale_after) && now >= Date.parse(doc.data.stale_after) }));
  return { errors, warnings, concepts };
}
function checkIndex(dir, isRoot, docs, fail) {
  const index = join(dir, 'index.md'), doc = docs.get(index);
  if (!doc) { fail(dir, 'missing index.md'); return; }
  if (doc.fm) {
    let data;
    try { data = parseYaml(doc.fm.yaml, 2); } catch (error) { fail(index, `frontmatter ${error.message}`); return; }
    if (!isRoot) fail(index, 'only the bundle-root index.md may have frontmatter');
    else if (Object.keys(data).some(key => key !== 'okf_version') || data.okf_version !== OKF_VERSION) fail(index, `root index.md frontmatter may only declare okf_version: "${OKF_VERSION}"`);
  }
  const listed = new Map();
  let heading = false;
  doc.body.split(/\r?\n/).forEach((line, k) => {
    const at = `line ${doc.bodyLine + k}`;
    if (!line.trim()) return;
    if (/^#{1,6} \S/.test(line)) { heading = true; return; }
    const m = line.match(ENTRY);
    if (!m) { fail(index, `${at}: index files contain only headings and "* [Title](link) - description" entries`); return; }
    if (!heading) fail(index, `${at}: entries must follow a section heading`);
    if (/^[a-z][\w+.-]*:/i.test(m[2])) { fail(index, `${at}: index entries must link within the bundle`); return; }
    let target = resolve(dir, decodeURI(m[2]));
    if (basename(target) === 'index.md' && target !== index) target = dirname(target);
    if (dirname(target) !== dir || !existsSync(target)) { fail(index, `${at}: ${m[2]} is not a concept or subdirectory of this directory`); return; }
    if (listed.has(target)) fail(index, `${at}: ${m[2]} is listed twice`);
    listed.set(target, true);
    const data = docs.get(target)?.data;
    if (data) {
      if (m[1] !== data.title) fail(index, `${at}: entry title must match the concept title "${data.title}"`);
      if (m[3] !== data.description) fail(index, `${at}: entry description must match the concept description "${data.description}"`);
    } else if (!m[3]) fail(index, `${at}: entry needs a " - description"`);
  });
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || RESERVED.has(entry.name) || !(entry.isDirectory() || entry.name.endsWith('.md'))) continue;
    if (!listed.has(join(dir, entry.name))) fail(index, `does not list ${entry.name}${entry.isDirectory() ? '/' : ''}`);
  }
}
function checkLog(file, doc, fail) {
  let title = false, previous = null;
  doc.body.split(/\r?\n/).forEach((line, k) => {
    const at = `line ${doc.bodyLine + k}`;
    if (!line.trim()) return;
    if (!title) { if (/^# \S/.test(line)) title = true; else fail(file, `${at}: log.md starts with a "# " title`); return; }
    const date = line.match(/^## (\d{4}-\d{2}-\d{2})$/);
    if (date) {
      if (!Number.isFinite(Date.parse(`${date[1]}T00:00:00Z`)) || new Date(`${date[1]}T00:00:00Z`).toISOString().slice(0, 10) !== date[1]) fail(file, `${at}: invalid date ${date[1]}`);
      else if (previous && date[1] >= previous) fail(file, `${at}: date headings must be unique and newest first`);
      previous = date[1];
    } else if (!previous) fail(file, `${at}: entries belong under a "## YYYY-MM-DD" heading`);
    else if (!/^(?:[*-] |\s{2,}\S)/.test(line)) fail(file, `${at}: log entries are list items`);
  });
}
