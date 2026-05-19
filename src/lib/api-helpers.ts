// ============================================================
// AMYC Financial Management System - API Route Helpers
// Utilities for authentication, audit logging, and common patterns
// Enhanced with old/new value tracking for production auditing
// ============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { validateSessionAsync } from '@/lib/auth/server';

/**
 * Extract authenticated user ID from request headers.
 * Checks Authorization: Bearer <token> header.
 * Returns null if no valid session found.
 */
export async function getAuthUserId(request: NextRequest): Promise<number | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  const session = await validateSessionAsync(token);
  return session?.userId ?? null;
}

/**
 * Get the system admin user ID for audit logging when no authenticated user is available.
 * Falls back to the first admin user in the system.
 */
let cachedSystemUserId: number | null = null;

export async function getSystemUserId(): Promise<number> {
  if (cachedSystemUserId) return cachedSystemUserId;

  const admin = await db.user.findFirst({
    where: { role: 'admin', isActive: true },
    select: { id: true },
  });

  cachedSystemUserId = admin?.id ?? 1;
  return cachedSystemUserId as number;
}

/**
 * Create an audit log entry with the authenticated user ID from the request.
 * Falls back to the system admin user if no authenticated user is found.
 * Enhanced with old/new value tracking.
 */
export async function createAuditLog(
  request: NextRequest,
  data: {
    action: string;
    entity: string;
    entityId: number;
    details: string;
    oldValue?: string;
    newValue?: string;
  }
): Promise<void> {
  const userId = await getAuthUserId(request) ?? await getSystemUserId();

  await db.auditLog.create({
    data: {
      action: data.action,
      entity: data.entity,
      entityId: data.entityId,
      userId,
      details: data.details,
      oldValue: data.oldValue || null,
      newValue: data.newValue || null,
      ipAddress: request.headers.get('x-forwarded-for') || null,
      userAgent: request.headers.get('user-agent') || null,
    },
  });
}

/**
 * Create an audit log entry with a known user ID (not from request).
 */
export async function createAuditLogWithUser(
  userId: number,
  data: {
    action: string;
    entity: string;
    entityId: number;
    details: string;
    oldValue?: string;
    newValue?: string;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<void> {
  await db.auditLog.create({
    data: {
      action: data.action,
      entity: data.entity,
      entityId: data.entityId,
      userId,
      details: data.details,
      oldValue: data.oldValue || null,
      newValue: data.newValue || null,
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
    },
  });
}
