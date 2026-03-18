# Last Audit Summary — Cycle #17
**Date:** 2026-03-18 04:25 Eastern
**Auditor:** Claude Sonnet 4.6 (auto-improve cycle)

---

## Scope

This cycle audited:
- `src/index.ts` — all 5 registered MCP prompts (names, descriptions, arguments)
- `README.md` — "MCP Prompts" subsection completeness
- `src/settings/server.ts` — POST body validation on all routes; embedded HTML accuracy
- `src/settings/tui.ts` — general security scan
- `src/permissions/escalation.ts` — expiry check re-verification

---

## Issues Confirmed / Fixed This Cycle

**[DONE] README MCP Prompts section missing 2 of 5 prompts**

`src/index.ts` registers 5 prompts in `ListPromptsRequestSchema`:
`triage_inbox`, `compose_reply`, `daily_briefing`, `find_subscriptions`, `thread_summary`.

The README listed only 3 (`compose_reply`, `thread_summary`, `find_subscriptions`).
Fix: replaced the 3-item bullet list with a 5-row table covering all prompts and their arguments.

**[DONE] Settings server embedded HTML — "40 tools" stale in two places**

`src/settings/server.ts` lines 714 and 946 both said "All 40 tools" in the Full Access preset description. README (fixed Cycle #16) and CHANGELOG already said 47; the embedded HTML was overlooked.
Fix: both occurrences updated to "47 tools".

---

## Confirmed Clean Areas

**Settings server route validation — no gaps:**
- `POST /api/config`: port (integer 1–65535), host (non-empty, ≤253 chars, no control/whitespace), preset validated.
- `POST /api/preset`: allowlist `["full","read_only","supervised","send_only","custom"]` enforced.
- `POST /api/test-connection`: port, host, SSRF host allowlist all enforced.
- `POST /api/escalations/:id/approve`: 4-layer gate (rate limit + CSRF + Origin + `body.confirm === "APPROVE"`).
- `POST /api/escalations/:id/deny`: rate limit + CSRF.
- `POST /api/reset`: CSRF only (no body needed).

**Escalation expiry check intact (`src/permissions/escalation.ts` line 394):**
`if (Date.now() > new Date(e.expiresAt).getTime()) return { ok: false, error: "Challenge has expired." }`
Both `evictExpired()` (auto-marks pending → expired on read) and `approveEscalation()` (rejects late approvals) working correctly.

**Rate limiting confirmed:**
- General limiter: 120 req/min per IP wraps all routes.
- Escalation limiter: 20 req/min per IP wraps approve/deny routes.
- Both instantiated at server startup; no bypass paths found.

**TUI (`src/settings/tui.ts`):** No security concerns. Prompts are MCP-layer only; TUI has no access to or awareness of prompt registration.

**Zero avoidable `as any` casts** — confirmed clean from Cycles #10–#12, unchanged.
**416 tests pass** — unchanged.

---

## Summary of Findings

| Severity | Count | Status |
|----------|-------|--------|
| HIGH     | 0     | — |
| MEDIUM   | 0     | — |
| LOW      | 3     | All fixed: MCP prompts docs (2 missing), "40 tools" in HTML (2 occurrences) |

---

## Next Cycle Focus

Documentation and code quality are now in excellent shape after 17 cycles. Remaining open items:

1. **Cursor HMAC binding** (Item #5) — architectural improvement, moderate complexity, low security impact. Still deferred.
2. **`ensureConnection()` friendly error wrapping** (Item #31) — low priority usability improvement.
3. **`save_draft`/`schedule_email` attachment validation** (Item #14 from Cycle #8) — completed in Cycle #15 but the TODO entry was retained as a reference; confirmed DONE.
4. **Final comprehensive audit report** — With ~3-4 cycles remaining in the session window, consider producing a structured final audit report documenting the cumulative security posture of the codebase.

The codebase has reached a high level of maturity. No critical or high-severity issues have been open since Cycle #1. Consider declaring a "maintenance complete" state for this session.
