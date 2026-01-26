import { Command, Flags } from '@oclif/core';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Content directories to scan
const CONTENT_DIRS = ['ossm', 'dtt', 'lkbx', 'radr', 'dashboard', 'shop'];

// Directories to ignore
const IGNORE_DIRS = ['_scripts', '_archive', 'node_modules', '.git'];

// Config file name for whitelist patterns
const IGNORE_FILE = '.external-links-ignore';

export default class ExternalLinks extends Command {
  static description = 'Find all external links (http/https) in MDX files and show their source locations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --verbose',
    '<%= config.bin %> <%= command.id %> --dir ossm',
    '<%= config.bin %> <%= command.id %> --sort-by-count',
    '<%= config.bin %> <%= command.id %> --exclude "https://github.com/KinkyMakers/*"',
  ];

  static flags = {
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show additional statistics',
      default: false,
    }),
    dir: Flags.string({
      char: 'd',
      description: 'Only scan a specific directory (e.g., ossm, dtt, lkbx)',
      required: false,
    }),
    'sort-by-count': Flags.boolean({
      char: 'c',
      description: 'Sort links by number of occurrences (most used first)',
      default: false,
    }),
    exclude: Flags.string({
      char: 'e',
      description: 'URL pattern to exclude (supports * wildcard). Can be used multiple times.',
      multiple: true,
      default: [],
    }),
    'no-ignore-file': Flags.boolean({
      description: 'Do not read patterns from .external-links-ignore file',
      default: false,
    }),
  };

  /**
   * Load exclude patterns from the ignore file
   */
  loadIgnoreFile(docsRoot) {
    const ignoreFilePath = join(docsRoot, IGNORE_FILE);
    const patterns = [];

    if (existsSync(ignoreFilePath)) {
      const content = readFileSync(ignoreFilePath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines and comments
        if (trimmed && !trimmed.startsWith('#')) {
          patterns.push(trimmed);
        }
      }
    }

    return patterns;
  }

  /**
   * Convert a glob-like pattern to a regex
   * Supports * as wildcard (matches any characters)
   */
  patternToRegex(pattern) {
    // Escape special regex characters except *
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // Convert * to regex wildcard
    const regexStr = escaped.replace(/\*/g, '.*');
    return new RegExp(`^${regexStr}$`, 'i');
  }

  /**
   * Check if a URL matches any of the exclude patterns
   */
  isExcluded(url, patterns) {
    for (const pattern of patterns) {
      const regex = this.patternToRegex(pattern);
      if (regex.test(url)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Recursively find all .mdx files in a directory
   */
  findMdxFiles(dir, basePath = '') {
    const files = [];

    if (!existsSync(dir)) {
      return files;
    }

    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        files.push(...this.findMdxFiles(fullPath, relativePath));
      } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
        files.push({ fullPath, relativePath });
      }
    }

    return files;
  }

  /**
   * Find all external links in content and return with line numbers
   */
  findExternalLinks(content) {
    const links = [];
    const lines = content.split('\n');

    // Patterns to match external URLs
    const patterns = [
      // Markdown links: [text](url)
      /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi,
      // HTML href: href="url" or href='url'
      /href\s*=\s*["'](https?:\/\/[^"'\s]+)["']/gi,
      // HTML src: src="url" or src='url'
      /src\s*=\s*["'](https?:\/\/[^"'\s]+)["']/gi,
      // MDX/JSX props: url="url" or url='url' or link="url"
      /(?:url|link|href|src)\s*=\s*["'](https?:\/\/[^"'\s]+)["']/gi,
      // Bare URLs in content (not in code blocks)
      /(?<![`"'=(])(https?:\/\/[^\s<>)"'\]`]+)/gi,
    ];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const lineNumber = lineIndex + 1;

      // Skip code blocks (simple heuristic - lines starting with ``` or indented code)
      if (line.trim().startsWith('```')) {
        continue;
      }

      // Track URLs found on this line to avoid duplicates from overlapping patterns
      const foundOnLine = new Set();

      for (const pattern of patterns) {
        // Reset lastIndex for global regex
        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(line)) !== null) {
          // Get the URL - it's either in group 1 or group 2 depending on pattern
          const url = match[2] || match[1];

          if (url && !foundOnLine.has(url)) {
            foundOnLine.add(url);
            links.push({
              url: this.cleanUrl(url),
              lineNumber,
            });
          }
        }
      }
    }

    return links;
  }

  /**
   * Clean up URL (remove trailing punctuation that might have been captured)
   */
  cleanUrl(url) {
    // Remove trailing punctuation that's likely not part of the URL
    return url.replace(/[.,;:!?)}\]]+$/, '');
  }

  async run() {
    const { flags } = await this.parse(ExternalLinks);

    const docsRoot = join(__dirname, '..', '..');
    const dirsToScan = flags.dir ? [flags.dir] : CONTENT_DIRS;

    // Load exclude patterns
    const excludePatterns = [...flags.exclude];
    if (!flags['no-ignore-file']) {
      const filePatterns = this.loadIgnoreFile(docsRoot);
      excludePatterns.push(...filePatterns);
    }

    if (flags.verbose && excludePatterns.length > 0) {
      this.log(`Exclude patterns (${excludePatterns.length}):`);
      for (const pattern of excludePatterns) {
        this.log(`  - ${pattern}`);
      }
      this.log('');
    }

    // Find all MDX files
    let mdxFiles = [];
    for (const contentDir of dirsToScan) {
      const dirPath = join(docsRoot, contentDir);
      const filesInDir = this.findMdxFiles(dirPath, contentDir);
      mdxFiles.push(...filesInDir);
    }

    if (flags.verbose) {
      this.log(`Scanning ${mdxFiles.length} MDX files in: ${dirsToScan.join(', ')}\n`);
    }

    // Map: URL -> array of { file, lineNumber }
    const linkMap = new Map();
    let totalOccurrences = 0;
    let excludedCount = 0;

    for (const { fullPath, relativePath } of mdxFiles) {
      const content = readFileSync(fullPath, 'utf-8');
      const links = this.findExternalLinks(content);

      for (const { url, lineNumber } of links) {
        // Check if URL should be excluded
        if (this.isExcluded(url, excludePatterns)) {
          excludedCount++;
          continue;
        }

        if (!linkMap.has(url)) {
          linkMap.set(url, []);
        }
        linkMap.get(url).push({
          file: relativePath,
          lineNumber,
        });
        totalOccurrences++;
      }
    }

    if (linkMap.size === 0) {
      this.log('✓ No external links found in documentation files.');
      return;
    }

    // Sort links
    let sortedLinks = [...linkMap.entries()];
    if (flags['sort-by-count']) {
      sortedLinks.sort((a, b) => b[1].length - a[1].length);
    } else {
      // Sort alphabetically by URL
      sortedLinks.sort((a, b) => a[0].localeCompare(b[0]));
    }

    // Print header
    this.log('═'.repeat(80));
    this.log('EXTERNAL LINKS REPORT');
    this.log('═'.repeat(80));
    this.log('');

    // Print each link with its sources
    for (const [url, locations] of sortedLinks) {
      this.log(url);
      for (const { file, lineNumber } of locations) {
        this.log(`  → ${file}:L${lineNumber}`);
      }
      this.log('');
    }

    // Summary
    this.log('─'.repeat(80));
    this.log('SUMMARY');
    this.log('─'.repeat(80));
    this.log(`Unique external links: ${linkMap.size}`);
    this.log(`Total occurrences: ${totalOccurrences}`);
    if (excludedCount > 0) {
      this.log(`Excluded (whitelisted): ${excludedCount}`);
    }
    this.log(`Files scanned: ${mdxFiles.length}`);

    if (flags.verbose) {
      // Show domains breakdown
      const domains = new Map();
      for (const [url] of sortedLinks) {
        try {
          const domain = new URL(url).hostname;
          domains.set(domain, (domains.get(domain) || 0) + 1);
        } catch {
          domains.set('(invalid URL)', (domains.get('(invalid URL)') || 0) + 1);
        }
      }

      this.log('\nLinks by domain:');
      const sortedDomains = [...domains.entries()].sort((a, b) => b[1] - a[1]);
      for (const [domain, count] of sortedDomains) {
        this.log(`  ${domain}: ${count}`);
      }
    }
  }
}
