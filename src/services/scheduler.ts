/**
 * Scheduler Service — queues emails for future delivery.
 *
 * Scheduled emails are persisted to a JSON file so they survive process
 * restarts. A background interval (60 s) checks for due emails and sends
 * them via the SMTPService. Overdue emails from a previous run are processed
 * immediately on startup.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { ScheduledEmail, SendEmailOptions } from "../types/index.js";
import { SMTPService } from "./smtp-service.js";
import { logger } from "../utils/logger.js";

/** Maximum number of seconds in the future for a scheduled send (30 days). */
const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
/** Minimum lead time: at least 60 s in the future. */
const MIN_LEAD_TIME_MS = 60 * 1000;
/** Background check interval. */
const POLL_INTERVAL_MS = 60 * 1000;

export class SchedulerService {
  private items: ScheduledEmail[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly smtpService: SMTPService,
    private readonly storePath: string,
  ) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    this.load();
    // Process any overdue emails from a previous session immediately
    void this.processDue();
    this.timer = setInterval(() => void this.processDue(), POLL_INTERVAL_MS);
    logger.info(`Scheduler started (${this.pending().length} pending)`, "Scheduler");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.persist();
    logger.info("Scheduler stopped", "Scheduler");
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Queue an email for delivery at `sendAt`.
   *
   * @throws If `sendAt` is not in the valid window [now+60s, now+30d].
   * @returns The assigned scheduled email ID.
   */
  schedule(options: SendEmailOptions, sendAt: Date): string {
    const now = Date.now();
    const delta = sendAt.getTime() - now;

    if (delta < MIN_LEAD_TIME_MS) {
      throw new Error(
        `send_at must be at least 60 seconds in the future (got ${Math.round(delta / 1000)}s).`
      );
    }
    if (delta > MAX_SCHEDULE_AHEAD_MS) {
      throw new Error(
        `send_at must be within 30 days from now (got ${Math.round(delta / 86400000)}d).`
      );
    }

    const item: ScheduledEmail = {
      id: crypto.randomUUID(),
      scheduledAt: sendAt.toISOString(),
      options,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    this.items.push(item);
    this.persist();
    logger.info(`Email scheduled for ${item.scheduledAt}`, "Scheduler", { id: item.id });
    return item.id;
  }

  /** Cancel a pending scheduled email. Returns false if not found or not pending. */
  cancel(id: string): boolean {
    const item = this.items.find(i => i.id === id);
    if (!item || item.status !== "pending") return false;
    item.status = "cancelled";
    this.persist();
    logger.info(`Scheduled email cancelled`, "Scheduler", { id });
    return true;
  }

  /** Return all scheduled emails sorted by scheduledAt ascending. */
  list(): ScheduledEmail[] {
    return [...this.items].sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
    );
  }

  /** Return only pending items. */
  pending(): ScheduledEmail[] {
    return this.items.filter(i => i.status === "pending");
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  async processDue(): Promise<void> {
    const now = new Date();
    const due = this.items.filter(
      i => i.status === "pending" && new Date(i.scheduledAt) <= now
    );

    if (due.length === 0) return;

    logger.info(`Processing ${due.length} due scheduled email(s)`, "Scheduler");

    for (const item of due) {
      try {
        const result = await this.smtpService.sendEmail(item.options);
        if (result.success) {
          item.status = "sent";
          logger.info(`Scheduled email sent`, "Scheduler", { id: item.id, messageId: result.messageId });
        } else {
          item.status = "failed";
          item.error = result.error;
          logger.warn(`Scheduled email failed`, "Scheduler", { id: item.id, error: result.error });
        }
      } catch (err: any) {
        item.status = "failed";
        item.error = err.message;
        logger.error(`Scheduled email threw`, "Scheduler", { id: item.id, error: err.message });
      }
    }

    this.persist();
  }

  private load(): void {
    if (!existsSync(this.storePath)) return;
    try {
      const raw = readFileSync(this.storePath, "utf-8");
      const parsed = JSON.parse(raw) as ScheduledEmail[];
      if (Array.isArray(parsed)) {
        this.items = parsed;
        logger.debug(`Loaded ${this.items.length} scheduled emails from disk`, "Scheduler");
      }
    } catch (err) {
      logger.warn("Failed to load scheduled emails from disk — starting fresh", "Scheduler", err);
      this.items = [];
    }
  }

  private persist(): void {
    try {
      writeFileSync(this.storePath, JSON.stringify(this.items, null, 2), "utf-8");
    } catch (err) {
      logger.warn("Failed to persist scheduled emails", "Scheduler", err);
    }
  }
}
