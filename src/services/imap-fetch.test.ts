/**
 * Tests for SimpleIMAPService methods that require mocking both ImapFlow
 * and mailparser (simpleParser).  These test the async fetch loops in:
 *   - getEmailById
 *   - fetchEmailFullSource (via downloadAttachment)
 *   - searchSingleFolder (via searchEmails)
 *
 * This file uses top-level vi.mock() to mock 'imapflow' and 'mailparser',
 * keeping these mocks isolated from other test files.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SimpleIMAPService } from "./simple-imap-service.js";

// ─── Module-level mocks ──────────────────────────────────────────────────────

vi.mock("imapflow", () => {
  const ImapFlow = vi.fn(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
    };
  });
  return { ImapFlow };
});

// Mock simpleParser to return a deterministic parsed email object
vi.mock("mailparser", () => ({
  simpleParser: vi.fn().mockResolvedValue({
    text: "Hello from parser",
    html: null,
    subject: "Parsed Subject",
    date: new Date("2024-01-15"),
    from: { text: "sender@example.com" },
    to: { text: "recipient@example.com" },
    cc: null,
    attachments: [],
    headers: new Map(),
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLock() {
  return { release: vi.fn() };
}

async function* asyncYield<T>(...items: T[]) {
  for (const item of items) yield item;
}

// ─── getEmailById ─────────────────────────────────────────────────────────────

describe("SimpleIMAPService.getEmailById (fetch loop)", () => {
  it("returns email from cache if present", async () => {
    const svc = new SimpleIMAPService();
    const email = {
      id: "1", folder: "INBOX", from: "a@b.com", to: [], subject: "s",
      body: "b", date: new Date(), isRead: false, isStarred: false, hasAttachment: false, isHtml: false,
    };
    (svc as any).setCacheEntry("1", email);

    const result = await svc.getEmailById("1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("1");
  });

  it("returns null when not connected and cache miss", async () => {
    const svc = new SimpleIMAPService();
    // isConnected=false by default
    const result = await svc.getEmailById("999");
    expect(result).toBeNull();
  });

  it("fetches and parses email via async iterator when not cached", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;

    const mockMessage = {
      uid: 42,
      source: Buffer.from("raw email bytes"),
      flags: new Set(["\\Seen"]),
    };

    const mockClient = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      fetch: vi.fn().mockReturnValue(asyncYield(mockMessage)),
    };
    (svc as any).client = mockClient;

    // Mock getFolders to return one folder
    vi.spyOn(svc, "getFolders").mockResolvedValue([
      { name: "INBOX", path: "INBOX", totalMessages: 1, unreadMessages: 0, folderType: "system" as const },
    ]);
    // Mock checkAndUpdateUidValidity (no-op)
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});

    const result = await svc.getEmailById("42");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("42");
    expect(result!.subject).toBe("Parsed Subject");
    expect(result!.body).toBe("Hello from parser");
    expect(result!.isRead).toBe(true);
    expect(result!.folder).toBe("INBOX");
  });

  it("skips messages with no source buffer", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;

    const mockMessage = { uid: 50, source: null, flags: new Set() };
    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      fetch: vi.fn().mockReturnValue(asyncYield(mockMessage)),
    };
    vi.spyOn(svc, "getFolders").mockResolvedValue([
      { name: "INBOX", path: "INBOX", totalMessages: 0, unreadMessages: 0, folderType: "system" as const },
    ]);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});

    const result = await svc.getEmailById("50");
    expect(result).toBeNull();
  });

  it("caches the fetched email for future lookups", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;

    const mockMessage = { uid: 55, source: Buffer.from("data"), flags: new Set() };
    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      fetch: vi.fn().mockReturnValue(asyncYield(mockMessage)),
    };
    vi.spyOn(svc, "getFolders").mockResolvedValue([
      { name: "INBOX", path: "INBOX", totalMessages: 0, unreadMessages: 0, folderType: "system" as const },
    ]);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});

    await svc.getEmailById("55");
    // Should now be in cache
    expect((svc as any).emailCache.has("55")).toBe(true);
  });

  it("returns email with attachment metadata stripped (line 778)", async () => {
    // Override simpleParser to return an email with attachments
    const { simpleParser } = await import("mailparser");
    (simpleParser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: "Body",
      html: null,
      subject: "Email with attachment",
      date: new Date("2024-03-01"),
      from: { text: "a@example.com" },
      to: { text: "b@example.com" },
      cc: null,
      attachments: [
        { filename: "report.pdf", contentType: "application/pdf", size: 2048, content: Buffer.from("PDF"), cid: "cid-1" },
      ],
      headers: new Map([["x-mailer", "TestMailer"]]),
    });

    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;

    const mockMessage = { uid: 66, source: Buffer.from("raw"), flags: new Set(["\\Answered"]), envelope: {} };
    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      fetch: vi.fn().mockReturnValue(asyncYield(mockMessage)),
    };
    vi.spyOn(svc, "getFolders").mockResolvedValue([
      { name: "INBOX", path: "INBOX", totalMessages: 0, unreadMessages: 0, folderType: "system" as const },
    ]);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});

    const result = await svc.getEmailById("66");

    expect(result).not.toBeNull();
    expect(result!.hasAttachment).toBe(true);
    expect(result!.attachments).toHaveLength(1);
    // content field should be stripped from the returned value
    expect((result!.attachments![0] as any).content).toBeUndefined();
    expect(result!.attachments![0].filename).toBe("report.pdf");
  });

  it("re-throws when getMailboxLock fails (catch block line 795)", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;
    (svc as any).client = {
      getMailboxLock: vi.fn().mockRejectedValue(new Error("IMAP lock error")),
    };
    vi.spyOn(svc, "getFolders").mockResolvedValue([
      { name: "INBOX", path: "INBOX", totalMessages: 0, unreadMessages: 0, folderType: "system" as const },
    ]);

    await expect(svc.getEmailById("42")).rejects.toThrow("IMAP lock error");
  });
});

// ─── fetchEmailFullSource (private) with real simpleParser mock ───────────────

describe("SimpleIMAPService private fetchEmailFullSource (with parser)", () => {
  it("parses and returns email with attachments when source is present", async () => {
    // Override simpleParser to return attachments for this test
    const { simpleParser } = await import("mailparser");
    (simpleParser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: "Body text",
      html: null,
      subject: "With Attachments",
      date: new Date("2024-01-15"),
      from: { text: "a@b.com" },
      to: { text: "b@c.com" },
      cc: null,
      attachments: [
        { filename: "doc.pdf", contentType: "application/pdf", size: 1024, content: Buffer.from("pdf"), cid: undefined },
      ],
      headers: new Map(),
    });

    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;

    const mockMessage = { uid: 60, source: Buffer.from("raw"), flags: new Set(["\\Flagged"]) };
    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      fetch: vi.fn().mockReturnValue(asyncYield(mockMessage)),
    };
    vi.spyOn(svc, "getFolders").mockResolvedValue([
      { name: "INBOX", path: "INBOX", totalMessages: 0, unreadMessages: 0, folderType: "system" as const },
    ]);

    const result = await (svc as any).fetchEmailFullSource("60");

    expect(result).not.toBeNull();
    expect(result!.subject).toBe("With Attachments");
    expect(result!.isStarred).toBe(true);
    expect(result!.hasAttachment).toBe(true);
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments![0].filename).toBe("doc.pdf");
  });
});

// ─── searchSingleFolder (private) ────────────────────────────────────────────

describe("SimpleIMAPService private searchSingleFolder", () => {
  it("returns empty array when client search finds no UIDs", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;

    const mockClient = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      search: vi.fn().mockResolvedValue([]),
    };
    (svc as any).client = mockClient;

    const result = await (svc as any).searchSingleFolder("INBOX", {}, 50);

    expect(result).toEqual([]);
    expect(mockClient.search).toHaveBeenCalledTimes(1);
  });

  it("fetches and returns matching messages via getEmailById", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;

    const mockEmail = {
      id: "70", folder: "INBOX", from: "a@b.com", to: [], subject: "Test Email",
      body: "Email body text that is long enough to need truncation in search results",
      date: new Date(), isRead: false, isStarred: false, hasAttachment: true, isHtml: false,
      attachments: [
        { filename: "doc.pdf", contentType: "application/pdf", size: 1024, contentId: "cid1" },
      ],
    };

    const mockClient = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      search: vi.fn().mockResolvedValue([70]),
    };
    (svc as any).client = mockClient;
    // Mock getEmailById to return the email directly (avoids needing full IMAP stack)
    vi.spyOn(svc, "getEmailById").mockResolvedValue(mockEmail);

    const results = await (svc as any).searchSingleFolder("INBOX", { subject: "test" }, 50);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("70");
    expect(results[0].subject).toBe("Test Email");
    // Attachment metadata should be present in search result (content stripped)
    expect(results[0].attachments![0].filename).toBe("doc.pdf");
  });

  it("covers all search criteria options", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;

    const mockClient = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      search: vi.fn().mockResolvedValue([]),
    };
    (svc as any).client = mockClient;

    // Pass all available search options to cover the criteria-building code
    const options = {
      from: "alice@example.com",
      to: "bob@example.com",
      subject: "Hello",
      body: "world",
      text: "searchable",
      bcc: "hidden@example.com",
      header: { field: "X-Custom", value: "value" },
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
      isRead: true,
      isStarred: false,
      answered: true,
      isDraft: false,
      larger: 1000,
      smaller: 100000,
      sentBefore: new Date("2024-12-31"),
      sentSince: new Date("2024-01-01"),
    };

    await (svc as any).searchSingleFolder("INBOX", options, 50);

    // The search should have been called with populated criteria
    expect(mockClient.search).toHaveBeenCalledTimes(1);
    const criteria = mockClient.search.mock.calls[0][0];
    expect(criteria.from).toBe("alice@example.com");
    expect(criteria.subject).toBe("Hello");
    expect(criteria.seen).toBe(true);
    expect(criteria.flagged).toBe(false);
  });

  it("respects the limit parameter (slices UID array before fetching)", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;

    // 5 UIDs returned by search, limit=2 → only first 2 are processed
    const mockClient = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      search: vi.fn().mockResolvedValue([1, 2, 3, 4, 5]),
    };
    (svc as any).client = mockClient;
    vi.spyOn(svc, "getEmailById").mockResolvedValue(null);

    const results = await (svc as any).searchSingleFolder("INBOX", {}, 2);
    // With limit=2, getEmailById is called at most 2 times
    expect((svc.getEmailById as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(2);
    expect(results).toHaveLength(0); // all returned null
  });

  it("returns [] immediately when client is null (line 805)", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).client = null;

    const results = await (svc as any).searchSingleFolder("INBOX", {}, 50);
    expect(results).toEqual([]);
  });
});

// ─── fetchEmailFullSource: null source branch ─────────────────────────────────

describe("SimpleIMAPService private fetchEmailFullSource null source", () => {
  it("returns null when fetch yields a message with no source (line 1058)", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;

    const mockMessage = { uid: 88, source: null, flags: new Set() };
    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      fetch: vi.fn().mockReturnValue(asyncYield(mockMessage)),
    };
    vi.spyOn(svc, "getFolders").mockResolvedValue([
      { name: "INBOX", path: "INBOX", totalMessages: 0, unreadMessages: 0, folderType: "system" as const },
    ]);

    const result = await (svc as any).fetchEmailFullSource("88");
    expect(result).toBeNull();
  });
});
