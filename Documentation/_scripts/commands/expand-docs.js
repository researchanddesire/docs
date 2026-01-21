import { Command, Flags, ux } from '@oclif/core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Escape special characters for shell double-quoted strings
 */
function escapeShellArg(str) {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')
        .replace(/!/g, '\\!');
}

// Repository configuration - maps repo names to source paths and doc sections
// Paths are relative to the docs repo root (parent of Documentation folder)
const REPO_CONFIG = {
    radr: {
        sourcePath: '../radr/Software/src',
        docSection: 'radr',
    },
    ossm: {
        sourcePath: '../ossm/Software/src',
        docSection: 'ossm',
    },
    lkbx: {
        sourcePath: '../lkbx/src',
        docSection: 'lkbx',
    },
    dtt: {
        sourcePath: '../dtt/src',
        docSection: 'dtt',
    },
    'rad-app': {
        sourcePath: '../rad-app/src',
        docSection: 'dashboard',
    },
};

export default class ExpandDocs extends Command {
    static description = 'Two-phase documentation sync: analyze code vs docs, then implement changes';

    static examples = [
        '<%= config.bin %> <%= command.id %> --repo rad-app',
        '<%= config.bin %> <%= command.id %> --repo ossm --dry-run',
        '<%= config.bin %> <%= command.id %> --source /path/to/code --doc-section ossm',
        '<%= config.bin %> <%= command.id %> --repo dtt --plan-only',
    ];

    static flags = {
        repo: Flags.string({
            char: 'r',
            description: 'Repo name - auto-sets source and doc-section',
            options: Object.keys(REPO_CONFIG),
        }),
        source: Flags.string({
            char: 's',
            description: 'Path to source code repository (or use --repo)',
        }),
        'doc-section': Flags.string({
            char: 'd',
            description: 'Documentation section to check/create docs in (or use --repo)',
        }),
        'dry-run': Flags.boolean({
            description: 'Only run analysis phase, do not implement changes',
            default: false,
        }),
        'plan-only': Flags.boolean({
            description: 'Generate plan file and stop (same as dry-run)',
            default: false,
        }),
        verbose: Flags.boolean({
            char: 'v',
            description: 'Show detailed output',
            default: false,
        }),
        model: Flags.string({
            char: 'm',
            description: 'Model for both analysis and implementation',
            default: 'opus-4.5-thinking',
        }),
        'plan-file': Flags.string({
            description: 'Custom path for the plan file (default: auto-generated)',
            required: false,
        }),
    };

    /**
     * Phase 1: Analysis Agent
     * Uses a single Opus 4.5-thinking max context to analyze code repo vs doc folder
     * Outputs a comprehensive plan.txt file
     */
    async runAnalysisPhase(codeRepoPath, docSectionPath, docSection, model, planFilePath, verbose) {
        this.log(`\n${ux.colorize('bold', '📊 Phase 1: Analysis Agent')}`);
        this.log(`${ux.colorize('dim', '─'.repeat(60))}`);
        this.log(`  Code repo:    ${ux.colorize('cyan', codeRepoPath)}`);
        this.log(`  Doc section:  ${ux.colorize('cyan', docSectionPath)}`);
        this.log(`  Model:        ${ux.colorize('cyan', model)}`);
        this.log(`  Plan file:    ${ux.colorize('cyan', planFilePath)}`);
        this.log(`${ux.colorize('dim', '─'.repeat(60))}\n`);

        const prompt = `You are a documentation analyst. Your job is to compare a source code repository against its documentation and create a comprehensive modification plan.

## Your Task

Analyze the code repository at: ${codeRepoPath}
Against the documentation at: ${docSectionPath}

**THE CODE IS THE SOURCE OF TRUTH.** Documentation must accurately reflect what the code does.

## What to Analyze

1. **Read the code repository thoroughly** - understand what features, states, APIs, configurations, and behaviors exist
2. **Read the documentation thoroughly** - understand what is currently documented
3. **Compare them** - identify gaps, inaccuracies, and outdated content

## What to Look For

### Documentation that needs to be ADDED:
- Features in code that aren't documented
- User-facing states or modes not explained
- Configuration options users need to know about
- Error states or messages users might encounter
- Important limits, constraints, or behaviors

### Documentation that needs to be UPDATED:
- Docs that describe outdated behavior
- Docs with incorrect values, options, or limits
- Docs missing newly added functionality
- Docs that contradict what the code actually does

### Documentation that needs to be REMOVED:
- Docs for features that no longer exist in code
- Deprecated functionality that was removed
- Duplicate or redundant documentation

## Output Format

Write your analysis to a text file at: ${planFilePath}

The file MUST follow this exact structure:

\`\`\`
# Documentation Modification Plan
Generated: [timestamp]
Code Repository: ${codeRepoPath}
Documentation Section: ${docSection}

## Executive Summary
[2-3 sentences summarizing the overall state and what needs to happen]

## Files to ADD
[For each new doc file needed:]

### [Proposed file path]
- **Purpose**: [What this doc will cover]
- **Code References**: [List of code files to use as source of truth]
  - [path/to/code/file1.ts] - [what it contains]
  - [path/to/code/file2.cpp] - [what it contains]
- **Content Outline**: [Brief outline of what to document]

## Files to UPDATE
[For each existing doc that needs changes:]

### [Existing doc file path]
- **Issues Found**: [What's wrong or outdated]
- **Code References**: [Code files that have the correct information]
  - [path/to/code/file.ts] - [what it contains]
- **Changes Needed**: [Specific changes to make]

## Files to REMOVE
[For each doc that should be removed:]

### [Doc file path]
- **Reason**: [Why it should be removed]
- **Code Evidence**: [Code showing the feature no longer exists]

## Implementation Notes
[Any special considerations, dependencies between changes, or suggested order of operations]
\`\`\`

## Important Guidelines

1. Be thorough - scan ALL code files, not just a few
2. Be specific - provide exact file paths and line references where helpful
3. Focus on USER-FACING documentation - skip internal implementation details
4. Prioritize accuracy - when in doubt, favor what the code shows
5. Include enough context that another AI can implement without re-analyzing

Now analyze the code and documentation, then write the plan file.`;

        try {
            this.log(`  ${ux.colorize('dim', 'Running analysis agent...')}`);
            this.log(`  ${ux.colorize('dim', 'This may take several minutes with max context...')}\n`);

            const escapedPrompt = escapeShellArg(prompt);
            
            // Run from a parent directory that contains both repos for maximum context
            const workspaceRoot = join(codeRepoPath, '..');
            
            const result = execSync(
                `cursor agent --print --model ${model} --force --workspace "${workspaceRoot}" "${escapedPrompt}"`,
                {
                    cwd: workspaceRoot,
                    encoding: 'utf-8',
                    maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
                    timeout: 1800000, // 30 minute timeout for thorough analysis
                }
            );

            if (verbose) {
                this.log(`\n${ux.colorize('dim', 'Agent output:')}`);
                this.log(result.substring(0, 2000) + (result.length > 2000 ? '...' : ''));
            }

            // Verify plan file was created
            if (existsSync(planFilePath)) {
                const planContent = readFileSync(planFilePath, 'utf-8');
                const lineCount = planContent.split('\n').length;
                this.log(`\n  ${ux.colorize('green', '✓ Plan file created:')} ${planFilePath}`);
                this.log(`    ${ux.colorize('dim', `${lineCount} lines`)}`);
                return { success: true, planFilePath, planContent };
            } else {
                this.warn('Plan file was not created by the agent');
                return { success: false, planFilePath: null, planContent: null };
            }
        } catch (error) {
            this.error(`Analysis phase failed: ${error.message}`);
            return { success: false, planFilePath: null, planContent: null };
        }
    }

    /**
     * Phase 2: Implementation Agent
     * Uses a single Opus 4.5-thinking max context to implement the plan
     */
    async runImplementationPhase(planFilePath, docSectionPath, codeRepoPath, model, verbose) {
        this.log(`\n${ux.colorize('bold', '✏️  Phase 2: Implementation Agent')}`);
        this.log(`${ux.colorize('dim', '─'.repeat(60))}`);
        this.log(`  Plan file:    ${ux.colorize('cyan', planFilePath)}`);
        this.log(`  Doc section:  ${ux.colorize('cyan', docSectionPath)}`);
        this.log(`  Model:        ${ux.colorize('cyan', model)}`);
        this.log(`${ux.colorize('dim', '─'.repeat(60))}\n`);

        const docsRoot = join(docSectionPath, '..');

        const prompt = `You are a documentation writer. Your job is to implement a documentation modification plan.

## Your Task

Read and implement the plan at: ${planFilePath}

The plan contains:
- Files to ADD (new documentation to create)
- Files to UPDATE (existing docs to modify)
- Files to REMOVE (obsolete docs to delete)

Each item includes code references - READ THOSE CODE FILES to understand what to document.

## Implementation Guidelines

### For NEW documentation:
1. Read the referenced code files thoroughly
2. Create the documentation file at the specified path
3. Follow the content outline provided in the plan
4. Use proper MDX format with frontmatter
5. Look at existing docs in ${docSectionPath} for style guidance

### For UPDATED documentation:
1. Read both the existing doc AND the referenced code files
2. Make the specific changes noted in the plan
3. Preserve structure and style where possible
4. Only change what needs to be corrected

### For REMOVED documentation:
1. Delete the specified file
2. Check if any other docs reference it and update those links

## Documentation Rules

When writing documentation, follow these rules from: @${docsRoot}/.cursor/rules.mdc

## Important

- THE CODE IS THE SOURCE OF TRUTH - always refer to code for accurate information
- Read ALL referenced code files before writing
- Be thorough but concise - document what users need to know
- Don't add speculative content not supported by code
- Maintain consistent style with existing documentation

Now read the plan file and implement all changes.`;

        try {
            this.log(`  ${ux.colorize('dim', 'Running implementation agent...')}`);
            this.log(`  ${ux.colorize('dim', 'This may take several minutes...')}\n`);

            const escapedPrompt = escapeShellArg(prompt);
            
            // Run from docs root to have access to both plan and doc section
            const workspaceRoot = join(codeRepoPath, '..');

            const result = execSync(
                `cursor agent --print --model ${model} --force --workspace "${workspaceRoot}" "${escapedPrompt}"`,
                {
                    cwd: workspaceRoot,
                    encoding: 'utf-8',
                    maxBuffer: 50 * 1024 * 1024,
                    timeout: 1800000, // 30 minute timeout
                }
            );

            if (verbose) {
                this.log(`\n${ux.colorize('dim', 'Agent output:')}`);
                this.log(result.substring(0, 2000) + (result.length > 2000 ? '...' : ''));
            }

            this.log(`\n  ${ux.colorize('green', '✓ Implementation complete')}`);
            return { success: true };
        } catch (error) {
            this.error(`Implementation phase failed: ${error.message}`);
            return { success: false };
        }
    }

    async run() {
        const { flags } = await this.parse(ExpandDocs);
        const docsRoot = join(__dirname, '..', '..');

        // Resolve source and doc-section from --repo or explicit flags
        let sourcePath = flags.source;
        let docSection = flags['doc-section'];

        if (flags.repo) {
            const repoConfig = REPO_CONFIG[flags.repo];
            if (!repoConfig) {
                this.error(`Unknown repo: ${flags.repo}. Valid options: ${Object.keys(REPO_CONFIG).join(', ')}`);
            }
            // Use repo config, but allow explicit flags to override
            sourcePath = sourcePath || join(docsRoot, '..', repoConfig.sourcePath);
            docSection = docSection || repoConfig.docSection;
        }

        // Validate that we have both source and doc-section
        if (!sourcePath || !docSection) {
            this.error('Either --repo or both --source and --doc-section are required');
        }

        const codeRepoPath = sourcePath.startsWith('/') ? sourcePath : join(process.cwd(), sourcePath);
        const docSectionPath = join(docsRoot, docSection);

        // Validate paths
        if (!existsSync(codeRepoPath)) {
            this.error(`Code repository not found: ${codeRepoPath}`);
        }

        if (!existsSync(docSectionPath)) {
            this.warn(`Documentation section ${docSection} doesn't exist yet. Will be created if needed.`);
            mkdirSync(docSectionPath, { recursive: true });
        }

        // Generate plan file path
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const planFilePath = flags['plan-file'] || join(docsRoot, '_plans', `${docSection}-plan-${timestamp}.txt`);
        
        // Ensure plan directory exists
        const planDir = dirname(planFilePath);
        if (!existsSync(planDir)) {
            mkdirSync(planDir, { recursive: true });
        }

        this.log(`\n${ux.colorize('bold', '🔄 Expand Docs - Two-Phase Documentation Sync')}`);
        this.log(`${ux.colorize('dim', '═'.repeat(60))}`);
        this.log(`  Phase 1: Analysis    → Create modification plan`);
        this.log(`  Phase 2: Implement   → Execute the plan`);
        this.log(`${ux.colorize('dim', '═'.repeat(60))}`);

        const startTime = Date.now();

        // ─────────────────────────────────────────────────────────────────────────
        // PHASE 1: Analysis Agent
        // ─────────────────────────────────────────────────────────────────────────
        const analysisResult = await this.runAnalysisPhase(
            codeRepoPath,
            docSectionPath,
            docSection,
            flags.model,
            planFilePath,
            flags.verbose
        );

        if (!analysisResult.success) {
            this.error('Analysis phase failed. Cannot proceed.');
        }

        // Check if we should stop after planning
        if (flags['dry-run'] || flags['plan-only']) {
            this.log(`\n${ux.colorize('yellow', 'Stopping after analysis (--dry-run or --plan-only).')}`);
            this.log(`Plan file: ${ux.colorize('cyan', planFilePath)}`);
            this.log(`\nTo implement, run again without --dry-run flag.`);
            return;
        }

        // ─────────────────────────────────────────────────────────────────────────
        // PHASE 2: Implementation Agent
        // ─────────────────────────────────────────────────────────────────────────
        const implementResult = await this.runImplementationPhase(
            planFilePath,
            docSectionPath,
            codeRepoPath,
            flags.model,
            flags.verbose
        );

        // Final summary
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        this.log(`\n${ux.colorize('dim', '═'.repeat(60))}`);
        this.log(ux.colorize('bold', '📋 Summary'));
        this.log(`  ${ux.colorize('dim', 'Analysis:')}       ${analysisResult.success ? ux.colorize('green', '✓ Complete') : ux.colorize('red', '✗ Failed')}`);
        this.log(`  ${ux.colorize('dim', 'Implementation:')} ${implementResult.success ? ux.colorize('green', '✓ Complete') : ux.colorize('red', '✗ Failed')}`);
        this.log(`  ${ux.colorize('dim', 'Plan file:')}      ${planFilePath}`);
        this.log(`  ${ux.colorize('dim', 'Total time:')}     ${totalTime}s`);
        this.log(`${ux.colorize('dim', '═'.repeat(60))}\n`);

        if (!implementResult.success) {
            this.exit(1);
        }
    }
}
