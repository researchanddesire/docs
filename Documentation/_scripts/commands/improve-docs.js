import { Command, Flags, ux } from '@oclif/core';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Escape special characters for shell double-quoted strings
 */
function escapeShellArg(str) {
  // Escape characters that have special meaning in double-quoted shell strings
  return str
    .replace(/\\/g, '\\\\')   // backslashes first
    .replace(/"/g, '\\"')     // double quotes
    .replace(/\$/g, '\\$')    // dollar signs
    .replace(/`/g, '\\`')     // backticks
    .replace(/!/g, '\\!');    // exclamation marks (history expansion)
}

// Content directories to scan
const CONTENT_DIRS = ['ossm', 'dtt', 'lkbx', 'radr', 'dashboard', 'shop'];

// Directories to ignore
const IGNORE_DIRS = ['_scripts', '_archive', 'logo', 'images', 'snippets', 'node_modules', '_images'];

export default class ImproveDocs extends Command {
  static description = 'Use Cursor AI to check and improve MDX documentation quality';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dir ossm',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --file ossm/guides/getting-started/introduction.mdx',
  ];

  static flags = {
    dir: Flags.string({
      char: 'd',
      description: 'Only scan a specific directory (e.g., ossm, dtt, lkbx)',
      required: false,
    }),
    file: Flags.string({
      char: 'f',
      description: 'Process a single file (relative to Documentation folder)',
      required: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Only check files without rewriting',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed output',
      default: false,
    }),
    model: Flags.string({
      char: 'm',
      description: 'Model to use for rewriting',
      default: 'opus-4.5-thinking',
    }),
    'ask-model': Flags.string({
      description: 'Model to use for quality check',
      default: 'sonnet-4.5',
    }),
  };

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
        if (IGNORE_DIRS.includes(entry.name)) {
          continue;
        }
        files.push(...this.findMdxFiles(fullPath, relativePath));
      } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
        files.push(relativePath);
      }
    }

    return files;
  }

  /**
   * Run cursor agent in ask mode to check if document needs improvement
   * Returns { needsWork: boolean, issues: string | null }
   */
  async checkDocumentQuality(filePath, askModel, docsRoot, verbose) {
    const prompt = `Review @${filePath} for quality issues.

Check for:
- Grammar and spelling errors  
- Unclear or confusing explanations
- Redundant information that should be a link instead
- Poor structure or organization
- Inconsistent formatting

If there are significant issues, respond with "YES" on the first line, then list the general issues as bullet points. Don't be too specific, tell the next agent which areas are having issues.
If the document is already good quality, respond with just "NO".`;

    try {
      this.log(`  ${ux.colorize('dim', 'checking')} ${ux.colorize('cyan', askModel)}...`);

      const escapedPrompt = escapeShellArg(prompt);
      const result = execSync(
        `cursor agent --mode ask --print --model ${askModel} --workspace "${docsRoot}" "${escapedPrompt}"`,
        {
          cwd: docsRoot,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
          timeout: 120000, // 2 minute timeout
        }
      );

      const response = result.trim();
      const lines = response.split('\n');
      const firstLine = lines[0].trim().toUpperCase();
      const needsWork = firstLine.includes('YES');

      // Extract issues if present (everything after the first line)
      let issues = null;
      if (needsWork && lines.length > 1) {
        issues = lines.slice(1).join('\n').trim();
      }

      // Show issues summary when found
      if (needsWork && issues) {
        const issueLines = issues.split('\n').filter(l => l.trim()).slice(0, 5);
        for (const issue of issueLines) {
          this.log(`    ${ux.colorize('yellow', issue.trim())}`);
        }
        if (issues.split('\n').filter(l => l.trim()).length > 5) {
          this.log(`    ${ux.colorize('dim', '...')}`);
        }
      }

      // Show full response in verbose mode
      if (verbose) {
        const cleanResponse = response.replace(/\n/g, ' ').substring(0, 120);
        this.log(`  ${ux.colorize('dim', 'response:')} "${cleanResponse}${response.length > 120 ? '...' : ''}"`);
      }

      return { needsWork, issues };
    } catch (error) {
      this.warn(`Failed to check ${filePath}: ${error.message}`);
      return { needsWork: false, issues: null };
    }
  }

  /**
   * Run cursor agent to rewrite the document
   */
  async rewriteDocument(filePath, model, docsRoot, issues = null) {
    let prompt = `Improve @${filePath} documentation.`;

    // Include specific issues if provided
    if (issues) {
      prompt += `

The following issues were identified during review:
${issues}

Please address these specific issues.`;
    } else {
      prompt += `

Fix any issues with:
- Grammar and spelling
- Clarity and readability  
- Structure and organization
- Formatting consistency`;
    }

    prompt += `

Keep the same general content and meaning, but make it better quality documentation.
Preserve all MDX components, frontmatter, and special syntax exactly as they are.

Do NOT offer information that you cannot independently verify, or find elsewhere in the documentation or on the internet.
Rather, place a hidden "TODO" comment in the file where you didn't have sufficient information to rewrite.

When rewriting apply these rules:

@${docsRoot}/.cursor/rules.mdc
`;
    const escapedPrompt = escapeShellArg(prompt);
    const result = execSync(
      `cursor agent --print --model ${model} --force --workspace "${docsRoot}" "${escapedPrompt}"`,
      {
        cwd: docsRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 600000, // 10 minute timeout
      }
    );

    return result;
  }

  async run() {
    const { flags } = await this.parse(ImproveDocs);
    const docsRoot = join(__dirname, '..', '..');

    let mdxFiles = [];

    // Single file mode
    if (flags.file) {
      const filePath = join(docsRoot, flags.file);
      if (!existsSync(filePath)) {
        this.error(`File not found: ${flags.file}`);
      }
      mdxFiles = [flags.file];
    } else {
      // Directory scanning mode
      const dirsToScan = flags.dir ? [flags.dir] : CONTENT_DIRS;

      for (const contentDir of dirsToScan) {
        const dirPath = join(docsRoot, contentDir);
        const filesInDir = this.findMdxFiles(dirPath, contentDir);
        mdxFiles.push(...filesInDir);
      }
    }

    this.log(`\nFound ${ux.colorize('cyan', mdxFiles.length.toString())} MDX file(s) to check\n`);

    const stats = {
      checked: 0,
      needsImprovement: 0,
      improved: 0,
      skipped: 0,
      errors: 0,
    };

    const startTime = Date.now();

    // Collect files that need work: { file, issues }
    const filesToRewrite = [];

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 1: Check all files for quality issues
    // ─────────────────────────────────────────────────────────────────────────
    this.log(ux.colorize('bold', '📋 Phase 1: Checking all files...\n'));

    for (const file of mdxFiles) {
      stats.checked++;

      this.log(`${ux.colorize('dim', `[${stats.checked}/${mdxFiles.length}]`)} ${ux.colorize('white', file)}`);

      try {
        const { needsWork, issues } = await this.checkDocumentQuality(file, flags['ask-model'], docsRoot, flags.verbose);

        if (!needsWork) {
          this.log(`  ${ux.colorize('green', 'ok')}`);
          stats.skipped++;
        } else {
          this.log(`  ${ux.colorize('yellow', 'needs work')}`);
          stats.needsImprovement++;
          filesToRewrite.push({ file, issues });
        }
      } catch (error) {
        this.log(`  ${ux.colorize('red', 'error:')} ${error.message}`);
        stats.errors++;
      }

      // Small delay between checks to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Check summary after phase 1
    this.log(`\n${ux.colorize('dim', '─'.repeat(50))}`);
    this.log(`${ux.colorize('bold', 'Check complete:')} ${stats.skipped} ok, ${stats.needsImprovement} need work, ${stats.errors} errors`);
    this.log(`${ux.colorize('dim', '─'.repeat(50))}\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 2: Rewrite files that need improvement
    // ─────────────────────────────────────────────────────────────────────────
    if (filesToRewrite.length > 0 && !flags['dry-run']) {
      this.log(ux.colorize('bold', `✏️  Phase 2: Rewriting ${filesToRewrite.length} file(s)...\n`));

      let rewriteIndex = 0;
      for (const { file, issues } of filesToRewrite) {
        rewriteIndex++;

        this.log(`${ux.colorize('dim', `[${rewriteIndex}/${filesToRewrite.length}]`)} ${ux.colorize('white', file)}`);
        this.log(`  ${ux.colorize('dim', 'rewriting')} ${ux.colorize('cyan', flags.model)}...`);

        try {
          await this.rewriteDocument(file, flags.model, docsRoot, issues);
          this.log(`  ${ux.colorize('green', 'rewritten')}`);
          stats.improved++;
        } catch (error) {
          this.log(`  ${ux.colorize('red', 'failed:')} ${error.message}`);
          stats.errors++;
        }

        // Small delay between rewrites to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } else if (flags['dry-run'] && filesToRewrite.length > 0) {
      this.log(ux.colorize('dim', `Dry-run: would rewrite ${filesToRewrite.length} file(s):\n`));
      for (const { file } of filesToRewrite) {
        this.log(`  - ${file}`);
      }
      this.log('');
    }

    // Print summary
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    this.log(`${ux.colorize('dim', '─'.repeat(50))}`);
    this.log(ux.colorize('bold', 'Summary'));
    this.log(`  ${ux.colorize('dim', 'checked:')}      ${stats.checked}`);
    this.log(`  ${ux.colorize('yellow', 'needs work:')}  ${stats.needsImprovement}`);
    this.log(`  ${ux.colorize('green', 'improved:')}    ${stats.improved}`);
    this.log(`  ${ux.colorize('dim', 'skipped:')}      ${stats.skipped}`);
    this.log(`  ${ux.colorize('red', 'errors:')}       ${stats.errors}`);
    this.log(`  ${ux.colorize('dim', 'time:')}         ${totalTime}s`);
    this.log(`${ux.colorize('dim', '─'.repeat(50))}\n`);

    if (stats.errors > 0) {
      this.exit(1);
    }
  }
}
