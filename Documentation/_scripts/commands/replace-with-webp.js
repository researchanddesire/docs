import { Command, Flags } from '@oclif/core';
import { readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { join, dirname, basename, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

export default class ReplaceWithWebp extends Command {
  static description = 'Replace image references with webp versions after optimization';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --delete-originals',
    '<%= config.bin %> <%= command.id %> --dry-run --delete-originals',
  ];

  static flags = {
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would be changed without making changes',
      default: false,
    }),
    'delete-originals': Flags.boolean({
      description: 'Delete original files after updating references',
      default: false,
    }),
  };

  /**
   * Recursively find all files with given extensions in a directory
   */
  async findFiles(dir, extensions) {
    const results = [];

    const walk = async (currentDir) => {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Skip node_modules and hidden directories
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            results.push(fullPath);
          }
        }
      }
    };

    await walk(dir);
    return results;
  }

  /**
   * Check if a file exists
   */
  async fileExists(path) {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find all webp files that have corresponding original files
   */
  async findConvertedWebpFiles(docsDir) {
    const webpFiles = await this.findFiles(docsDir, ['.webp']);
    const converted = [];

    for (const webpPath of webpFiles) {
      const dir = dirname(webpPath);
      const nameWithoutExt = basename(webpPath, '.webp');

      // Check for corresponding original files
      for (const ext of IMAGE_EXTENSIONS) {
        const originalPath = join(dir, nameWithoutExt + ext);
        if (await this.fileExists(originalPath)) {
          converted.push({
            webpPath,
            originalPath,
            originalExt: ext,
            baseName: nameWithoutExt,
          });
          break; // Only need to find one original
        }
      }
    }

    return converted;
  }

  /**
   * Escape special regex characters in a string
   */
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Build all path variants that MDX files might use to reference an image.
   * Returns deduplicated { from, to } pairs.
   */
  buildPathPairs(docsDir, mdxDir, originalPath, webpPath, originalExt) {
    const relOrig = relative(mdxDir, originalPath).replace(/\\/g, '/');
    const relWebp = relative(mdxDir, webpPath).replace(/\\/g, '/');
    const absOrig = '/' + relative(docsDir, originalPath).replace(/\\/g, '/');
    const absWebp = '/' + relative(docsDir, webpPath).replace(/\\/g, '/');

    const seen = new Set();
    const pairs = [];
    const add = (from, to) => {
      if (from === to || seen.has(from)) return;
      seen.add(from);
      pairs.push({ from, to });
    };

    add(relOrig, relWebp);
    add('./' + relOrig, './' + relWebp);
    add(absOrig, absWebp);

    return pairs;
  }

  /**
   * Update references in mdx files
   */
  async updateMdxReferences(docsDir, convertedFiles, dryRun) {
    const mdxFiles = await this.findFiles(docsDir, ['.mdx', '.md']);
    const updates = [];

    for (const mdxPath of mdxFiles) {
      const content = await readFile(mdxPath, 'utf-8');
      let newContent = content;
      const mdxDir = dirname(mdxPath);
      const fileUpdates = [];

      for (const { originalPath, webpPath, originalExt } of convertedFiles) {
        const pairs = this.buildPathPairs(docsDir, mdxDir, originalPath, webpPath, originalExt);

        for (const { from, to } of pairs) {
          if (newContent.includes(from)) {
            newContent = newContent.replaceAll(from, to);
            fileUpdates.push({ from, to });
          }
        }
      }

      if (newContent !== content) {
        updates.push({
          path: mdxPath,
          changes: fileUpdates,
        });

        if (!dryRun) {
          await writeFile(mdxPath, newContent, 'utf-8');
        }
      }
    }

    return updates;
  }

  /**
   * Resolve a raw image path from an MDX file to an absolute filesystem path,
   * mirroring the rules in validate-image-paths.mjs.
   */
  resolveImagePath(raw, docsDir, mdxDir) {
    const clean = raw.split('#')[0].split('?')[0];
    if (clean.startsWith('http://') || clean.startsWith('https://')) return null;
    if (clean.startsWith('/')) return join(docsDir, clean.slice(1));
    return join(mdxDir, clean);
  }

  /**
   * Final sweep: find any remaining .png/.jpg/.jpeg references where a .webp
   * sibling exists on disk, and replace them. Catches absolute paths missed by
   * the main pass and cases where the original was already deleted.
   */
  async sweepStaleRasterRefs(docsDir, dryRun) {
    const mdxFiles = await this.findFiles(docsDir, ['.mdx', '.md']);
    const rasterRefPattern = /(?<![a-zA-Z:])(?:\.\/|\.\.\/|\/)[^\s)"']*\.(?:png|jpe?g)/gi;
    const updates = [];

    for (const mdxPath of mdxFiles) {
      const content = await readFile(mdxPath, 'utf-8');
      let newContent = content;
      const mdxDir = dirname(mdxPath);
      const fileUpdates = [];

      const matches = [...content.matchAll(rasterRefPattern)];
      const seen = new Set();

      for (const match of matches) {
        const raw = match[0];
        if (seen.has(raw)) continue;
        seen.add(raw);

        const resolved = this.resolveImagePath(raw, docsDir, mdxDir);
        if (!resolved) continue;

        const webpCandidate = resolved.replace(/\.(png|jpe?g)$/i, '.webp');
        if (!(await this.fileExists(webpCandidate))) continue;

        const webpRaw = raw.replace(/\.(png|jpe?g)$/i, '.webp');
        if (webpRaw === raw) continue;

        newContent = newContent.replaceAll(raw, webpRaw);
        fileUpdates.push({ from: raw, to: webpRaw });
      }

      if (newContent !== content) {
        updates.push({ path: mdxPath, changes: fileUpdates });
        if (!dryRun) {
          await writeFile(mdxPath, newContent, 'utf-8');
        }
      }
    }

    return updates;
  }

  async run() {
    const { flags } = await this.parse(ReplaceWithWebp);
    const dryRun = flags['dry-run'];
    const deleteOriginals = flags['delete-originals'];

    // Paths relative to the Documentation directory
    const docsDir = join(__dirname, '..', '..');

    this.log('🔍 Scanning for converted webp files...\n');

    const convertedFiles = await this.findConvertedWebpFiles(docsDir);

    if (convertedFiles.length === 0) {
      this.log('No converted webp files found (no webp files with corresponding png/jpg/jpeg originals).');
    } else {
      this.log(`Found ${convertedFiles.length} converted webp file(s):\n`);
      for (const { originalPath } of convertedFiles) {
        const relOriginal = relative(docsDir, originalPath);
        this.log(`  📸 ${relOriginal} → .webp`);
      }
    }

    this.log('\n🔄 Updating references in documentation files...\n');

    const updates = convertedFiles.length > 0
      ? await this.updateMdxReferences(docsDir, convertedFiles, dryRun)
      : [];

    if (updates.length === 0) {
      this.log('No references found to update.');
    } else {
      this.log(`${dryRun ? 'Would update' : 'Updated'} ${updates.length} file(s):\n`);
      for (const { path, changes } of updates) {
        const relPath = relative(docsDir, path);
        this.log(`  📝 ${relPath}`);
        for (const { from, to } of changes) {
          this.log(`     ${from}`);
          this.log(`     → ${to}`);
        }
      }
    }

    // Final sweep: catch any remaining raster refs that have a .webp on disk
    this.log('\n🔎 Final sweep for stale raster references...\n');

    const sweepUpdates = await this.sweepStaleRasterRefs(docsDir, dryRun);

    if (sweepUpdates.length === 0) {
      this.log('No additional stale references found.');
    } else {
      this.log(`${dryRun ? 'Would fix' : 'Fixed'} ${sweepUpdates.length} file(s) in sweep:\n`);
      for (const { path: filePath, changes } of sweepUpdates) {
        const relPath = relative(docsDir, filePath);
        this.log(`  📝 ${relPath}`);
        for (const { from, to } of changes) {
          this.log(`     ${from}`);
          this.log(`     → ${to}`);
        }
      }
    }

    // Delete original files if requested
    if (deleteOriginals && convertedFiles.length > 0) {
      this.log('\n🗑️  Deleting original files...\n');
      for (const { originalPath } of convertedFiles) {
        const relOriginal = relative(docsDir, originalPath);
        if (dryRun) {
          this.log(`  Would delete: ${relOriginal}`);
        } else {
          await unlink(originalPath);
          this.log(`  Deleted: ${relOriginal}`);
        }
      }
    }

    if (dryRun) {
      this.log('\n⚠️  Dry run - no files were modified. Run without --dry-run to apply changes.');
    } else {
      this.log('\n✅ Done!');

      if (!deleteOriginals && convertedFiles.length > 0) {
        this.log('\n💡 Tip: Run with --delete-originals to remove the original png/jpg files.');
      }
    }
  }
}
