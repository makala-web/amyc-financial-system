import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth/server';
import { createAuditLog } from '@/lib/api-helpers';
import { enforceRbac, checkRateLimit } from '@/lib/rbac';
import { updateUserSchema } from '@/lib/validations';

// GET /api/users/[id] - Get user by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth + Permission check
    const rbac = await enforceRbac(request, { permission: 'manage_users' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const authUser = rbac.user!;
    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json(
        { success: false, message: 'Kitambulisho cha mtumiaji si halali' },
        { status: 400 }
      );
    }

    const dbUser = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        orgLevel: true,
        orgUnitId: true,
        securityQuestion: true,
        isActive: true,
        lastLoginAt: true,
        loginAttempts: true,
        lockedUntil: true,
        createdAt: true,
        updatedAt: true,
        orgUnit: {
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
            parentId: true,
            isActive: true,
          },
        },
      },
    });

    if (!dbUser) {
      return NextResponse.json(
        { success: false, message: 'Mtumiaji hakupatikana' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: dbUser,
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}

// PUT /api/users/[id] - Update user
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth + Permission check
    const rbac = await enforceRbac(request, { permission: 'manage_users' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const authUser = rbac.user!;
    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json(
        { success: false, message: 'Kitambulisho cha mtumiaji si halali' },
        { status: 400 }
      );
    }

    // 3. Parse and validate body with Zod
    const body = await request.json();
    const parseResult = updateUserSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Taarifa si sahihi',
          details: parseResult.error.issues.map(e => ({
            field: (e.path || []).join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }
    const data = parseResult.data;

    // Check if user exists
    const existingUser = await db.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return NextResponse.json(
        { success: false, message: 'Mtumiaji hakupatikana' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};

    if (data.fullName !== undefined) {
      updateData.fullName = data.fullName;
    }

    if (data.email !== undefined) {
      const emailTrimmed = data.email.toLowerCase().trim();
      // Check for duplicate email (excluding current user)
      const duplicateEmail = await db.user.findUnique({
        where: { email: emailTrimmed },
      });
      if (duplicateEmail && duplicateEmail.id !== userId) {
        return NextResponse.json(
          { success: false, message: 'Barua pepe tayari inatumika' },
          { status: 409 }
        );
      }
      updateData.email = emailTrimmed;
    }

    if (data.role !== undefined) {
      updateData.role = data.role;
    }

    if (data.orgLevel !== undefined) {
      updateData.orgLevel = data.orgLevel;
    }

    if (data.orgUnitId !== undefined) {
      const orgUnit = await db.orgUnit.findUnique({
        where: { id: data.orgUnitId },
      });
      if (!orgUnit) {
        return NextResponse.json(
          { success: false, message: 'Kikundi cha shirika hakipatikani' },
          { status: 404 }
        );
      }
      updateData.orgUnitId = data.orgUnitId;
    }

    if (data.isActive !== undefined) {
      // Only admin can change isActive status
      if (authUser.role !== 'admin') {
        return NextResponse.json(
          { success: false, message: 'Msimamizi pekee ndiye anayeweza kubadilisha hali ya mtumiaji' },
          { status: 403 }
        );
      }
      updateData.isActive = data.isActive;
    }

    if (data.securityQuestion !== undefined) {
      updateData.securityQuestion = data.securityQuestion;
    }

    if (data.securityAnswer !== undefined) {
      updateData.securityAnswerHash = hashPassword(data.securityAnswer);
    }

    // Handle password update
    if (data.password) {
      updateData.passwordHash = hashPassword(data.password);
      // Reset lockout on password change
      updateData.loginAttempts = 0;
      updateData.lockedUntil = null;
    }

    const updatedUser = await db.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        orgLevel: true,
        orgUnitId: true,
        securityQuestion: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        orgUnit: {
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
          },
        },
      },
    });

    // Log user update
    const changedFields = Object.keys(updateData);
    await createAuditLog(request, {
      action: 'update',
      entity: 'user',
      entityId: userId,
      details: `Mtumiaji amesasishwa: ${existingUser.fullName} - Sehemu zilizobadilishwa: ${changedFields.join(', ')}`,
      oldValue: JSON.stringify({ id: existingUser.id, email: existingUser.email, role: existingUser.role }),
      newValue: JSON.stringify({ id: updatedUser.id, email: updatedUser.email, role: updatedUser.role }),
    });

    return NextResponse.json({
      success: true,
      message: 'Mtumiaji amesasishwa kwa mafanikio',
      data: updatedUser,
    });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}

// DELETE /api/users/[id] - Soft delete (deactivate) user - admin only
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth + Permission check - only admin can deactivate
    const rbac = await enforceRbac(request, { permission: 'access_admin' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const authUser = rbac.user!;

    // Only admin can deactivate users
    if (authUser.role !== 'admin') {
      return NextResponse.json(
        { success: false, message: 'Msimamizi pekee ndiye anayeweza kulemaza mtumiaji' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json(
        { success: false, message: 'Kitambulisho cha mtumiaji si halali' },
        { status: 400 }
      );
    }

    // Cannot deactivate yourself
    if (userId === authUser.userId) {
      return NextResponse.json(
        { success: false, message: 'Huwezi kulemaza akaunti yako mwenyewe' },
        { status: 400 }
      );
    }

    const dbUser = await db.user.findUnique({
      where: { id: userId },
    });

    if (!dbUser) {
      return NextResponse.json(
        { success: false, message: 'Mtumiaji hakupatikana' },
        { status: 404 }
      );
    }

    if (!dbUser.isActive) {
      return NextResponse.json(
        { success: false, message: 'Mtumiaji tayari amelemazwa' },
        { status: 400 }
      );
    }

    // Soft delete - set isActive to false (never hard delete users)
    await db.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    // Invalidate any active sessions for this user
    const sessionStore = (db as unknown as {
      session?: { deleteMany: (args: { where: { userId: number } }) => Promise<unknown> };
    }).session;

    await sessionStore?.deleteMany({
      where: { userId },
    }).catch(() => {
      // Sessions table may not exist; ignore error
    });

    // Log deactivation
    await createAuditLog(request, {
      action: 'deactivate',
      entity: 'user',
      entityId: userId,
      details: `Mtumiaji amelemazwa: ${dbUser.fullName} (${dbUser.email})`,
      oldValue: JSON.stringify({ id: dbUser.id, isActive: true }),
      newValue: JSON.stringify({ id: dbUser.id, isActive: false }),
    });

    return NextResponse.json({
      success: true,
      message: 'Mtumiaji amelemazwa kwa mafanikio',
    });
  } catch (error) {
    console.error('Deactivate user error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}
