import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, verifyPassword, getSecurityQuestion } from '@/lib/auth/server';
import { validatePasswordStrength } from '@/lib/types';

// GET /api/auth/forgot-password?email=... - Get security question for an email
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { success: false, message: 'Barua pepe inahitajika' },
        { status: 400 }
      );
    }

    const result = await getSecurityQuestion(email);

    if (!result) {
      return NextResponse.json(
        { success: false, message: 'Barua pepe haipatikani au akaunti imelemazwa' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        securityQuestion: result.question,
      },
    });
  } catch (error) {
    console.error('Get security question error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}

// POST /api/auth/forgot-password - Reset password using security answer
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, securityAnswer, newPassword } = body;

    if (!email || !securityAnswer || !newPassword) {
      return NextResponse.json(
        { success: false, message: 'Barua pepe, jibu la usalama, na nenosiri jipya vinahitajika' },
        { status: 400 }
      );
    }

    // Validate password strength using shared utility
    const strengthCheck = validatePasswordStrength(newPassword);
    if (!strengthCheck.valid) {
      return NextResponse.json(
        { success: false, message: 'Nenosiri si imara kutosha', errors: strengthCheck.errors },
        { status: 400 }
      );
    }

    // Find user by email
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Barua pepe haipatikani' },
        { status: 404 }
      );
    }

    // Check if user is active
    if (!user.isActive) {
      return NextResponse.json(
        { success: false, message: 'Akaunti yako imelemazwa. Wasiliana na msimamizi' },
        { status: 403 }
      );
    }

    // Verify security answer using shared utility
    if (!user.securityAnswerHash) {
      return NextResponse.json(
        { success: false, message: 'Hakuna jibu la usalama limewekwa kwa akaunti hii' },
        { status: 400 }
      );
    }

    if (!verifyPassword(securityAnswer, user.securityAnswerHash)) {
      // Log failed recovery attempt
      await db.auditLog.create({
        data: {
          action: 'password_recovery_failed',
          entity: 'user',
          entityId: user.id,
          userId: user.id,
          details: `Jibu la swali la usalama si sahihi kwa akaunti: ${user.email}`,
          ipAddress: request.headers.get('x-forwarded-for') || null,
          userAgent: request.headers.get('user-agent') || null,
        },
      });

      return NextResponse.json(
        { success: false, message: 'Jibu la swali la usalama si sahihi' },
        { status: 401 }
      );
    }

    // Update password using shared hash utility
    const newPasswordHash = hashPassword(newPassword);
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        loginAttempts: 0,
        lockedUntil: null,
      },
    });

    // Log successful password recovery
    await db.auditLog.create({
      data: {
        action: 'password_recovery',
        entity: 'user',
        entityId: user.id,
        userId: user.id,
        details: `Nenosiri limebadilishwa kupitia swali la usalama kwa akaunti: ${user.email}`,
        ipAddress: request.headers.get('x-forwarded-for') || null,
        userAgent: request.headers.get('user-agent') || null,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Nenosiri limebadilishwa kwa mafanikio. Unaweza kuingia sasa',
    });
  } catch (error) {
    console.error('Password recovery error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}
