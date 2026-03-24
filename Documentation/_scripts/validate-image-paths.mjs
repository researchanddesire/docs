#!/usr/bin/env node
/**
 * Validates that every image referenced in MDX exists locally under Documentation/
 * or returns HTTP 200 on production (https://docs.researchanddesire.com).
 *
 * Usage (from Documentation/):
 *   node ./_scripts/validate-image-paths.mjs
 *   node ./_scripts/validate-image-paths.mjs --skip-remote
 *   node ./_scripts/validate-image-paths.mjs --fix   # interactive: suggest nearest path by cosine similarity
 *
 * With --fix: for each broken reference, ranks matches by path cosine similarity.
 * If the path matches exactly except for the image extension (e.g. .jpg vs .webp),
 * that is always treated as a 100% match and the existing file on disk is used.
 * Only candidates with score > 75% are listed; you can pick one or "None" to skip
 * (error remains for the next run). Non-TTY prints a hint only if the best match
 * is above 75%.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { select } from '@inquirer/prompts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOC_ROOT = resolve(__dirname, '..');
const PRODUCTION_BASE = 'https://docs.researchanddesire.com';
const PRODUCTION_HOSTS = new Set(['docs.researchanddesire.com', 'www.docs.researchanddesire.com']);

const IGNORE_DIRS = new Set(['_scripts', '_archive', 'node_modules', '.git', 'snippets']);

const IMAGE_EXT = /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;

/** Only show fix candidates with cosine score strictly above this (0–1). */
const MIN_FIX_CONFIDENCE = 0.75;

/** @type {Map<string, boolean>} */
const remoteOkCache = new Map();

const argSet = new Set(process.argv.slice(2));
const skipRemote = argSet.has('--skip-remote');
const fixMode = argSet.has('--fix');
const isTTY = process.stdin.isTTY && process.stdout.isTTY;

/**
 * @param {string} dir
 * @param {string[]} out
 */
function collectMdxFiles(dir, out) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      collectMdxFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      out.push(full);
    }
  }
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
function collectImageFiles(dir, out) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      collectImageFiles(full, out);
    } else if (entry.isFile() && IMAGE_EXT.test(entry.name)) {
      out.push(full);
    }
  }
}

/**
 * @param {string} content
 * @returns {Array<{ raw: string; line: number }>}
 */
function extractImageRefs(content) {
  /** @type {Array<{ raw: string; line: number }>} */
  const refs = [];

  const pushRef = (raw, indexInFile) => {
    const line = content.slice(0, indexInFile).split('\n').length;
    refs.push({ raw: raw.trim(), line });
  };

  const imgRe = /<(?:img|Image)\s+[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = imgRe.exec(content)) !== null) {
    pushRef(m[1], m.index);
  }

  const mdRe = /!\[[^\]]*\]\(([^)]+)\)/g;
  while ((m = mdRe.exec(content)) !== null) {
    let p = m[1].trim();
    if (p.startsWith('<') && p.endsWith('>')) {
      p = p.slice(1, -1).trim();
    }
    pushRef(p, m.index);
  }

  return refs;
}

/**
 * @param {string} raw
 */
function shouldValidateRef(raw) {
  const lower = raw.toLowerCase();
  if (lower.startsWith('mailto:') || lower.startsWith('data:')) return false;
  if (raw.startsWith('#')) return false;
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const u = new URL(raw);
      return PRODUCTION_HOSTS.has(u.hostname);
    } catch {
      return false;
    }
  }
  const pathPart = raw.split('#')[0].split('?')[0];
  if (IMAGE_EXT.test(pathPart)) return true;
  if (pathPart.includes('/_images/') || pathPart.includes('\\_images\\')) return true;
  if (/\/images\//i.test(pathPart)) return true;
  return false;
}

/**
 * @param {string} raw
 * @param {string} mdxDir
 */
function resolveLocalPath(raw, mdxDir) {
  const noHash = raw.split('#')[0].split('?')[0];
  if (noHash.startsWith('http://') || noHash.startsWith('https://')) {
    return null;
  }
  if (noHash.startsWith('/')) {
    return resolve(DOC_ROOT, noHash.slice(1));
  }
  return resolve(mdxDir, noHash);
}

/**
 * @param {string} localPath
 */
function toProductionUrl(localPath) {
  const rel = relative(DOC_ROOT, localPath);
  if (rel.startsWith('..') || rel === '') return null;
  const posix = rel.split(sep).join('/');
  return `${PRODUCTION_BASE}/${posix}`;
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
function pathStringForSimilarity(raw) {
  const noHash = raw.split('#')[0].split('?')[0];
  if (noHash.startsWith('http://') || noHash.startsWith('https://')) {
    try {
      const u = new URL(noHash);
      return u.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  }
  if (noHash.startsWith('/')) {
    return noHash.replace(/^\/+/, '');
  }
  return noHash.replace(/^\.?\//, '');
}

/**
 * @param {string} s
 * @returns {Map<string, number>}
 */
function pathToTermVector(s) {
  const normalized = s.toLowerCase().replaceAll('\\', '/');
  const parts = normalized.split(/[/\s._-]+/).filter(Boolean);
  const vec = new Map();
  for (const p of parts) {
    vec.set(p, (vec.get(p) || 0) + 1);
  }
  return vec;
}

/**
 * Cosine similarity between two path strings (tokenized by segments and punctuation).
 * @param {string} a
 * @param {string} b
 */
function cosineSimilarityPaths(a, b) {
  const va = pathToTermVector(a);
  const vb = pathToTermVector(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of va.values()) na += v * v;
  for (const v of vb.values()) nb += v * v;
  const keys = new Set([...va.keys(), ...vb.keys()]);
  for (const k of keys) {
    const ca = va.get(k) || 0;
    const cb = vb.get(k) || 0;
    dot += ca * cb;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Normalize path for comparison (slashes, case, no leading slash).
 * @param {string} p
 */
function normalizePathForExtCompare(p) {
  return p.toLowerCase().replaceAll('\\', '/').replace(/^\/+/, '');
}

/**
 * Strip trailing image extension from a full relative path (e.g. foo/bar.jpg → foo/bar).
 * @param {string} p
 */
function stripTrailingImageExt(p) {
  return p.replace(/\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i, '');
}

/**
 * True when paths are identical except for the image file extension (e.g. .jpg vs .webp).
 * @param {string} a
 * @param {string} b
 */
function pathsEqualExceptImageExtension(a, b) {
  const na = stripTrailingImageExt(normalizePathForExtCompare(a));
  const nb = stripTrailingImageExt(normalizePathForExtCompare(b));
  return na.length > 0 && na === nb;
}

/**
 * If `absPath` does not exist but another image in the same directory has the same
 * basename stem (e.g. photo.jpg vs photo.webp), return that existing file path.
 * @param {string} absPath
 * @returns {string | null}
 */
function findExistingImageSameStemDifferentExt(absPath) {
  if (existsSync(absPath)) return absPath;
  const dir = dirname(absPath);
  const ext = extname(absPath);
  if (!IMAGE_EXT.test(ext)) return null;
  const stem = basename(absPath, ext);
  if (!existsSync(dir)) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isFile() || !IMAGE_EXT.test(e.name)) continue;
    const base = basename(e.name);
    const fileStem = extname(base) ? base.slice(0, -extname(base).length) : base;
    if (fileStem.toLowerCase() === stem.toLowerCase()) {
      return join(dir, e.name);
    }
  }
  return null;
}

/**
 * @param {string} raw
 */
function stemFromRef(raw) {
  const pathPart = raw.split('#')[0].split('?')[0];
  let base = pathPart;
  if (pathPart.startsWith('http://') || pathPart.startsWith('https://')) {
    try {
      base = basename(new URL(pathPart).pathname);
    } catch {
      base = basename(pathPart);
    }
  } else {
    base = basename(pathPart);
  }
  return extname(base) ? base.slice(0, -extname(base).length) : base;
}

/**
 * @param {string} mdxDir
 * @param {string} absTarget
 */
function relativePathForMdx(mdxDir, absTarget) {
  const r = relative(mdxDir, absTarget).split(sep).join('/');
  if (r === '') return '';
  if (r.startsWith('..')) return r;
  if (r.startsWith('.')) return r;
  return `./${r}`;
}

/**
 * @param {string} raw
 * @param {string} targetPathForSim
 * @param {string[]} imageAbsPaths
 */
function rankCandidatesBySimilarity(raw, targetPathForSim, imageAbsPaths) {
  const refStem = stemFromRef(raw);
  /** @type {Array<{ abs: string; rel: string; score: number }>} */
  const scored = [];
  for (const abs of imageAbsPaths) {
    const rel = relative(DOC_ROOT, abs).split(sep).join('/');
    const base = basename(abs);
    const fileStem = extname(base) ? base.slice(0, -extname(base).length) : base;
    let score = cosineSimilarityPaths(targetPathForSim, rel);
    if (pathsEqualExceptImageExtension(targetPathForSim, rel)) {
      score = 1;
    } else if (refStem && fileStem.toLowerCase() === refStem.toLowerCase()) {
      score = Math.min(1, score + 0.35);
    }
    scored.push({ abs, rel, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored;
}

/**
 * @param {string} raw
 * @param {string} targetPathForSim
 * @param {string[]} imageAbsPaths
 */
function rankByStemFallback(raw, targetPathForSim, imageAbsPaths) {
  const refStem = stemFromRef(raw);
  if (!refStem) return [];
  return imageAbsPaths
    .map((abs) => {
      const rel = relative(DOC_ROOT, abs).split(sep).join('/');
      const base = basename(abs);
      const fileStem = extname(base) ? base.slice(0, -extname(base).length) : base;
      if (pathsEqualExceptImageExtension(targetPathForSim, rel)) {
        return { abs, rel, score: 1 };
      }
      if (fileStem.toLowerCase() !== refStem.toLowerCase()) return null;
      const score = cosineSimilarityPaths(targetPathForSim, rel) + 0.2;
      return { abs, rel, score };
    })
    .filter(Boolean)
    .sort((x, y) => y.score - x.score);
}

/**
 * @param {string} raw
 * @param {string} mdxPath
 * @param {string} mdxDir
 * @param {string | null} expectedLocal
 * @param {string[]} imageAbsPaths
 */
async function promptAndApplyFix(raw, mdxPath, mdxDir, expectedLocal, imageAbsPaths) {
  let targetPathForSim = pathStringForSimilarity(raw) || '';
  if (!targetPathForSim && expectedLocal) {
    targetPathForSim = relative(DOC_ROOT, expectedLocal).split(sep).join('/');
  }
  if (!targetPathForSim) {
    console.error(`  No path to compare for: ${raw}`);
    return false;
  }

  let ranked = rankCandidatesBySimilarity(raw, targetPathForSim, imageAbsPaths);
  if (ranked.length === 0 || ranked[0].score < 0.08) {
    const stemRanked = rankByStemFallback(raw, targetPathForSim, imageAbsPaths);
    if (stemRanked.length > 0) {
      ranked = stemRanked;
    }
  }

  if (ranked.length === 0) {
    console.error(`  No candidate image files to compare for: ${raw}`);
    return false;
  }

  const bestScore = ranked[0].score;
  const qualified = ranked.filter((r) => r.score > MIN_FIX_CONFIDENCE);

  if (qualified.length === 0) {
    console.error(
      `  No match above ${MIN_FIX_CONFIDENCE * 100}% confidence (best ${(bestScore * 100).toFixed(1)}%); not showing candidates — leaving error for next run.`,
    );
    return false;
  }

  if (!isTTY) {
    const top = qualified[0];
    console.error(
      `  [non-TTY] Best match above ${MIN_FIX_CONFIDENCE * 100}%: ${top.rel} (${(top.score * 100).toFixed(1)}%) — use a TTY to apply or fix manually.`,
    );
    return false;
  }

  const choiceRel = await select({
    message: `Choose replacement for "${raw}" (only matches above ${MIN_FIX_CONFIDENCE * 100}% shown):`,
    choices: [
      {
        name: 'None (skip — leave this error for next run)',
        value: '__none__',
      },
      ...qualified.map((r) => ({
        name: `${r.rel} (${(r.score * 100).toFixed(1)}% match)`,
        value: r.rel,
      })),
    ],
  });

  if (choiceRel === '__none__') {
    console.error('  Skipped — leaving error for next run.');
    return false;
  }

  const chosen = qualified.find((r) => r.rel === choiceRel);
  if (!chosen) {
    console.error('  Skipped — invalid selection.');
    return false;
  }

  const newRef = relativePathForMdx(mdxDir, chosen.abs);
  let content = readFileSync(mdxPath, 'utf8');
  if (!content.includes(raw)) {
    console.error(`  Reference string not found in file (maybe already changed): ${raw}`);
    return false;
  }
  const updated = content.split(raw).join(newRef);
  writeFileSync(mdxPath, updated, 'utf8');
  console.error(`  Updated ${relative(DOC_ROOT, mdxPath)} (${raw} → ${newRef})`);
  return true;
}

/**
 * @param {Array<{ raw: string; mdxPath: string; line: number; expectedLocal: string | null; checkedUrl: string | null }>} failures
 * @param {string[]} imageAbsPaths
 */
async function runFixMode(failures, imageAbsPaths) {
  const seen = new Set();
  for (const f of failures) {
    const key = `${f.mdxPath}\0${f.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const relFile = relative(DOC_ROOT, f.mdxPath);
    console.error(`\n--- Fix: ${relFile}:${f.line} ---`);
    console.error(`  Broken: ${f.raw}`);

    const mdxDir = dirname(f.mdxPath);
    await promptAndApplyFix(f.raw, f.mdxPath, mdxDir, f.expectedLocal, imageAbsPaths);
  }
}

/**
 * @param {string[]} issues
 */
function printIssues(issues) {
  console.error(`\nImage path validation failed (${issues.length} issue(s)):\n`);
  for (let i = 0; i < issues.length; i++) {
    console.error(`--- Issue ${i + 1} ---`);
    console.error(issues[i]);
  }
}

/**
 * @param {Array<{ raw: string; mdxPath: string; line: number; detail: string }>} pendingRemote
 * @param {string[]} issues
 * @param {Array<{ raw: string; mdxPath: string; line: number; expectedLocal: string | null; checkedUrl: string | null }>} failures
 */
async function runRemoteChecks(pendingRemote, issues, failures) {
  if (skipRemote || pendingRemote.length === 0) return;
  process.stderr.write(`Checking ${pendingRemote.length} path(s) on production…\n`);
  for (const p of pendingRemote) {
    const ok = await checkRemote(p.detail);
    if (!ok) {
      const relFile = relative(DOC_ROOT, p.mdxPath);
      issues.push(
        `${relFile}:${p.line}\n  not found locally and not on production (HTTP check failed): ${p.raw}\n  checked: ${p.detail}\n`,
      );
      const expectedLocal = resolveLocalPath(p.raw, dirname(p.mdxPath));
      failures.push({
        raw: p.raw,
        mdxPath: p.mdxPath,
        line: p.line,
        expectedLocal: expectedLocal && !p.raw.startsWith('http') ? expectedLocal : null,
        checkedUrl: p.detail,
      });
    }
  }
}

/**
 * @param {string} url
 */
async function checkRemote(url) {
  if (remoteOkCache.has(url)) {
    return remoteOkCache.get(url);
  }
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (res.ok) {
      remoteOkCache.set(url, true);
      return true;
    }
    const getRes = await fetch(url, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0' } });
    const ok = getRes.ok;
    remoteOkCache.set(url, ok);
    return ok;
  } catch {
    remoteOkCache.set(url, false);
    return false;
  }
}

/**
 * @param {{ raw: string; relFile: string; line: number; mdxDir: string; mdxPath: string; issues: string[]; pendingRemote: Array<{ raw: string; mdxPath: string; line: number; detail: string }>; failures: Array<{ raw: string; mdxPath: string; line: number; expectedLocal: string | null; checkedUrl: string | null }> }} ctx
 */
function processLocalRef(ctx) {
  const { raw, relFile, line, mdxDir, mdxPath, issues, pendingRemote, failures } = ctx;
  const localPath = resolveLocalPath(raw, mdxDir);
  if (!localPath) {
    issues.push(`${relFile}:${line}\n  could not resolve path: ${raw}\n`);
    failures.push({ raw, mdxPath, line, expectedLocal: null, checkedUrl: null });
    return;
  }

  if (findExistingImageSameStemDifferentExt(localPath)) return;

  if (skipRemote) {
    issues.push(
      `${relFile}:${line}\n  missing locally (remote check skipped): ${raw}\n  resolved: ${localPath}\n`,
    );
    failures.push({ raw, mdxPath, line, expectedLocal: localPath, checkedUrl: null });
    return;
  }

  const prodUrl = toProductionUrl(localPath);
  if (!prodUrl) {
    issues.push(
      `${relFile}:${line}\n  missing locally and not under Documentation/: ${raw}\n  resolved: ${localPath}\n`,
    );
    failures.push({ raw, mdxPath, line, expectedLocal: localPath, checkedUrl: null });
    return;
  }

  pendingRemote.push({
    raw,
    mdxPath,
    line,
    detail: prodUrl,
  });
}

async function main() {
  /** @type {string[]} */
  const mdxFiles = [];
  collectMdxFiles(DOC_ROOT, mdxFiles);

  /** @type {string[]} */
  const imageAbsPaths = [];
  collectImageFiles(DOC_ROOT, imageAbsPaths);

  /** @type {string[]} */
  const issues = [];

  /** @type {Array<{ raw: string; mdxPath: string; line: number; expectedLocal: string | null; checkedUrl: string | null }>} */
  const failures = [];

  /** @type {Array<{ raw: string; mdxPath: string; line: number; detail: string }>} */
  const pendingRemote = [];

  for (const mdxPath of mdxFiles) {
    const content = readFileSync(mdxPath, 'utf8');
    const mdxDir = dirname(mdxPath);
    const relFile = relative(DOC_ROOT, mdxPath);
    const refs = extractImageRefs(content);

    for (const { raw, line } of refs) {
      if (!shouldValidateRef(raw)) continue;

      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        if (!skipRemote) {
          pendingRemote.push({ raw, mdxPath, line, detail: raw });
        }
        continue;
      }

      processLocalRef({
        raw,
        relFile,
        line,
        mdxDir,
        mdxPath,
        issues,
        pendingRemote,
        failures,
      });
    }
  }

  await runRemoteChecks(pendingRemote, issues, failures);

  if (fixMode && failures.length > 0) {
    console.error(`\n--fix: ${failures.length} failure(s) to review (interactive: ${isTTY}).\n`);
    await runFixMode(failures, imageAbsPaths);
    console.error('\nRe-run without --fix to verify.\n');
    return 0;
  }

  if (issues.length > 0) {
    printIssues(issues);
    return 1;
  }

  console.error('Image path validation: OK (all referenced images exist locally or on production).');
  return 0;
}

const exitCode = await main();
process.exit(exitCode);
