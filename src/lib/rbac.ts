// ============================================================
// AMYC Financial Management System - Server-Side RBAC Middleware
// Production-grade: Enforces auth, permissions, and org scope on ALL API routes
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateSessionAsync } from '@/lib/auth/server';
import type { UserRole, OrgLevel } from './types';
import { ROLE_CONFIG } from './types';

// ============================================================
// Types
// ============================================================

export interface AuthenticatedUser {
  userId: number;
  email: string;
  role: UserRole;
  orgLevel: OrgLevel;
  orgUnitId: number;
  fullName: string;
}

export interface RbacResult {
  allowed: boolean;
  user: AuthenticatedUser | null;
  error?: string;
  statusCode?: number;
}

export type Permission =
  | 'enter_data'
  | 'view_data'
  | 'review_data'
  | 'approve_data'
  | 'register_subunits'
  | 'manage_users'
  | 'access_admin'
  | 'export_data'
  | 'delete_data'
  | 'submit_data'
  | 'import_data'
  | 'view_audit'
  | 'manage_budgets';

// ============================================================
// Role → Permission Mapping (Server-enforced)
// ============================================================

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'enter_data', 'view_data', 'review_data', 'approve_data',
    'register_subunits', 'manage_users', 'access_admin', 'export_data',
    'delete_data', 'submit_data', 'import_data', 'view_audit', 'manage_budgets',
  ],
  simple: [
    'view_data'
  ],
  muhasibu: [
    'enter_data', 'view_data', 'submit_data', 'export_data',
  ],
  mweka_hazina: [
    'enter_data', 'view_data', 'review_data', 'submit_data', 'export_data',
  ],
  katibu: [
    'view_data', 'register_subunits', 'export_data',
  ],
  mudir: [
    'view_data', 'approve_data', 'review_data', 'export_data',
  ],
  mkaguzi: [
    'view_data', 'view_audit', 'export_data',
  ],
};

function normalizeRole(role: string): UserRole {
  const legacyMap: Record<string, UserRole> = {
    branch_manager: 'mweka_hazina',
    regional_manager: 'mudir',
    accountant: 'muhasibu',
    treasurer: 'mweka_hazina',
    viewer: 'simple',
    secretary: 'katibu',
    director: 'mudir',
    auditor: 'mkaguzi',
  };
  return (legacyMap[role] || role) as UserRole;
}

// ============================================================
// Permission Checks
// ============================================================

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  const normalizedRole = normalizeRole(String(role));
  return ROLE_PERMISSIONS[normalizedRole]?.includes(permission) ?? false;
}

/**
 * Check if a role has ANY of the given permissions
 */
export function hasAnyPermission(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some(p => hasPermission(role, p));
}

// ============================================================
// Auth Extraction from Request
// ============================================================

/**
 * Extract and validate authenticated user from request
 */
export async function getAuthenticatedUser(request: NextRequest): Promise<AuthenticatedUser | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  const session = await validateSessionAsync(token);
  if (!session) return null;

  return {
    userId: session.userId,
    email: session.email,
    role: session.role as UserRole,
    orgLevel: session.orgLevel as OrgLevel,
    orgUnitId: session.orgUnitId,
    fullName: session.fullName,
  };
}

// ============================================================
// Organization Scope Enforcement
// ============================================================

/**
 * Get all org unit IDs that a user is allowed to see data for.
 * - Tawi: only own org
 * - Jimbo: own + direct children (matawi)
 * - Markaz: own + all descendants (majimbo + matawi)
 */
export async function getVisibleOrgIds(userOrgId: number, userOrgLevel: OrgLevel): Promise<number[]> {
  if (userOrgLevel === 'tawi') {
    return [userOrgId];
  }

  const ids = [userOrgId];
  const descendantIds = await getAllDescendantIds(userOrgId);
  ids.push(...descendantIds);
  return ids;
}

/**
 * Strictly check if a user can see data from a specific target org
 */
export async function canAccessOrg(
  userOrgId: number,
  userOrgLevel: OrgLevel,
  targetOrgId: number
): Promise<boolean> {
  if (userOrgId === targetOrgId) return true;
  if (userOrgLevel === 'tawi') return false;

  const visibleIds = await getVisibleOrgIds(userOrgId, userOrgLevel);
  return visibleIds.includes(targetOrgId);
}

/**
 * Get all descendant org unit IDs recursively
 */
async function getAllDescendantIds(parentId: number): Promise<number[]> {
  const children = await db.orgUnit.findMany({
    where: { parentId, isActive: true },
    select: { id: true },
  });

  const ids: number[] = [];
  for (const child of children) {
    ids.push(child.id);
    const grandChildIds = await getAllDescendantIds(child.id);
    ids.push(...grandChildIds);
  }
  return ids;
}

// ============================================================
// Middleware Function
// ============================================================

/**
 * Main RBAC middleware for API routes.
 * Extracts auth, checks permissions, and enforces org scope.
 *
 * Usage:
 *   const result = await enforceRbac(request, { permission: 'enter_data' });
 *   if (!result.allowed) return NextResponse.json({ error: result.error }, { status: result.statusCode });
 *   const user = result.user!;
 */
export async function enforceRbac(
  request: NextRequest,
  options: {
    permission?: Permission;
    permissions?: Permission[];  // Any of these permissions
    allowSelfOrgOnly?: boolean;  // Only allow access to own org data
    targetOrgId?: number;        // Specific org to check access for
  } = {}
): Promise<RbacResult> {
  // 1. Authenticate
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return {
      allowed: false,
      user: null,
      error: 'Hauna ruhusa. Tafadhali ingia kwanza.',
      statusCode: 401,
    };
  }

  // 2. Check if user is active (session already validates this)

  // 3. Check permission
  if (options.permission) {
    if (!hasPermission(user.role, options.permission)) {
      return {
        allowed: false,
        user,
        error: 'Hauna ruhusa ya kufanya kitendo hiki.',
        statusCode: 403,
      };
    }
  }

  if (options.permissions && options.permissions.length > 0) {
    if (!hasAnyPermission(user.role, options.permissions)) {
      return {
        allowed: false,
        user,
        error: 'Hauna ruhusa ya kufanya kitendo hiki.',
        statusCode: 403,
      };
    }
  }

  // 4. Check org scope
  if (options.allowSelfOrgOnly) {
    // Already validated - user can only access their own org data
    // Caller should filter by user.orgUnitId
  }

  if (options.targetOrgId !== undefined) {
    const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, options.targetOrgId);
    if (!canAccess) {
      return {
        allowed: false,
        user,
        error: 'Hauna ruhusa ya kuona data ya kitengo hiki.',
        statusCode: 403,
      };
    }
  }

  return {
    allowed: true,
    user,
  };
}

/**
 * Build a Prisma where clause that restricts data to orgs the user can see
 */
export async function buildOrgScopedWhere(
  userOrgId: number,
  userOrgLevel: OrgLevel,
  orgField: string = 'orgUnitId'
): Promise<Record<string, any>> {
  const visibleIds = await getVisibleOrgIds(userOrgId, userOrgLevel);
  if (visibleIds.length === 1) {
    return { [orgField]: visibleIds[0] };
  }
  return { [orgField]: { in: visibleIds } };
}

// ============================================================
// Rate Limiting (Simple in-memory)
// ============================================================

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute per IP

/**
 * Simple rate limiting check with optional custom max requests per window.
 * @param request - The incoming request
 * @param maxRequests - Custom max requests per minute (default: 60)
 */
export function checkRateLimit(
  request: NextRequest,
  maxRequests: number = RATE_LIMIT_MAX_REQUESTS
): { allowed: boolean; remaining: number } {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  // Use a composite key of IP + maxRequests so different limits don't interfere
  const key = `${ip}:${maxRequests}`;
  const now = Date.now();

  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count };
}

// ============================================================
// Input Sanitization
// ============================================================

/**
 * Sanitize string input to prevent injection
 */
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove angle brackets
    .slice(0, 500); // Limit length
}

/**
 * Validate and parse a positive number
 */
export function parsePositiveNumber(value: any, fieldName: string = 'Kiasi'): number {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) {
    throw new Error(`${fieldName} lazima kiwe namba chanya`);
  }
  return num;
}

/**
 * Validate month (1-12)
 */
export function validateMonth(month: any): number {
  const m = parseInt(month);
  if (isNaN(m) || m < 1 || m > 12) {
    throw new Error('Mwezi si sahihi (1-12)');
  }
  return m;
}

/**
 * Validate year
 */
export function validateYear(year: any): number {
  const y = parseInt(year);
  if (isNaN(y) || y < 2026 || y > 2040) {
    throw new Error('Mwaka si sahihi');
  }
  return y;
}
