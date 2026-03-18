# Last Audit Summary — Cycle #9
**Date:** 2026-03-18 01:40 Eastern
**Auditor:** Claude Sonnet 4.6 (auto-improve cycle)

---

## Scope

This cycle performed a focused audit of the areas flagged in Cycle #8's "Next Cycle Focus":
- `src/index.ts` — `move_to_label`, `remove_label`: handler-level numeric emailId guard
- `src/index.ts` — `save_draft`, `schedule_email`: attachment field validation (`args.attachments as any`)
- `src/services/simple-imap-service.ts` — `saveDraft`: attachment validation / sanitization
- `src/services/smtp-service.ts` — `sendEmail`: attachment validation (confirmed already thorough)
- `src/utils/helpers.ts` — current validation helpers (no changes needed)

No new HIGH or MEDIUM issues found. All cycle 1–8 fixes confirmed intact.

---

## Issues Confirmed / Fixed This Cycle

**[DONE] `move_to_label` — numeric emailId guard**
Handler now validates `args.emailId` with `!/^\d+$/.test(mtlEmailId)` at entry, before label validation and IMAP call. Returns `McpError(InvalidParams, "emailId must be a non-empty numeric UID string.")`. Consistent with all other single-email handlers fixed in Cycles #7 and #8.

**[DONE] `remove_label` — numeric emailId guard**
Same fix as `move_to_label`. `rlEmailId` local variable added. Validation runs before the existing `validateTargetFolder` check.

**[DONE] `saveDraft` attachment filename/contentType sanitization in `simple-imap-service.ts`**
Previous code passed `att.filename` and `att.contentType` directly to nodemailer without sanitization. A crafted attachment with CRLF in the filename (e.g. `"report.pdf\r\nContent-Type: text/html"`) would break the Content-Disposition MIME header. Similarly a CRLF-containing contentType would break the Content-Type MIME header.

Now fixed to match `smtp-service.ts sendEmail()` behavior:
- `filename`: `replace(/[\r\n\x00]/g, "")`, `slice(0, 255)`, fallback `"attachment"` if empty
- `contentType`: `replace(/[\r\n\x00]/g, "")`, validated against `/^[\w!#$&\-^]+\/[\w!#$&\-^+.]+$/`, falls back to `undefined` if invalid

**[DONE] `schedule_email` attachment validation — confirmed no gap**
`schedule_email` stores options to `schedulerService`, which eventually calls `smtpService.sendEmail()`. That path already has thorough attachment validation (count cap, size cap, filename sanitization, contentType validation). No additional fix needed.

**[DONE] Add 27 unit tests**
Three new `describe` blocks added to `src/utils/helpers.test.ts`:
- `move_to_label / remove_label handler validation (numeric emailId guard)` — 11 tests
- `saveDraft attachment filename sanitization` — 7 tests
- `saveDraft attachment contentType sanitization` — 9 tests

---

## Other Areas Reviewed (no issues found)

- `smtp-service.ts sendEmail()` attachment handling: count cap (20), per-file size cap (25 MB), total size cap (25 MB), filename strip + truncate, contentType format validation. Thorough — no gaps.
- `schedule_email` → `smtpService.sendEmail()`: attachment path goes through SMTP service validation. No gap.
- `src/utils/helpers.ts`: All validation helpers complete and tested. No changes needed.
- Handler-level validation sweep status: COMPLETE. All single-email action handlers and folder-path handlers have handler-level guards as of this cycle.

---

## Remaining / Newly Identified Issues

**[LOW] Code quality — unused imports / dead code scan**
Several cycles of refactoring may have left unused imports. A scan of `src/index.ts` and service files for `import X` references that are never used would improve code hygiene. Easy fix, zero risk.

**[LOW] Type safety — remaining `as any` casts**
Some `args.X as any` patterns remain in production code. These could be narrowed to proper types. `args.attachments as any` in `save_draft` and `schedule_email` are the most visible examples. Low effort, zero behavior change.

**[LOW] JSDoc coverage — public methods in service files**
`SimpleIMAPService` and `SmtpService` public methods lack JSDoc comments. Adding them improves IDE support and codebase comprehension.

**[MEDIUM] IMAP reconnect on TCP RST**
`ensureConnection()` relies on `isConnected` flag which doesn't detect silent TCP drops. Architectural — still deferred.

---

## Summary of Findings

| Severity | Count | Status |
|----------|-------|--------|
| HIGH     | 0     | — |
| MEDIUM   | 1     | IMAP reconnect (existing, architectural) |
| LOW      | 3     | unused imports, as-any casts, JSDoc gaps |

All HIGH/MEDIUM security issues from Cycles #1–8 are fixed and tested. Test count increased from 347 to 374 (+27 new tests). The systematic handler-level validation sweep is now COMPLETE — all single-email action handlers and folder-path handlers have been hardened. Focus shifts to code quality, type safety, and documentation in future cycles.
