// ============================================================
// AMYC Financial Management System - Server-Side Auth Utilities
// Professional Financial System for Ansaar Muslim Youth Centre
// ============================================================

import crypto from 'crypto';
import { db } from '@/lib/db';
import { validatePasswordStrength } from '@/lib/types';

// ============================================================
// Constants
// ============================================================

const PASSWORD_SALT = 'AMYC_SALT_2024';
const SESSION_SECRET = process.env.SESSION_SECRET || 'AMYC_SESSION_SECRET_2024_CHANGE_IN_PRODUCTION';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_DURATION_HOURS = 24;

// Re-export password strength validation
export { validatePasswordStrength };

// ============================================================
// Types
// ============================================================

export interface SessionData {
  userId: number;
  email: string;
  role: string;
  orgLevel: string;
  orgUnitId: number;
  fullName: string;
  expiresAt: number;
}

export interface AuthResult {
  success: boolean;
  user?: {
    id: number;
    email: string;
    fullName: string;
    role: string;
    orgLevel: string;
    orgUnitId: number;
  };
  token?: string;
  error?: string;
  lockedUntil?: Date;
}

// ============================================================
// Password Hashing (SHA-256 for offline compatibility)
// ============================================================

/**
 * Hash a password using SHA-256 with salt.
 * Uses Node.js crypto module for server-side, compatible with the
 * client-side SubtleCrypto implementation in db-offline.ts.
 */
export function hashPassword(password: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(password + PASSWORD_SALT)
    .digest('hex');
  return hash;
}

/**
 * Verify a password against its hash
 */
export function verifyPassword(password: string, hash: string): boolean {
  const passwordHash = hashPassword(password);
  return passwordHash === hash;
}

// ============================================================
// Session Management
// ============================================================

/**
 * Create a session token containing user data, signed with HMAC-SHA256
 */
export function createSession(user: {
  id: number;
  email: string;
  fullName: string;
  role: string;
  orgLevel: string;
  orgUnitId: number;
}): string {
  const expiresAt = Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000;

  const payload: SessionData = {
    userId: user.id,
    email: user.email,
    role: user.role,
    orgLevel: user.orgLevel,
    orgUnitId: user.orgUnitId,
    fullName: user.fullName,
    expiresAt,
  };

  // Encode payload as base64
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, 'utf-8').toString('base64url');

  // Sign with HMAC-SHA256
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadB64)
    .digest('base64url');

  return `${payloadB64}.${signature}`;
}

/**
 * Validate a session token and return session data
 */
export function validateSession(token: string): SessionData | null {
  try {
    const [payloadB64, signature] = token.split('.');

    if (!payloadB64 || !signature) return null;

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(payloadB64)
      .digest('base64url');

    if (signature !== expectedSignature) return null;

    // Decode payload
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const payload: SessionData = JSON.parse(payloadJson);

    // Check expiration
    if (payload.expiresAt < Date.now()) return null;

    // Sync check: This is called from server context, so we use a sync-compatible approach
    // In practice, validateSessionAsync should be used for DB checks
    // For now, basic token validation is sufficient (user check is async below)

    return payload;
  } catch {
    return null;
  }
}

/**
 * Async version of validateSession that also checks user is still active
 */
export async function validateSessionAsync(token: string): Promise<SessionData | null> {
  const session = validateSession(token);
  if (!session) return null;

  // Verify user still exists and is active
  const user = await db.user.findUnique({
    where: { id: session.userId },
  });

  if (!user || !user.isActive) return null;

  // Check if user is currently locked
  if (user.lockedUntil && user.lockedUntil > new Date()) return null;

  return session;
}

// ============================================================
// Authentication
// ============================================================

/**
 * Authenticate a user by email and password.
 * Handles account lockout after 5 failed attempts (15 min lock).
 */
export async function authenticateUser(
  email: string,
  password: string
): Promise<AuthResult> {
  const trimmedEmail = email.trim().toLowerCase();

  // Find user by email
  const user = await db.user.findUnique({
    where: { email: trimmedEmail },
  });

  if (!user) {
    return {
      success: false,
      error: 'Barua pepe au nenosiri si sahihi', // Email or password is incorrect
    };
  }

  // Check if account is active
  if (!user.isActive) {
    return {
      success: false,
      error: 'Akaunti yako imezimwa. Wasiliana na msimamizi.', // Account is deactivated
    };
  }

  // Check if account is locked
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainingMs = user.lockedUntil.getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60000);
    return {
      success: false,
      error: `Akaunti yako imefungwa kwa sababu ya majaribio mengi yasiyofaulu. Jaribu tena baada ya dakika ${remainingMin}.`, // Account locked, try again in X minutes
      lockedUntil: user.lockedUntil,
    };
  }

  // Verify password
  if (!user.passwordHash) {
    return {
      success: false,
      error: 'Akaunti hii haijasanidiwa na nenosiri.',
    };
  }

  const isValid = verifyPassword(password, user.passwordHash);

  if (!isValid) {
    // Increment failed attempts
    const newAttempts = user.loginAttempts + 1;

    if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
      // Lock the account
      const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      await db.user.update({
        where: { id: user.id },
        data: {
          loginAttempts: newAttempts,
          lockedUntil,
        },
      });

      return {
        success: false,
        error: `Akaunti yako imefungwa kwa sababu ya majaribio ${MAX_LOGIN_ATTEMPTS} yasiyofaulu. Jaribu tena baada ya dakika 15.`,
        lockedUntil,
      };
    }

    await db.user.update({
      where: { id: user.id },
      data: { loginAttempts: newAttempts },
    });

    const remaining = MAX_LOGIN_ATTEMPTS - newAttempts;
    return {
      success: false,
      error: `Barua pepe au nenosiri si sahihi. Una majaribio ${remaining} yaliyosalia.`, // X attempts remaining
    };
  }

  // Successful login - reset attempts and update last login
  await db.user.update({
    where: { id: user.id },
    data: {
      loginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });

  // Create session token
  const token = createSession({
    id: user.id,
    email: user.email,
    fullName: user.fullName ?? user.email,
    role: user.role,
    orgLevel: user.orgLevel,
    orgUnitId: user.orgUnitId ?? 0,
  });

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName ?? user.email,
      role: user.role,
      orgLevel: user.orgLevel,
      orgUnitId: user.orgUnitId ?? 0,
    },
    token,
  };
}

// ============================================================
// Password Security
// ============================================================

/**
 * Change a user's password after verifying the current password
 */
export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { success: false, error: 'Mtumiaji hapatikani' };
  }

  // Verify current password
  if (!user.passwordHash || !verifyPassword(currentPassword, user.passwordHash)) {
    return { success: false, error: 'Nenosiri la sasa si sahihi' };
  }

  // Validate new password strength
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    return { success: false, error: strength.errors.join('. ') };
  }

  // Update password
  const newHash = hashPassword(newPassword);
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: newHash },
  });

  return { success: true };
}

/**
 * Reset a user's password using security question verification
 */
export async function resetPassword(
  email: string,
  securityAnswer: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  if (!user) {
    return { success: false, error: 'Barua pepe haipatikani' };
  }

  if (!user.isActive) {
    return { success: false, error: 'Akaunti imezimwa' };
  }

  // Verify security answer
  if (!user.securityAnswerHash || !verifyPassword(securityAnswer, user.securityAnswerHash)) {
    return { success: false, error: 'Jibu la swali la usalama si sahihi' };
  }

  // Validate new password
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    return { success: false, error: strength.errors.join('. ') };
  }

  // Update password and unlock account
  const newHash = hashPassword(newPassword);
  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newHash,
      loginAttempts: 0,
      lockedUntil: null,
    },
  });

  return { success: true };
}

/**
 * Get user's security question by email (for password reset flow)
 */
export async function getSecurityQuestion(
  email: string
): Promise<{ question: string } | null> {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { securityQuestion: true, isActive: true },
  });

  if (!user || !user.isActive) return null;

  if (!user.securityQuestion) return null;

  return { question: user.securityQuestion };
}
