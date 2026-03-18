import { describe, it, expect } from 'vitest';
import { isUpgrade } from './escalation.js';
import type { PermissionPreset } from '../config/schema.js';

// ─── isUpgrade ──────────────────────────────────────────────────────────────────

describe('isUpgrade', () => {
  it('read_only → supervised is an upgrade', () => {
    expect(isUpgrade('read_only', 'supervised')).toBe(true);
  });

  it('supervised → read_only is not an upgrade', () => {
    expect(isUpgrade('supervised', 'read_only')).toBe(false);
  });

  it('read_only → full is an upgrade', () => {
    expect(isUpgrade('read_only', 'full')).toBe(true);
  });

  it('full → read_only is not an upgrade', () => {
    expect(isUpgrade('full', 'read_only')).toBe(false);
  });

  it('same preset is not an upgrade', () => {
    const presets: PermissionPreset[] = ['read_only', 'send_only', 'supervised', 'full', 'custom'];
    for (const p of presets) {
      expect(isUpgrade(p, p)).toBe(false);
    }
  });

  it('read_only → send_only is an upgrade', () => {
    expect(isUpgrade('read_only', 'send_only')).toBe(true);
  });

  it('send_only → read_only is not an upgrade', () => {
    expect(isUpgrade('send_only', 'read_only')).toBe(false);
  });

  it('send_only → supervised is an upgrade', () => {
    expect(isUpgrade('send_only', 'supervised')).toBe(true);
  });

  it('supervised → full is an upgrade', () => {
    expect(isUpgrade('supervised', 'full')).toBe(true);
  });

  it('full → supervised is not an upgrade', () => {
    expect(isUpgrade('full', 'supervised')).toBe(false);
  });

  it('supervised → custom is not an upgrade (same level)', () => {
    expect(isUpgrade('supervised', 'custom')).toBe(false);
  });

  it('custom → supervised is not an upgrade (same level)', () => {
    expect(isUpgrade('custom', 'supervised')).toBe(false);
  });

  it('custom → full is an upgrade', () => {
    expect(isUpgrade('custom', 'full')).toBe(true);
  });
});
