import { NextRequest, NextResponse } from 'next/server';
import { validateSessionAsync } from '@/lib/auth/server';
import { db } from '@/lib/db';

// GET /api/auth/validate - Validate current session token
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Hamna tokeni ya uthibitisho' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const session = await validateSessionAsync(token);

    if (!session) {
      return NextResponse.json(
        { success: false, message: 'Kipindi chako kimemalizika au si sahihi. Tafadhali ingia tena.' },
        { status: 401 }
      );
    }

    // Also fetch the user's org unit for freshness
    const user = await db.user.findUnique({
      where: { id: session.userId },
      include: { orgUnit: true },
    });

    if (!user || !user.isActive) {
      return NextResponse.json(
        { success: false, message: 'Akaunti yako imezimwa. Wasiliana na msimamizi.' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        userId: session.userId,
        email: session.email,
        role: session.role,
        orgLevel: session.orgLevel,
        orgUnitId: session.orgUnitId,
        fullName: session.fullName,
        expiresAt: session.expiresAt,
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
    });
  } catch (error) {
    console.error('Session validation error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye.' },
      { status: 500 }
    );
  }
}
