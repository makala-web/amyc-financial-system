import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, buildOrgScopedWhere, checkRateLimit } from '@/lib/rbac';
import { createUserSchema } from '@/lib/validations';
import { createAuditLog } from '@/lib/api-helpers';
import { canAccessOrg } from '@/lib/rbac';
import { hashPassword } from '@/lib/auth/server';

// GET /api/users - List users (admin only or scoped)
export async function GET(request: NextRequest) {
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
    const user = rbac.user!;

    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role');
    const orgLevel = searchParams.get('orgLevel');
    const orgUnitId = searchParams.get('orgUnitId');
    const isActive = searchParams.get('isActive');

    const where: any = {};

    if (role) where.role = role;
    if (orgLevel) where.orgLevel = orgLevel;
    if (isActive !== null && isActive !== undefined && isActive !== '') {
      where.isActive = isActive === 'true';
    }

    // Non-admin users can only see users in their org scope
    if (user.role !== 'admin') {
      const orgScope = await buildOrgScopedWhere(user.orgUnitId, user.orgLevel);
      // If specific orgUnitId is requested, verify access
      if (orgUnitId) {
        const targetOrgId = parseInt(orgUnitId);
        const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, targetOrgId);
        if (!canAccess) {
          return NextResponse.json({ error: 'Hauna ruhusa ya kuona data ya kitengo hiki.' }, { status: 403 });
        }
        where.orgUnitId = targetOrgId;
      } else {
        // Apply org scope filter
        where.orgUnitId = orgScope.orgUnitId || (orgScope.orgUnitId as any)?.in;
      }
    } else if (orgUnitId) {
      where.orgUnitId = parseInt(orgUnitId);
    }

    const users = await db.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        orgLevel: true,
        orgUnitId: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        orgUnit: {
          select: { id: true, name: true, type: true, code: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ data: users });
  } catch (error) {
    console.error('Error listing users:', error);
    return NextResponse.json({ error: 'Imeshindwa kupata watumiaji' }, { status: 500 });
  }
}

// POST /api/users - Create user (admin only)
export async function POST(request: NextRequest) {
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
    const user = rbac.user!;

    // 3. Parse and validate body with Zod
    const body = await request.json();
    const parseResult = createUserSchema.safeParse(body);
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

    // 4. Validate org ownership - non-admin can only create users in their own org or child orgs
    if (user.role !== 'admin') {
      const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, data.orgUnitId);
      if (!canAccess) {
        return NextResponse.json(
          { error: 'Hauna ruhusa ya kuunda mtumiaji kwenye kitengo hiki.' },
          { status: 403 }
        );
      }
    }

    // 5. Check for duplicate email/username
    const existing = await db.user.findFirst({
      where: { OR: [{ email: data.email }, { username: data.username }] },
    });
    if (existing) {
      return NextResponse.json({ error: 'Barua pepe au jina la mtumiaji tayari lipo' }, { status: 409 });
    }

    const passwordHash = hashPassword(data.password);
    const securityAnswerHash = hashPassword(data.securityAnswer);

    // 6. Create user
    const newUser = await db.user.create({
      data: {
        username: data.username,
        email: data.email,
        passwordHash,
        fullName: data.fullName,
        role: data.role,
        orgLevel: data.orgLevel,
        orgUnitId: data.orgUnitId,
        securityQuestion: data.securityQuestion,
        securityAnswerHash,
        isActive: true,
      },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        orgLevel: true,
        orgUnitId: true,
        isActive: true,
        createdAt: true,
      },
    });

    // 7. Audit log
    await createAuditLog(request, {
      action: 'create',
      entity: 'user',
      entityId: newUser.id,
      details: `Mtumiaji mpya: ${newUser.fullName} (${newUser.role}) - ${newUser.email}`,
      newValue: JSON.stringify(newUser),
    });

    return NextResponse.json({ data: newUser }, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json({ error: 'Imeshindwa kuunda mtumiaji' }, { status: 500 });
  }
}
