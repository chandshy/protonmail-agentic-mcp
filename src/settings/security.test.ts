import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RateLimiter,
  isValidChallengeId,
  sanitizeText,
  isValidEscalationTarget,
  isValidOrigin,
} from './security.js';

// ─── RateLimiter ────────────────────────────────────────────────────────────────

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter?.dispose();
  });

  it('allows requests within the limit', () => {
    limiter = new RateLimiter(3, 60_000);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(true);
  });

  it('blocks after exceeding the limit', () => {
    limiter = new RateLimiter(2, 60_000);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(false);
  });

  it('count() returns current count without consuming a slot', () => {
    limiter = new RateLimiter(5, 60_000);
    expect(limiter.count('x')).toBe(0);

    limiter.check('x');
    limiter.check('x');
    expect(limiter.count('x')).toBe(2);

    // count() itself should not increment
    expect(limiter.count('x')).toBe(2);
  });

  it('uses a sliding window — old requests do not count', () => {
    vi.useFakeTimers();
    try {
      limiter = new RateLimiter(2, 1000); // 2 requests per 1 second

      limiter.check('b');
      limiter.check('b');
      expect(limiter.check('b')).toBe(false); // at limit

      // Advance past the window
      vi.advanceTimersByTime(1100);

      // Old requests have expired; new ones should be allowed
      expect(limiter.check('b')).toBe(true);
      expect(limiter.check('b')).toBe(true);
      expect(limiter.check('b')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks keys independently', () => {
    limiter = new RateLimiter(1, 60_000);
    expect(limiter.check('ip1')).toBe(true);
    expect(limiter.check('ip2')).toBe(true);
    expect(limiter.check('ip1')).toBe(false);
    expect(limiter.check('ip2')).toBe(false);
  });
});

// ─── isValidChallengeId ─────────────────────────────────────────────────────────

describe('isValidChallengeId', () => {
  it('accepts a 32-char lowercase hex string', () => {
    expect(isValidChallengeId('a'.repeat(32))).toBe(true);
    expect(isValidChallengeId('0123456789abcdef0123456789abcdef')).toBe(true);
  });

  it('rejects strings that are too short or too long', () => {
    expect(isValidChallengeId('a'.repeat(31))).toBe(false);
    expect(isValidChallengeId('a'.repeat(33))).toBe(false);
  });

  it('rejects uppercase hex', () => {
    expect(isValidChallengeId('A'.repeat(32))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidChallengeId('g'.repeat(32))).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isValidChallengeId(null)).toBe(false);
    expect(isValidChallengeId(undefined)).toBe(false);
    expect(isValidChallengeId(123)).toBe(false);
  });
});

// ─── sanitizeText ───────────────────────────────────────────────────────────────

describe('sanitizeText', () => {
  it('preserves normal text', () => {
    expect(sanitizeText('Hello, world!')).toBe('Hello, world!');
  });

  it('strips control characters', () => {
    expect(sanitizeText('abc\x00def\x01ghi')).toBe('abcdefghi');
  });

  it('preserves tabs, newlines, and carriage returns', () => {
    expect(sanitizeText('line1\nline2\ttab\rreturn')).toBe('line1\nline2\ttab\rreturn');
  });

  it('respects maxLen parameter', () => {
    expect(sanitizeText('abcdefghij', 5)).toBe('abcde');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText(42)).toBe('');
  });

  it('trims whitespace after processing', () => {
    expect(sanitizeText('  hello  ')).toBe('hello');
  });
});

// ─── isValidEscalationTarget ────────────────────────────────────────────────────

describe('isValidEscalationTarget', () => {
  it('accepts "send_only"', () => {
    expect(isValidEscalationTarget('send_only')).toBe(true);
  });

  it('accepts "supervised"', () => {
    expect(isValidEscalationTarget('supervised')).toBe(true);
  });

  it('accepts "full"', () => {
    expect(isValidEscalationTarget('full')).toBe(true);
  });

  it('rejects "read_only"', () => {
    expect(isValidEscalationTarget('read_only')).toBe(false);
  });

  it('rejects "custom"', () => {
    expect(isValidEscalationTarget('custom')).toBe(false);
  });

  it('rejects random strings', () => {
    expect(isValidEscalationTarget('admin')).toBe(false);
    expect(isValidEscalationTarget('')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isValidEscalationTarget(null)).toBe(false);
    expect(isValidEscalationTarget(123)).toBe(false);
  });
});

// ─── isValidOrigin ──────────────────────────────────────────────────────────────

describe('isValidOrigin', () => {
  function mockReq(headers: Record<string, string> = {}) {
    return { headers } as unknown as import('http').IncomingMessage;
  }

  it('accepts localhost origin on the correct port', () => {
    const req = mockReq({ origin: 'http://localhost:8765' });
    expect(isValidOrigin(req, 8765, false)).toBe(true);
  });

  it('accepts 127.0.0.1 origin on the correct port', () => {
    const req = mockReq({ origin: 'http://127.0.0.1:8765' });
    expect(isValidOrigin(req, 8765, false)).toBe(true);
  });

  it('accepts https localhost origin', () => {
    const req = mockReq({ origin: 'https://localhost:8765' });
    expect(isValidOrigin(req, 8765, false)).toBe(true);
  });

  it('rejects unknown origins', () => {
    const req = mockReq({ origin: 'http://evil.com:8765' });
    expect(isValidOrigin(req, 8765, false)).toBe(false);
  });

  it('rejects localhost on a different port', () => {
    const req = mockReq({ origin: 'http://localhost:9999' });
    expect(isValidOrigin(req, 8765, false)).toBe(false);
  });

  it('accepts missing origin (defers to CSRF)', () => {
    const req = mockReq({});
    expect(isValidOrigin(req, 8765, false)).toBe(true);
  });

  it('falls back to referer when origin is absent', () => {
    const req = mockReq({ referer: 'http://localhost:8765/settings' });
    expect(isValidOrigin(req, 8765, false)).toBe(true);
  });

  it('rejects a port-prefix spoof via referer', () => {
    // "http://localhost:3000" should not match port 300
    const req = mockReq({ referer: 'http://localhost:30001/evil' });
    expect(isValidOrigin(req, 3000, false)).toBe(false);
  });
});
