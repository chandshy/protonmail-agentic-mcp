import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsService } from './analytics-service.js';
import type { EmailMessage } from '../types/index.js';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  const mockMessages: EmailMessage[] = [
    {
      id: '1',
      from: 'sender1@example.com',
      to: ['recipient@example.com'],
      subject: 'Test 1',
      body: 'Body 1',
      isHtml: false,
      date: new Date('2024-01-15T10:00:00Z'),
      folder: 'INBOX',
      isRead: true,
      isStarred: false,
      hasAttachment: false,
    },
    {
      id: '2',
      from: 'sender2@example.com',
      to: ['recipient@example.com'],
      subject: 'Test 2',
      body: 'Body 2',
      isHtml: false,
      date: new Date('2024-01-15T11:00:00Z'),
      folder: 'INBOX',
      isRead: false,
      isStarred: true,
      hasAttachment: true,
    },
    {
      id: '3',
      from: 'sender1@example.com',
      to: ['recipient@example.com'],
      subject: 'Test 3',
      body: 'Body 3',
      isHtml: true,
      date: new Date('2024-01-16T10:00:00Z'),
      folder: 'Sent',
      isRead: true,
      isStarred: false,
      hasAttachment: false,
    },
  ];

  beforeEach(() => {
    service = new AnalyticsService();
    service.updateEmails(mockMessages);
  });

  describe('getEmailStats', () => {
    it('should calculate total count', () => {
      const stats = service.getEmailStats();
      expect(stats.totalEmails).toBe(3);
    });

    it('should calculate unread count', () => {
      const stats = service.getEmailStats();
      expect(stats.unreadEmails).toBe(1);
    });

    it('should calculate starred count', () => {
      const stats = service.getEmailStats();
      expect(stats.starredEmails).toBe(1);
    });

    it('should calculate folder count', () => {
      const stats = service.getEmailStats();
      expect(stats.totalFolders).toBe(2);
    });

    it('should calculate storage', () => {
      const stats = service.getEmailStats();
      expect(stats.storageUsedMB).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty emails', () => {
      const emptyService = new AnalyticsService();
      const stats = emptyService.getEmailStats();
      expect(stats.totalEmails).toBe(0);
      expect(stats.unreadEmails).toBe(0);
      expect(stats.starredEmails).toBe(0);
    });
  });

  describe('getEmailAnalytics', () => {
    it('should return analytics object', () => {
      const analytics = service.getEmailAnalytics();
      expect(analytics).toBeDefined();
      expect(analytics.volumeTrends).toBeDefined();
      expect(analytics.topSenders).toBeDefined();
      expect(analytics.topRecipients).toBeDefined();
    });

    it('should include volume trends', () => {
      const analytics = service.getEmailAnalytics();
      expect(Array.isArray(analytics.volumeTrends)).toBe(true);
    });

    it('should include top senders and recipients', () => {
      const analytics = service.getEmailAnalytics();
      expect(Array.isArray(analytics.topSenders)).toBe(true);
      expect(Array.isArray(analytics.topRecipients)).toBe(true);
    });

    it('should return null responseTimeStats when no sent replies match received emails', () => {
      // The mock data has no inReplyTo headers, so there are no measurable response times.
      const analytics = service.getEmailAnalytics();
      expect(analytics.responseTimeStats).toBeNull();
    });

    it('should compute responseTimeStats when sent emails match received message-ids', () => {
      const received: EmailMessage = {
        id: '10',
        from: 'alice@example.com',
        to: ['me@example.com'],
        subject: 'Hello',
        body: 'Hi there',
        isHtml: false,
        date: new Date('2024-02-01T09:00:00Z'),
        folder: 'INBOX',
        isRead: true,
        isStarred: false,
        hasAttachment: false,
        headers: { 'message-id': '<msg-abc@example.com>' },
      };
      const reply: EmailMessage = {
        id: '11',
        from: 'me@example.com',
        to: ['alice@example.com'],
        subject: 'Re: Hello',
        body: 'Sure!',
        isHtml: false,
        date: new Date('2024-02-01T11:00:00Z'), // 2 hours later
        folder: 'Sent',
        isRead: true,
        isStarred: false,
        hasAttachment: false,
        inReplyTo: '<msg-abc@example.com>',
      };
      const svc = new AnalyticsService();
      svc.updateEmails([received], [reply]);
      const analytics = svc.getEmailAnalytics();
      expect(analytics.responseTimeStats).not.toBeNull();
      expect(analytics.responseTimeStats!.sampleSize).toBe(1);
      expect(analytics.responseTimeStats!.average).toBeCloseTo(2, 0); // ~2 hours
      expect(analytics.responseTimeStats!.fastest).toBeCloseTo(2, 0);
    });

    it('should include attachment stats', () => {
      const analytics = service.getEmailAnalytics();
      expect(analytics.attachmentStats).toBeDefined();
      expect(analytics.attachmentStats.totalAttachments).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getContacts', () => {
    it('should return contact list', () => {
      const contacts = service.getContacts();
      expect(Array.isArray(contacts)).toBe(true);
    });

    it('should limit results', () => {
      const contacts = service.getContacts(1);
      expect(contacts.length).toBeLessThanOrEqual(1);
    });

    it('should return empty array when no emails', () => {
      const emptyService = new AnalyticsService();
      const contacts = emptyService.getContacts();
      expect(contacts).toEqual([]);
    });
  });

  describe('getVolumeTrends', () => {
    it('should return volume trends', () => {
      const trends = service.getVolumeTrends(30);
      expect(Array.isArray(trends)).toBe(true);
    });

    it('should have date and count properties', () => {
      const trends = service.getVolumeTrends(7);
      if (trends.length > 0) {
        expect(trends[0]).toHaveProperty('date');
        expect(trends[0]).toHaveProperty('received');
        expect(trends[0]).toHaveProperty('sent');
      }
    });
  });

  describe('cache management', () => {
    it('should clear cache', () => {
      service.getEmailStats();
      expect(() => service.clearCache()).not.toThrow();
    });

    it('should clear all data', () => {
      expect(() => service.clearAll()).not.toThrow();
      const stats = service.getEmailStats();
      expect(stats.totalEmails).toBe(0);
    });
  });

  describe('updateEmails', () => {
    it('should update email data', () => {
      const newService = new AnalyticsService();
      newService.updateEmails(mockMessages);
      const stats = newService.getEmailStats();
      expect(stats.totalEmails).toBe(3);
    });

    it('should replace existing data', () => {
      service.updateEmails([mockMessages[0]]);
      const stats = service.getEmailStats();
      expect(stats.totalEmails).toBe(1);
    });
  });
});
