import { Command, Flags } from '@oclif/core';
import { config } from 'dotenv';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname as pathDirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

// Load .env.local from the Documentation directory
config({ path: join(__dirname, '..', '..', '.env.local') });

const DEFAULT_GORGIAS_DOMAIN = 'researchanddesire';
const DEFAULT_EMAIL = 'aj@researchanddesire.com';
const DEFAULT_CLOSED_VIEW_ID = '1465345'; // Default view for closed tickets

// ANSI color codes
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

/**
 * Escape a string for use in a shell command
 */
function escapeShellArg(arg) {
  // Replace single quotes with escaped single quotes and wrap in single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export default class GorgiasTickets extends Command {
  static description =
    'Fetch closed Gorgias tickets and optionally analyze them for documentation gaps';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --limit 10',
    '<%= config.bin %> <%= command.id %> --analyze --limit 5',
  ];

  static flags = {
    limit: Flags.integer({
      char: 'l',
      description: 'Number of tickets to fetch per page (max 100)',
      default: 100,
    }),
    'max-pages': Flags.integer({
      char: 'm',
      description: 'Maximum number of pages to fetch (0 = all)',
      default: 0,
    }),
    'view-id': Flags.string({
      char: 'v',
      description: 'Gorgias view ID to filter tickets (defaults to closed tickets view)',
      env: 'GORGIAS_CLOSED_VIEW_ID',
      default: DEFAULT_CLOSED_VIEW_ID,
    }),
    'all-statuses': Flags.boolean({
      char: 'a',
      description: 'Include all ticket statuses, not just closed',
      default: false,
    }),
    analyze: Flags.boolean({
      description: 'Analyze tickets for documentation gaps and update docs if needed',
      default: false,
    }),
  };

  /**
   * Get the Gorgias API base URL
   */
  getApiBase() {
    const apiUrl = process.env.GORGIAS_API_URL;
    if (apiUrl) {
      return apiUrl.replace(/\/$/, '');
    }
    return `https://${DEFAULT_GORGIAS_DOMAIN}.gorgias.com/api`;
  }

  /**
   * Get the authorization header for Gorgias API
   */
  getAuthHeader() {
    const email = process.env.GORGIAS_EMAIL || DEFAULT_EMAIL;
    const apiKey = process.env.GORGIAS_API_KEY;

    if (!apiKey) {
      throw new Error(
        'Missing GORGIAS_API_KEY environment variable.\n' +
        'Add it to Documentation/.env.local:\n' +
        '  GORGIAS_API_KEY=your-api-key\n' +
        '  GORGIAS_EMAIL=your-email@example.com (optional, defaults to ' +
        DEFAULT_EMAIL +
        ')'
      );
    }

    const credentials = Buffer.from(`${email}:${apiKey}`).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * Fetch a page of tickets from Gorgias
   */
  async fetchTicketsPage(cursor = null, limit = 100, viewId = null) {
    const params = new URLSearchParams({
      order_by: 'created_datetime:desc',
      trashed: 'false',
      limit: String(limit),
    });

    if (cursor) {
      params.set('cursor', cursor);
    }

    if (viewId) {
      params.set('view_id', viewId);
    }

    const url = `${this.getApiBase()}/tickets?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: this.getAuthHeader(),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gorgias API error: ${response.status} ${response.statusText}\n${text}`);
    }

    return response.json();
  }

  /**
   * Fetch detailed ticket information including messages
   */
  async fetchTicketDetails(ticketId) {
    const url = `${this.getApiBase()}/tickets/${ticketId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: this.getAuthHeader(),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gorgias API error fetching ticket ${ticketId}: ${response.status}\n${text}`);
    }

    return response.json();
  }

  /**
   * Commit documentation changes for a ticket
   */
  commitDocsChanges(ticketId, subject, docsRoot) {
    try {
      // Stage all changes
      execSync('git add -A', {
        cwd: docsRoot,
        encoding: 'utf-8',
      });

      // Check if there are staged changes
      const status = execSync('git diff --cached --name-only', {
        cwd: docsRoot,
        encoding: 'utf-8',
      }).trim();

      if (!status) {
        this.log(`  ${c.dim}No changes to commit${c.reset}`);
        return false;
      }

      // Create commit message
      const sanitizedSubject = subject.replace(/"/g, '\\"').substring(0, 100);
      const commitMessage = `docs: update to address ticket #${ticketId}\n\nSubject: ${sanitizedSubject}`;

      execSync(`git commit -m "${commitMessage}"`, {
        cwd: docsRoot,
        encoding: 'utf-8',
      });

      this.log(`  ${c.green}✓ Changes committed${c.reset}`);
      return true;
    } catch (error) {
      this.log(`  ${c.red}✗ Git commit failed: ${error.message}${c.reset}`);
      return false;
    }
  }

  /**
   * Add a tag to a Gorgias ticket
   */
  async addTagToTicket(ticketId, tagName) {
    const url = `${this.getApiBase()}/tickets/${ticketId}/tags`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: this.getAuthHeader(),
      },
      body: JSON.stringify({
        names: [tagName],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to add tag to ticket ${ticketId}: ${response.status}\n${text}`);
    }

    // Some endpoints return empty responses on success
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /**
   * Extract clean message data optimized for AI analysis
   */
  extractMessagesForAI(ticketDetails) {
    const messages = ticketDetails.messages || [];

    return messages
      .filter((msg) => msg.public !== false) // Exclude internal notes
      .map((msg) => ({
        from_agent: msg.from_agent,
        text: msg.stripped_text || msg.body_text || '',
      }));
  }

  /**
   * Extract metadata from ticket details (tags, custom fields)
   */
  extractTicketMetadata(details) {
    const tags = (details.tags || []).map((t) => t.name);
    const customFields = details.custom_fields || {};
    const contactReason = customFields['11996']?.value || null;
    const product = customFields['11997']?.value || null;

    return { tags, contactReason, product };
  }

  /**
   * Fetch all ticket IDs with pagination
   */
  async fetchAllTicketIds(limit, maxPages, viewId, allStatuses = false) {
    const ticketIds = [];
    let cursor = null;
    let pageCount = 0;

    const statusLabel = allStatuses ? 'all' : 'closed';
    this.log(`\n${c.cyan}${c.bold}📥 Fetching ${statusLabel} ticket IDs from Gorgias...${c.reset}\n`);

    while (true) {
      pageCount++;
      this.log(`  ${c.gray}Fetching page ${pageCount}...${c.reset}`);

      const result = await this.fetchTicketsPage(cursor, limit, viewId);
      const tickets = result.data || [];

      const filteredTickets = allStatuses
        ? tickets
        : tickets.filter((t) => t.status === 'closed');

      for (const ticket of filteredTickets) {
        ticketIds.push({
          id: ticket.id,
          subject: ticket.subject,
          channel: ticket.channel,
          created_datetime: ticket.created_datetime,
          customer_name: ticket.customer?.name || ticket.customer?.email || null,
        });
      }

      if (allStatuses) {
        this.log(`    ${c.green}✓${c.reset} Got ${c.bold}${tickets.length}${c.reset} tickets ${c.dim}(total: ${ticketIds.length})${c.reset}`);
      } else {
        this.log(
          `    ${c.green}✓${c.reset} Got ${c.bold}${filteredTickets.length}${c.reset} closed ${c.dim}(total: ${ticketIds.length})${c.reset}`
        );
      }

      const nextCursor = result.meta?.next_cursor;
      if (!nextCursor || tickets.length === 0) {
        this.log(`  ${c.dim}No more pages.${c.reset}\n`);
        break;
      }

      if (maxPages > 0 && pageCount >= maxPages) {
        this.log(`  ${c.yellow}Reached max pages (${maxPages}).${c.reset}\n`);
        break;
      }

      cursor = nextCursor;
    }

    return ticketIds;
  }

  /**
   * Fetch full conversation data for all tickets
   */
  async fetchAllConversations(ticketInfos) {
    const conversations = [];

    this.log(`${c.cyan}${c.bold}💬 Fetching message details for ${ticketInfos.length} tickets...${c.reset}\n`);

    for (let i = 0; i < ticketInfos.length; i++) {
      const info = ticketInfos[i];
      this.log(`  ${c.dim}[${i + 1}/${ticketInfos.length}]${c.reset} Ticket ${c.yellow}#${info.id}${c.reset}`);

      try {
        const details = await this.fetchTicketDetails(info.id);
        const messages = this.extractMessagesForAI(details);
        const { tags, contactReason, product } = this.extractTicketMetadata(details);

        conversations.push({
          ticket_id: info.id,
          subject: info.subject,
          channel: info.channel,
          contact_reason: contactReason,
          product,
          tags,
          messages,
        });

        this.log(`    ${c.green}✓${c.reset} ${messages.length} messages`);
      } catch (error) {
        this.log(`    ${c.red}✗ Error: ${error.message}${c.reset}`);
      }

      if (i < ticketInfos.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    this.log('');
    return conversations;
  }

  /**
   * Analyze a conversation and update documentation if needed
   * Returns true if new docs were created, false otherwise
   */
  analyzeAndUpdateDocs(conversation, docsRoot) {
    const conversationJson = JSON.stringify(conversation, null, 2);

    const prompt = `You are analyzing a customer support conversation to determine if the documentation needs updating.

## Support Ticket Data
\`\`\`json
${conversationJson}
\`\`\`

## Your Task

1. **Identify the customer's problem** from the conversation messages (from_agent: false = customer, from_agent: true = agent)

2. **Search the existing documentation** in this workspace to determine if it already covers this problem adequately. @${docsRoot}/Documentation
   - Look in the relevant product folder based on the "product" field (e.g., "Lockbox" -> Documentation/lockbox/, "Dashboard" -> Documentation/dashboard/, "Trainer" -> Documentation/dtt/, "OSSM" -> Documentation/ossm/, "Wireless Remote" -> Documentation/radr/)
   - If the product is not in the Documentation folder, check the "Documentation/shop" folder.
   - Check FAQs, quick-start guides, and technical docs

3. **Make a decision**:
   - If the documentation ALREADY covers this problem adequately: Output exactly "DOCS_EXIST" on a line by itself and explain why no changes are needed.
   - If the documentation does NOT cover this problem OR is incomplete: Update or create the necessary documentation.

## Rules for Documentation Updates
- Only create/update docs if there's a genuine gap
- Don't make unnecessary changes
- Place new content in the most appropriate existing file, or create a new file only if necessary
- Follow the existing MDX format and structure
- Be concise and helpful

## Output Format
Your FINAL line must be exactly one of:
- "DOCS_EXIST" - if no documentation changes were needed and were made
- "DOCS_CREATED" - if you created or updated documentation


When rewriting apply these rules:

@${docsRoot}/.cursor/rules.mdc
`;

    const escapedPrompt = escapeShellArg(prompt);

    try {
      const result = execSync(
        `cursor agent --print --model opus-4.5-thinking --force --workspace "${docsRoot}" ${escapedPrompt}`,
        {
          cwd: docsRoot,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
          timeout: 600000, // 10 minute timeout
        }
      );

      // Check the result to determine if docs were created
      const lines = result.trim().split('\n');
      const lastLine = lines[lines.length - 1].trim();

      if (lastLine === 'DOCS_CREATED') {
        return true;
      }

      return false;
    } catch (error) {
      this.log(`    ${c.red}⚠ AI analysis error: ${error.message}${c.reset}`);
      return false;
    }
  }

  /**
   * Process tickets with AI analysis
   */
  async analyzeTickets(conversations, docsRoot) {
    const results = [];

    this.log(`\n${c.magenta}${c.bold}🔍 Analyzing ${conversations.length} tickets for documentation gaps...${c.reset}\n`);

    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i];
      this.log(`\n${c.blue}${'─'.repeat(80)}${c.reset}`);
      this.log(`${c.bold}[${i + 1}/${conversations.length}]${c.reset} ${c.cyan}Analyzing Ticket ${c.yellow}#${conv.ticket_id}${c.reset}`);
      this.log(`  ${c.dim}Subject:${c.reset} ${conv.subject}`);
      this.log(`  ${c.dim}Product:${c.reset} ${c.magenta}${conv.product || 'Unknown'}${c.reset}`);
      this.log(`  ${c.dim}Contact Reason:${c.reset} ${conv.contact_reason || 'Unknown'}`);

      // Run AI analysis
      const docsCreated = this.analyzeAndUpdateDocs(conv, docsRoot);

      // Determine which tag to add
      const tagToAdd = docsCreated ? 'new-docs-made' : 'no-docs-made';

      if (docsCreated) {
        this.log(`  ${c.green}${c.bold}📝 Result: Documentation CREATED/UPDATED${c.reset}`);
        // Commit the documentation changes
        this.commitDocsChanges(conv.ticket_id, conv.subject, docsRoot);
      } else {
        this.log(`  ${c.yellow}📄 Result: No docs needed${c.reset}`);
      }
      this.log(`  ${c.dim}Adding tag: ${c.cyan}${tagToAdd}${c.reset}`);

      // Add tag to the ticket
      try {
        await this.addTagToTicket(conv.ticket_id, tagToAdd);
        this.log(`  ${c.green}✓ Tag added successfully${c.reset}`);
      } catch (error) {
        this.log(`  ${c.red}✗ Failed to add tag: ${error.message}${c.reset}`);
      }

      results.push({
        ticket_id: conv.ticket_id,
        subject: conv.subject,
        docs_created: docsCreated,
        tag_added: tagToAdd,
      });
    }

    return results;
  }

  async run() {
    const { flags } = await this.parse(GorgiasTickets);
    const limit = Math.min(flags.limit, 100);
    const maxPages = flags['max-pages'];
    const viewId = flags['view-id'];
    const allStatuses = flags['all-statuses'];
    const analyze = flags.analyze;

    const docsRoot = join(__dirname, '..', '..');

    try {
      // Step 1: Get all ticket IDs
      const ticketInfos = await this.fetchAllTicketIds(limit, maxPages, viewId, allStatuses);

      if (ticketInfos.length === 0) {
        this.log(`${c.yellow}⚠ No tickets found.${c.reset}`);
        return;
      }

      // Step 2: Fetch full details for each ticket
      const conversations = await this.fetchAllConversations(ticketInfos);


      // Step 3: Analyze tickets and update docs
      const results = await this.analyzeTickets(conversations, docsRoot);

      // Summary
      this.log(`\n${c.bold}${c.white}${'═'.repeat(80)}${c.reset}`);
      this.log(`${c.bold}${c.white}📊 SUMMARY${c.reset}`);
      this.log(`${c.bold}${c.white}${'═'.repeat(80)}${c.reset}`);

      const docsCreatedCount = results.filter((r) => r.docs_created).length;
      const noDocsCount = results.filter((r) => !r.docs_created).length;

      this.log(`\n  ${c.cyan}Total tickets analyzed:${c.reset}      ${c.bold}${results.length}${c.reset}`);
      this.log(`  ${c.green}Documentation created/updated:${c.reset} ${c.bold}${c.green}${docsCreatedCount}${c.reset}`);
      this.log(`  ${c.yellow}No documentation needed:${c.reset}       ${c.bold}${noDocsCount}${c.reset}`);

      if (docsCreatedCount > 0) {
        this.log(`\n${c.green}${c.bold}📝 Tickets with new docs:${c.reset}`);
        for (const r of results.filter((r) => r.docs_created)) {
          this.log(`  ${c.green}•${c.reset} ${c.yellow}#${r.ticket_id}${c.reset}: ${r.subject}`);
        }
      }

      this.log('');

    } catch (error) {
      this.error(error.message);
    }
  }
}
