#!/usr/bin/env node

/**
 * Replace image references with webp versions
 * 
 * This script finds all webp files that have corresponding original files
 * (png, jpg, jpeg) and updates references in mdx files to use the webp version.
 * 
 * Run after: pnpm optimize (which converts images to webp using optimizt)
 * 
 * Usage: node scripts/replace-with-webp.js [--dry-run] [--delete-originals]
 * 
 * Options:
 *   --dry-run          Show what would be changed without making changes
 *   --delete-originals Delete original files after updating references
 */

import { readdir, readFile, writeFile, stat, unlink } from 'fs/promises';
import { join, dirname, basename, extname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, '..', 'Documentation');

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
const dryRun = process.argv.includes('--dry-run');
const deleteOriginals = process.argv.includes('--delete-originals');

/**
 * Recursively find all files with given extensions in a directory
 */
async function findFiles(dir, extensions) {
  const results = [];
  
  async function walk(currentDir) {
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
  }
  
  await walk(dir);
  return results;
}

/**
 * Check if a file exists
 */
async function fileExists(path) {
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
async function findConvertedWebpFiles() {
  const webpFiles = await findFiles(DOCS_DIR, ['.webp']);
  const converted = [];
  
  for (const webpPath of webpFiles) {
    const dir = dirname(webpPath);
    const nameWithoutExt = basename(webpPath, '.webp');
    
    // Check for corresponding original files
    for (const ext of IMAGE_EXTENSIONS) {
      const originalPath = join(dir, nameWithoutExt + ext);
      if (await fileExists(originalPath)) {
        converted.push({
          webpPath,
          originalPath,
          originalExt: ext,
          baseName: nameWithoutExt
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
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Update references in mdx files
 */
async function updateMdxReferences(convertedFiles) {
  const mdxFiles = await findFiles(DOCS_DIR, ['.mdx', '.md']);
  const updates = [];
  
  // Build a map of original file paths to their webp equivalents
  const replacements = new Map();
  for (const { originalPath, originalExt, baseName } of convertedFiles) {
    const relPath = relative(DOCS_DIR, originalPath);
    const relWebpPath = relative(DOCS_DIR, dirname(originalPath) + '/' + baseName + '.webp');
    replacements.set(relPath, { relWebpPath, originalExt, baseName });
  }
  
  for (const mdxPath of mdxFiles) {
    const content = await readFile(mdxPath, 'utf-8');
    let newContent = content;
    const mdxDir = dirname(mdxPath);
    const fileUpdates = [];
    
    for (const { originalPath, originalExt, baseName } of convertedFiles) {
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
        const escapedPattern = escapeRegex(pattern);
        const regex = new RegExp(escapedPattern, 'g');
        
        if (regex.test(newContent)) {
          const webpPattern = pattern.replace(new RegExp(escapeRegex(originalExt) + '$'), '.webp');
          newContent = newContent.replace(regex, webpPattern);
          fileUpdates.push({ from: pattern, to: webpPattern });
        }
      }
    }
    
    if (newContent !== content) {
      updates.push({
        path: mdxPath,
        changes: fileUpdates
      });
      
      if (!dryRun) {
        await writeFile(mdxPath, newContent, 'utf-8');
      }
    }
  }
  
  return updates;
}

async function main() {
  console.log('🔍 Scanning for converted webp files...\n');
  
  const convertedFiles = await findConvertedWebpFiles();
  
  if (convertedFiles.length === 0) {
    console.log('No converted webp files found (no webp files with corresponding png/jpg/jpeg originals).');
    console.log('\nMake sure to run "pnpm optimize" first to convert images to webp.');
    process.exit(0);
  }
  
  console.log(`Found ${convertedFiles.length} converted webp file(s):\n`);
  for (const { originalPath, webpPath } of convertedFiles) {
    const relOriginal = relative(DOCS_DIR, originalPath);
    console.log(`  📸 ${relOriginal} → .webp`);
  }
  
  console.log('\n🔄 Updating references in documentation files...\n');
  
  const updates = await updateMdxReferences(convertedFiles);
  
  if (updates.length === 0) {
    console.log('No references found to update.');
  } else {
    console.log(`${dryRun ? 'Would update' : 'Updated'} ${updates.length} file(s):\n`);
    for (const { path, changes } of updates) {
      const relPath = relative(DOCS_DIR, path);
      console.log(`  📝 ${relPath}`);
      for (const { from, to } of changes) {
        console.log(`     ${from}`);
        console.log(`     → ${to}`);
      }
    }
  }
  
  // Delete original files if requested
  if (deleteOriginals && convertedFiles.length > 0) {
    console.log('\n🗑️  Deleting original files...\n');
    for (const { originalPath } of convertedFiles) {
      const relOriginal = relative(DOCS_DIR, originalPath);
      if (dryRun) {
        console.log(`  Would delete: ${relOriginal}`);
      } else {
        await unlink(originalPath);
        console.log(`  Deleted: ${relOriginal}`);
      }
    }
  }
  
  if (dryRun) {
    console.log('\n⚠️  Dry run - no files were modified. Run without --dry-run to apply changes.');
  } else {
    console.log('\n✅ Done!');
    
    if (!deleteOriginals && convertedFiles.length > 0) {
      console.log('\n💡 Tip: Run with --delete-originals to remove the original png/jpg files.');
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
