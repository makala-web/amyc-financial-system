import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, createSession } from '@/lib/auth/server';
import { loginSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/rbac';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip');
}

export async function POST(request: NextRequest) {
  try {
    // 1. Stricter rate limit for login attempts (10/min)
    const rateLimit = checkRateLimit(request, 10);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, message: 'Maombi mengi sana. Jaribu tena baada ya dakika moja.' },
        { status: 429 }
      );
    }

    // 2. Parse and validate body with Zod
    const body = await request.json();
    const parseResult = loginSchema.safeParse(body);
    if (!parseResult.success) {
      // Log failed login attempt (validation failure)
      await db.auditLog.create({
        data: {
          action: 'login_failed',
          entity: 'user',
          entityId: 0,
          userId: 0,
          details: `Jaribio la kuingia limefeli - uthibitishaji umeshindwa: ${body.email || 'unknown'}`,
          ipAddress: getClientIp(request),
          userAgent: request.headers.get('user-agent') || null,
        },
      }).catch(() => {}); // Don't fail on audit log error

      return NextResponse.json(
        {
          success: false,
          message: 'Taarifa si sahihi',
          details: parseResult.error.issues.map(e => ({
            field: (e.path || []).join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }
    const { email, password } = parseResult.data;

    // Find user by email
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { orgUnit: true },
    });

    if (!user) {
      // Log failed login attempt - user not found
      await db.auditLog.create({
        data: {
          action: 'login_failed',
          entity: 'user',
          entityId: 0,
          userId: 0,
          details: `Jaribio la kuingia limefeli - mtumiaji hakupatikana: ${email}`,
          ipAddress: getClientIp(request),
          userAgent: request.headers.get('user-agent') || null,
        },
      }).catch(() => {});

      return NextResponse.json(
        { success: false, message: 'Barua pepe au nenosiri si sahihi' },
        { status: 401 }
      );
    }

    // Check if user is active
    if (!user.isActive) {
      // Log failed login attempt - account disabled
      await db.auditLog.create({
        data: {
          action: 'login_failed',
          entity: 'user',
          entityId: user.id,
          userId: user.id,
          details: `Jaribio la kuingia limefeli - akaunti imelemazwa: ${user.email}`,
          ipAddress: getClientIp(request),
          userAgent: request.headers.get('user-agent') || null,
        },
      }).catch(() => {});

      return NextResponse.json(
        { success: false, message: 'Akaunti yako imelemazwa. Wasiliana na msimamizi' },
        { status: 403 }
      );
    }

    // Check if account is locked
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const remainingMinutes = Math.ceil(
        (new Date(user.lockedUntil).getTime() - Date.now()) / 60000
      );
      return NextResponse.json(
        {
          success: false,
          message: `Akaunti yako imefungwa kwa sababu ya majaribio mengi ya kuingia. Jaribu tena baada ya dakika ${remainingMinutes}`,
        },
        { status: 423 }
      );
    }

    // If lockout period has expired, reset login attempts
    if (user.lockedUntil && new Date(user.lockedUntil) <= new Date()) {
      await db.user.update({
        where: { id: user.id },
        data: { loginAttempts: 0, lockedUntil: null },
      });
    }

    // Verify password using the shared utility
    if (!user.passwordHash) {
      await db.auditLog.create({
        data: {
          action: 'login_failed',
          entity: 'user',
          entityId: user.id,
          userId: user.id,
          details: `Akaunti haina password hash: ${user.email}`,
          ipAddress: getClientIp(request),
          userAgent: request.headers.get('user-agent') || null,
        },
      }).catch(() => {});
      return NextResponse.json(
        { success: false, message: 'Akaunti haijasanidiwa sawasawa. Wasiliana na msimamizi.' },
        { status: 403 }
      );
    }

    if (!verifyPassword(password, user.passwordHash)) {
      const newAttempts = (user.loginAttempts || 0) + 1;
      const updateData: Record<string, unknown> = { loginAttempts: newAttempts };

      // Lock account if max attempts reached
      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000);
        updateData.lockedUntil = lockedUntil;

        await db.user.update({
          where: { id: user.id },
          data: updateData,
        });

        // Log the lockout event
        await db.auditLog.create({
          data: {
            action: 'login_locked',
            entity: 'user',
            entityId: user.id,
            userId: user.id,
            details: `Akaunti imefungwa baada ya majaribio ${newAttempts} ya kuingia`,
            ipAddress: getClientIp(request),
            userAgent: request.headers.get('user-agent') || null,
          },
        });

        return NextResponse.json(
          {
            success: false,
            message: `Akaunti yako imefungwa kwa sababu ya majaribio mengi ya kuingia. Jaribu tena baada ya dakika ${LOCK_DURATION_MINUTES}`,
          },
          { status: 423 }
        );
      }

      await db.user.update({
        where: { id: user.id },
        data: updateData,
      });

      // Log failed login attempt - wrong password
      await db.auditLog.create({
        data: {
          action: 'login_failed',
          entity: 'user',
          entityId: user.id,
          userId: user.id,
          details: `Jaribio la kuingia limefeli - nenosiri sio sahihi (${newAttempts}/${MAX_LOGIN_ATTEMPTS}): ${user.email}`,
          ipAddress: getClientIp(request),
          userAgent: request.headers.get('user-agent') || null,
        },
      }).catch(() => {});

      const remainingAttempts = MAX_LOGIN_ATTEMPTS - newAttempts;
      return NextResponse.json(
        {
          success: false,
          message: `Barua pepe au nenosiri si sahihi. Majaribio yaliyosalia: ${remainingAttempts}`,
        },
        { status: 401 }
      );
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

    // Log successful login
    await db.auditLog.create({
      data: {
        action: 'login',
        entity: 'user',
        entityId: user.id,
        userId: user.id,
        details: `Ingia kwa mafanikio - ${user.email}`,
        ipAddress: getClientIp(request),
        userAgent: request.headers.get('user-agent') || null,
      },
    });

    // Generate session token
    // createSession already imported at top of file
    const token = createSession({
      id: user.id,
      email: user.email,
      fullName: user.fullName || '',
      role: user.role,
      orgLevel: user.orgLevel,
      orgUnitId: user.orgUnitId ?? 0,
    });

    // Return user data (without password hash)
    const { passwordHash: _, securityAnswerHash: __, ...userSafe } = user;
    return NextResponse.json({
      success: true,
      message: 'Umeingia kwa mafanikio',
      data: {
        user: {
          ...userSafe,
          fullName: user.fullName || '',
          orgUnit: user.orgUnit
            ? {
                id: user.orgUnit.id,
                name: user.orgUnit.name,
                code: user.orgUnit.code,
                type: user.orgUnit.type,
                parentId: user.orgUnit.parentId,
                isActive: user.orgUnit.isActive,
              }
            : null,
        },
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}
