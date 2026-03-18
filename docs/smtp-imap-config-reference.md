# Proton Mail SMTP & IMAP Configuration Reference

**Sources:**
- https://proton.me/support/smtp-submission
- https://proton.me/support/imap-smtp-and-pop3-setup
- https://proton.me/support/comprehensive-guide-to-bridge-settings
**Retrieved:** 2026-03-17

---

## Two Distinct Connection Modes

This project supports **both** connection paths. They have very different security and auth requirements.

---

## Path 1: Proton Bridge (localhost) — Default

For reading mail and sending via Bridge. Requires **Proton Bridge desktop app** running.

| Setting | IMAP | SMTP |
|---|---|---|
| Host | `127.0.0.1` | `127.0.0.1` |
| Port | `1143` | `1025` |
| Encryption | STARTTLS | STARTTLS |
| Auth | Bridge password | Bridge password |
| TLS cert | Self-signed (export from Bridge) | Self-signed (export from Bridge) |

**Security note:** Bridge's self-signed cert should be **explicitly trusted** by the client, not bypassed with `rejectUnauthorized: false`. Export the cert from Bridge → Settings → Export TLS certificates.

---

## Path 2: Direct SMTP Submission (smtp.protonmail.ch) — Sending Only

For sending only, without Bridge. Requires a **paid Proton Mail plan with a custom domain**.

| Setting | Value |
|---|---|
| Host | `smtp.protonmail.ch` |
| Port | `587` |
| Encryption | STARTTLS (SSL on 465 is acceptable fallback) |
| Auth method | PLAIN or LOGIN |
| Username | Custom domain email address |
| Password | **SMTP token** (not the account password) |

### SMTP Token Generation
Settings → All Settings → IMAP/SMTP → SMTP tokens → Generate token
**Tokens are shown only once.** Each application/device should use its own token.

**Important restrictions:**
- Only available on **paid plans**
- Only works with **custom domain addresses** (not @proton.me)
- Emails sent this way are **not end-to-end encrypted** (but have zero-access encryption at rest)
- No documented rate limits or message size limits from Proton

---

## Bridge Connection Modes (SSL vs STARTTLS)

Bridge supports both modes via its settings. The defaults:
- STARTTLS on port 1143 (IMAP) / 1025 (SMTP)
- SSL on port 993 (IMAP) / 465 (SMTP) if configured

The Bridge setting to switch: **Bridge Settings → Connection method → STARTTLS / SSL**

---

## Environment Variables for This Project

```
PROTONMAIL_USERNAME=your@custom.domain        # or @proton.me for Bridge mode
PROTONMAIL_PASSWORD=<Bridge password>          # from Bridge app, NOT your account password
PROTONMAIL_SMTP_HOST=127.0.0.1                # use smtp.protonmail.ch for direct
PROTONMAIL_SMTP_PORT=1025                      # 587 for direct, 465 for direct SSL
PROTONMAIL_IMAP_HOST=127.0.0.1
PROTONMAIL_IMAP_PORT=1143
PROTONMAIL_BRIDGE_CERT=/path/to/bridge.crt     # NEW: exported Bridge cert for proper TLS
DEBUG=false
```
