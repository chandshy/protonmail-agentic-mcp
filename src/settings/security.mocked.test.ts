/**
 * Tests for security.ts functions that require module-level mocking.
 * Separate file so the mocks do not affect the main security.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';

// ─── tryGenerateSelfSignedCert — catch path ──────────────────────────────────
// Mock child_process before importing the module under test so spawnSync throws.
vi.mock('child_process', () => ({
  spawnSync: vi.fn(() => { throw new Error('ENOENT: openssl not found'); }),
}));

// Mock os.networkInterfaces to throw for the getPrimaryLanIP catch-path test.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    networkInterfaces: vi.fn(() => { throw new Error('simulated OS failure'); }),
  };
});

import { tryGenerateSelfSignedCert, getPrimaryLanIP } from './security.js';

describe('tryGenerateSelfSignedCert (spawnSync throws)', () => {
  it('returns null when spawnSync throws', () => {
    const result = tryGenerateSelfSignedCert();
    expect(result).toBeNull();
  });
});

describe('getPrimaryLanIP (networkInterfaces throws)', () => {
  it('returns empty string when networkInterfaces() throws', () => {
    const ip = getPrimaryLanIP();
    expect(ip).toBe('');
  });
});
