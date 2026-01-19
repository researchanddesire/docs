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

      for (const { originalPath, originalExt } of convertedFiles) {
        // Calculate relative path from mdx file to original image
        const relToImage = relative(mdxDir, originalPath);

        // Common path patterns in mdx files
        const patterns = [
          // Relative paths like ./_images/file.png or _images/file.png
          relToImage,
          './' + relToImage,
          // Also try with forward slashes (in case of Windows paths)
          relToImage.replace(/\\/g, '/'),
          './' + relToImage.replace(/\\/g, '/'),
        ];

        for (const pattern of patterns) {
          // Escape the pattern for regex, then replace the extension
          const escapedPattern = this.escapeRegex(pattern);
          const regex = new RegExp(escapedPattern, 'g');

          if (regex.test(newContent)) {
            const webpPattern = pattern.replace(new RegExp(this.escapeRegex(originalExt) + '$'), '.webp');
            newContent = newContent.replace(regex, webpPattern);
            fileUpdates.push({ from: pattern, to: webpPattern });
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
      return;
    }

    this.log(`Found ${convertedFiles.length} converted webp file(s):\n`);
    for (const { originalPath } of convertedFiles) {
      const relOriginal = relative(docsDir, originalPath);
      this.log(`  📸 ${relOriginal} → .webp`);
    }

    this.log('\n🔄 Updating references in documentation files...\n');

    const updates = await this.updateMdxReferences(docsDir, convertedFiles, dryRun);

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
