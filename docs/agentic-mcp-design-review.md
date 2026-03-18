# Agentic MCP Design Review — protonmail-mcp-server

**Researched:** 2026-03-17 | **Sources:** modelcontextprotocol.io specification (2025-11-25)

---

## What MCP Actually Offers (Vs. What This Server Uses)

The MCP protocol has four first-class primitives. This server currently uses **one of four**:

| Primitive | Control | Purpose | This server |
|---|---|---|---|
| **Tools** | Model-controlled | Actions & queries | ✅ Used (but under-configured) |
| **Resources** | App-driven | Addressable data via URI | ❌ Missing |
| **Prompts** | User-controlled | Workflow templates / slash commands | ❌ Missing |
| **Sampling** | Server-initiated | Server requests LLM completions (nested agent calls) | ❌ Missing |

Additionally unused protocol features:
- `structuredContent` + `outputSchema` on tool results (structured vs. raw JSON strings)
- Progress notifications for long-running / bulk operations
- Cursor-based pagination (MCP spec standard)
- Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`)
- `listChanged` capability for dynamic tool lists

---

## Current Problems for Agents

### 1. Agent must parse JSON from text blobs
Every tool response wraps its output in a `text` content block containing a JSON string:
```json
{ "type": "text", "text": "{\"id\": \"12345\", \"subject\": \"...\"}" }
```
The agent has to read natural language, identify JSON, parse it, then reason about it. The MCP spec provides `structuredContent` + `outputSchema` specifically to eliminate this.

### 2. No addressable email data (Resources missing)
Emails and folders are not addressable. An agent that wants to refer back to email `12345` has no URI — it has to re-call `get_email_by_id("12345")` every time. Resources with URIs like `email://INBOX/12345` let the host cache, subscribe to changes, and inject them directly into context without tool calls.

### 3. Bulk operations are silent black boxes
`bulk_delete_emails` and `bulk_move_emails` give no feedback until they're done. For 50-email batches this can take seconds. The MCP `progress` notification system exists exactly for this — agents can show the user incremental status.

### 4. Pagination is offset-based, not cursor-based
The MCP spec defines opaque cursor-based pagination for all list operations. Offset pagination breaks when the mailbox changes mid-page (new emails arrive, emails deleted). Cursors are stable across mutations.

### 5. Tool descriptions are emoji-heavy and agent-unfriendly
Descriptions like `"🚀 Send email with advanced options (templates, scheduling, attachments)"` waste tokens, the emoji gives the agent no useful information. Descriptions should be dense, precise, and structured to help the model select the right tool.

### 6. No workflow prompts
Common email agent tasks — triage inbox, draft a reply from thread context, generate a daily summary, find and archive newsletters — have no pre-built prompt scaffolding. Prompts let users trigger these as slash commands and give the agent a structured starting context.

### 7. Misleading semantics in `add_label`
`add_label` actually **moves** an email to `Labels/{label}`. This is an implementation artifact of ProtonMail Bridge's IMAP representation. An agent that expects labels to be non-destructive (additive) will make incorrect decisions. The tool description partially explains this but the tool name itself is wrong.

### 8. No tool annotations (safety hints)
MCP tool annotations tell clients which tools are destructive, read-only, or idempotent. Without them, every client must treat every tool as potentially destructive and may ask for confirmation on `get_emails` the same as `bulk_delete_emails`.

### 9. Analytics tools fetch 200 emails per call
Even with the TTL cache added in the security fix, these tools require a network round-trip to IMAP for 200 messages. There's no lightweight "what's my unread count?" endpoint — an agent has to fetch everything to answer a simple question.

---

## Recommended Changes

### Priority 1 — Structured Output (High impact, low effort)

Add `outputSchema` to every tool definition and return `structuredContent` alongside the text block. This is the single highest-leverage change — agents can immediately use typed data without parsing.

**Example — `get_emails`:**
```typescript
// Tool definition addition:
outputSchema: {
  type: "object",
  properties: {
    emails: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          from: { type: "string" },
          subject: { type: "string" },
          bodyPreview: { type: "string" },
          date: { type: "string", format: "date-time" },
          isRead: { type: "boolean" },
          isStarred: { type: "boolean" },
          hasAttachment: { type: "boolean" },
          folder: { type: "string" }
        },
        required: ["id", "from", "subject", "date", "isRead"]
      }
    },
    total: { type: "number" },
    nextCursor: { type: "string" }
  }
}

// Tool result addition:
return {
  content: [{ type: "text", text: JSON.stringify(result) }],
  structuredContent: result  // ← same object, now formally typed
};
```

### Priority 2 — Tool Annotations (High impact, zero runtime cost)

Add `annotations` to every tool definition. This lets clients differentiate safe reads from destructive writes without needing to parse descriptions.

```typescript
// Read-only tools:
annotations: { readOnlyHint: true, openWorldHint: true }

// Mutating but reversible (mark read, star):
annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }

// Irreversible / destructive:
annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
```

Full classification:
| Tool | readOnly | destructive | idempotent |
|---|---|---|---|
| `get_emails`, `get_email_by_id`, `search_emails`, `get_folders`, `get_connection_status`, `get_logs` | true | — | — |
| `mark_email_read`, `star_email` | false | false | true |
| `sync_emails`, `sync_folders`, `clear_cache` | false | false | true |
| `send_email`, `send_test_email`, `create_folder`, `move_email`, `bulk_move_emails`, `add_label`, `bulk_add_label` | false | false | false |
| `delete_email`, `bulk_delete_emails`, `delete_folder` | false | **true** | false |
| `rename_folder` | false | false | false |

### Priority 3 — Resources (Medium effort, large agentic value)

Expose emails and folders as MCP Resources with a custom URI scheme. This lets the host inject email content directly into agent context without tool calls, and lets clients cache content.

**URI scheme:**
```
email://INBOX/12345        → individual email (full content)
email://Sent/67890
folder://INBOX             → folder with stats
folder://                  → all folders list
```

**Resource template:**
```typescript
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: "email://{folder}/{id}",
      name: "Email Message",
      description: "A specific email message by folder and UID",
      mimeType: "application/json"
    },
    {
      uriTemplate: "folder://{path}",
      name: "Email Folder",
      description: "An email folder with message count and stats",
      mimeType: "application/json"
    }
  ]
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const emailMatch = uri.match(/^email:\/\/([^/]+)\/(\d+)$/);
  if (emailMatch) {
    const [, folder, id] = emailMatch;
    const email = await imapService.getEmailById(id);
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(email),
        annotations: {
          audience: ["assistant"],
          priority: 0.9,
          lastModified: email?.date?.toISOString()
        }
      }]
    };
  }
  // ... folder handling
});
```

**Tool integration:** `get_emails` and `search_emails` should return `resource_link` content blocks for each email, in addition to the summary data. The agent then fetches full content only for emails it needs.

```typescript
// In get_emails response:
content: [
  { type: "text", text: JSON.stringify(summary) },  // list view for context
  ...emails.map(e => ({
    type: "resource_link",
    uri: `email://${e.folder}/${e.id}`,
    name: e.subject,
    description: `From: ${e.from} | ${e.date}`,
    mimeType: "application/json",
    annotations: { audience: ["assistant"], priority: 0.7 }
  }))
],
structuredContent: summary
```

### Priority 4 — Prompts (Medium effort, major UX value for agentic workflows)

Expose reusable workflow templates. These become slash commands in Claude desktop and structured starting points for autonomous agents.

**Recommended prompts:**

```typescript
prompts: [
  {
    name: "triage_inbox",
    title: "Triage Inbox",
    description: "Scan unread emails, categorize by urgency, and suggest actions (reply/archive/delete/snooze)",
    arguments: [
      { name: "limit", description: "Max emails to review (default 20)", required: false },
      { name: "focus", description: "Topic or sender to prioritize", required: false }
    ]
  },
  {
    name: "compose_reply",
    title: "Compose Reply",
    description: "Draft a reply to a specific email, preserving thread context and tone",
    arguments: [
      { name: "emailId", description: "UID of the email to reply to", required: true },
      { name: "intent", description: "Brief description of what to say", required: false }
    ]
  },
  {
    name: "daily_briefing",
    title: "Daily Email Briefing",
    description: "Summarize today's emails: unread count, key senders, action items, and calendar mentions",
    arguments: []
  },
  {
    name: "find_unsubscribe",
    title: "Find Newsletter/Subscription Emails",
    description: "Identify bulk/newsletter/subscription emails and offer to unsubscribe or archive",
    arguments: [
      { name: "folder", description: "Folder to search (default: INBOX)", required: false }
    ]
  },
  {
    name: "thread_summary",
    title: "Summarize Email Thread",
    description: "Fetch all messages in a thread and produce a concise summary with action items",
    arguments: [
      { name: "emailId", description: "Any message UID in the thread", required: true }
    ]
  }
]
```

**Prompt handler example — `triage_inbox`:**
```typescript
case "triage_inbox": {
  const limit = parseInt(args?.limit as string ?? "20");
  const recentEmails = await imapService.getEmails("INBOX", limit);
  const unread = recentEmails.filter(e => !e.isRead);
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are managing a ProtonMail inbox. Review these ${unread.length} unread emails and for each one:
1. Assess urgency (urgent / normal / low)
2. Suggest action: reply_needed / archive / delete / forward / snooze
3. If reply_needed, draft a 1-sentence suggested response

Emails:
${JSON.stringify(unread.map(e => ({
  id: e.id,
  from: e.from,
  subject: e.subject,
  preview: e.bodyPreview,
  date: e.date,
  hasAttachment: e.hasAttachment
})), null, 2)}

Use the available MCP tools to take actions on emails the user approves.`
        }
      }
    ]
  };
}
```

### Priority 5 — Progress Notifications for Bulk Operations

For `bulk_delete_emails` and `bulk_move_emails`, emit progress notifications so agents and users can track status on large batches.

```typescript
// In bulk_delete_emails handler:
const progressToken = request.params._meta?.progressToken;
let processed = 0;
const total = emailIds.length;

for (const emailId of emailIds) {
  await imapService.deleteEmail(emailId);
  processed++;
  if (progressToken) {
    await server.notification({
      method: "notifications/progress",
      params: {
        progressToken,
        progress: processed,
        total,
        message: `Deleted ${processed} of ${total} emails`
      }
    });
  }
}
```

### Priority 6 — Cursor-Based Pagination (MCP Spec Alignment)

Replace offset-based pagination with opaque cursors. Cursors are stable across mutations (new emails arriving won't shift offsets).

```typescript
// Cursor format (base64 encoded internal state):
interface EmailCursor {
  folder: string;
  lastUid: number;
  direction: "older" | "newer";
}

function encodeCursor(c: EmailCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(token: string): EmailCursor {
  return JSON.parse(Buffer.from(token, "base64url").toString());
}

// Tool input schema change:
// Remove: offset (number)
// Add: cursor (string, optional) — opaque token from previous response

// Tool output (structuredContent):
{
  emails: [...],
  nextCursor: "eyJmb2xkZXIiOiJJTkJPWCIsImxhc3RVaWQiOjEyMzQ0LCJkaXJlY3Rpb24iOiJvbGRlciJ9",
  // nextCursor absent = no more results
}
```

### Priority 7 — New Lightweight Tools

Add tools that give agents precise data without requiring large fetches:

```typescript
// Quick status check without fetching all emails:
{
  name: "get_unread_count",
  description: "Get unread email count per folder. Use before get_emails to decide whether to fetch.",
  inputSchema: { type: "object", properties: {} }
}

// Convenience wrapper for the most common move operation:
{
  name: "archive_email",
  description: "Move email to Archive folder. Prefer this over move_email for archiving.",
  inputSchema: {
    type: "object",
    properties: {
      emailId: { type: "string" },
    },
    required: ["emailId"]
  }
}

// Reply with thread context pre-filled:
{
  name: "reply_to_email",
  description: "Send a reply to an existing email. Automatically sets In-Reply-To, References, and Re: subject prefix.",
  inputSchema: {
    type: "object",
    properties: {
      emailId: { type: "string", description: "UID of email to reply to" },
      body: { type: "string" },
      isHtml: { type: "boolean", default: false },
      replyAll: { type: "boolean", default: false, description: "Include all original CC recipients" }
    },
    required: ["emailId", "body"]
  }
}
```

### Priority 8 — Clean Up Tool Names and Descriptions

Remove emojis (token waste), tighten descriptions to action + scope + output, and fix `add_label` semantics.

**Rename:** `add_label` → `move_to_label` (or explain clearly it's a move, not a tag add)

**Description pattern:** `{verb} {object}. {key parameter notes}. Returns {output summary}.`

**Before:**
```
"🚀 Send email with advanced options (templates, scheduling, attachments)"
```

**After:**
```
"Send an email via ProtonMail SMTP. Supports To/CC/BCC, HTML or plain text body, priority, reply-to, and base64-encoded attachments. Returns messageId on success."
```

---

## Implementation Order

| Phase | Changes | Effort | Impact |
|---|---|---|---|
| **1** | `outputSchema` + `structuredContent` on all tools; tool `annotations` | ~3h | Immediately improves every agent interaction |
| **2** | Clean tool descriptions (remove emojis, fix `add_label` naming) | ~1h | Reduces token waste, improves tool selection accuracy |
| **3** | Lightweight tools: `get_unread_count`, `archive_email`, `reply_to_email` | ~2h | Enables efficient agentic workflows |
| **4** | Progress notifications for bulk operations | ~1h | Transparency on long ops |
| **5** | Resource layer (email:// and folder:// URIs) | ~4h | Enables host-level caching, direct context injection |
| **6** | Prompt templates (5 workflows) | ~3h | Slash commands + structured agent starting contexts |
| **7** | Cursor-based pagination | ~2h | MCP spec alignment, stable pagination |
| **8** | `listChanged` capability | ~30min | Supports dynamic tool discovery |

---

## Data Format Summary for Agents

### Preferred response shape per tool category

**List tools** (`get_emails`, `search_emails`):
```json
{
  "emails": [
    { "id": "12345", "from": "alice@example.com", "subject": "Hello", "date": "2026-03-17T10:00:00Z",
      "isRead": false, "isStarred": false, "hasAttachment": false, "folder": "INBOX",
      "bodyPreview": "First 150 chars of body..." }
  ],
  "total": 142,
  "nextCursor": "<opaque>"
}
```

**Single item** (`get_email_by_id`):
```json
{
  "id": "12345", "from": "alice@example.com", "to": ["me@proton.me"],
  "subject": "Hello", "body": "Full body here", "isHtml": false,
  "date": "2026-03-17T10:00:00Z", "folder": "INBOX",
  "isRead": true, "isStarred": false, "hasAttachment": true,
  "attachments": [{ "filename": "doc.pdf", "contentType": "application/pdf", "size": 12345 }]
}
```

**Action tools** (`send_email`, `delete_email`, `move_email`, etc.):
```json
{ "success": true, "messageId": "abc@proton.me" }
// or
{ "success": false, "reason": "Email delivery failed" }
```

**Bulk action tools**:
```json
{ "success": 47, "failed": 3, "errors": ["Email 999 not found", "..."] }
```

**Status tools** (`get_connection_status`, `get_unread_count`):
```json
{
  "smtp": { "connected": true, "host": "127.0.0.1", "port": 1025 },
  "imap": { "connected": true, "host": "127.0.0.1", "port": 1143 },
  "unreadByFolder": { "INBOX": 12, "Spam": 0 }
}
```

---

## Key References

- [MCP Tools Spec](https://modelcontextprotocol.io/docs/concepts/tools) — structuredContent, outputSchema, annotations
- [MCP Resources Spec](https://modelcontextprotocol.io/docs/concepts/resources) — URI templates, subscriptions, annotations
- [MCP Prompts Spec](https://modelcontextprotocol.io/docs/concepts/prompts) — workflow templates, slash commands
- [MCP Sampling](https://modelcontextprotocol.io/docs/concepts/sampling) — server-initiated LLM calls for agentic behavior
- [MCP Pagination](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination.md) — cursor-based pagination spec
- [MCP Progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress.md) — streaming progress notifications
- [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices.md)
