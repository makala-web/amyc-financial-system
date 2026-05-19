import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ORG_LEVEL_CONFIG } from '@/lib/types';
import type { OrgLevel } from '@/lib/types';
import { createAuditLog } from '@/lib/api-helpers';
import { enforceRbac, checkRateLimit, buildOrgScopedWhere, canAccessOrg } from '@/lib/rbac';
import { createOrgUnitSchema } from '@/lib/validations';

/**
 * Generate the next code for an org unit based on its type and parent.
 * Markaz: MK-001, MK-002, ...
 * Jimbo under MK-001: MK-001-JM01, MK-001-JM02, ...
 * Tawi under MK-001-JM01: MK-001-JM01-TW01, MK-001-JM01-TW02, ...
 */
async function generateNextCode(type: OrgLevel, parentId: number | null): Promise<string> {
  const config = ORG_LEVEL_CONFIG[type];

  if (type === 'markaz') {
    const count = await db.orgUnit.count({
      where: { type: 'markaz' },
    });
    return `${config.codePrefix}-${String(count + 1).padStart(3, '0')}`;
  }

  if (!parentId) {
    throw new Error(`${config.label} lazima iwe na mzazi`);
  }

  const parent = await db.orgUnit.findUnique({
    where: { id: parentId },
  });

  if (!parent) {
    throw new Error('Kikundi cha mzazi hakipatikani');
  }

  const siblingCount = await db.orgUnit.count({
    where: { parentId, type },
  });

  const childPrefix = config.codePrefix;
  return `${parent.code}-${childPrefix}${String(siblingCount + 1).padStart(2, '0')}`;
}

// GET /api/organizations - List org units with filters
export async function GET(request: NextRequest) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth + Permission check
    const rbac = await enforceRbac(request, { permission: 'view_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const parentId = searchParams.get('parentId');
    const isActive = searchParams.get('isActive');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');

    const where: Record<string, unknown> = {};

    if (type) {
      where.type = type;
    }
    if (parentId !== null && parentId !== undefined && parentId !== '') {
      where.parentId = parseInt(parentId);
    }
    if (isActive !== null && isActive !== undefined && isActive !== '') {
      where.isActive = isActive === 'true';
    }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { code: { contains: search } },
      ];
    }

    // Apply org scope for non-admin users
    if (user.role !== 'admin') {
      const orgScope = await buildOrgScopedWhere(user.orgUnitId, user.orgLevel, 'id');
      where.id = orgScope.id || (orgScope.id as any)?.in;
    }

    const [orgUnits, total] = await Promise.all([
      db.orgUnit.findMany({
        where,
        include: {
          parent: {
            select: { id: true, name: true, code: true, type: true },
          },
          _count: {
            select: {
              children: true,
              users: true,
              transactions: true,
            },
          },
        },
        orderBy: [{ type: 'asc' }, { code: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.orgUnit.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: orgUnits,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('List organizations error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}

// POST /api/organizations - Create a new org unit (katibu/admin only)
export async function POST(request: NextRequest) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth + Permission check - only katibu/admin can create org units
    const rbac = await enforceRbac(request, { permissions: ['register_subunits', 'access_admin'] });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    // 3. Parse and validate body with Zod
    const body = await request.json();
    const parseResult = createOrgUnitSchema.safeParse(body);
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

    const orgLevel = data.type as OrgLevel;
    const config = ORG_LEVEL_CONFIG[orgLevel];

    // For jimbo and tawi, parentId is required
    if (orgLevel !== 'markaz' && !data.parentId) {
      return NextResponse.json(
        { success: false, message: `${config.label} lazima iwe na mzazi (${config.parentLabel})` },
        { status: 400 }
      );
    }

    // For markaz, parentId should be null
    if (orgLevel === 'markaz' && data.parentId) {
      return NextResponse.json(
        { success: false, message: 'Markaz Kuu haina mzazi' },
        { status: 400 }
      );
    }

    // Validate parent exists if provided
    if (data.parentId) {
      const parent = await db.orgUnit.findUnique({
        where: { id: data.parentId },
      });
      if (!parent) {
        return NextResponse.json(
          { success: false, message: 'Kikundi cha mzazi hakipatikani' },
          { status: 404 }
        );
      }

      // Validate parent type matches expected parent type
      if (parent.type !== config.parentType) {
        return NextResponse.json(
          {
            success: false,
            message: `Mzazi lazima awe ${config.parentLabel}, lakini alipatikana ${parent.type}`,
          },
          { status: 400 }
        );
      }

      // Check parent is active
      if (!parent.isActive) {
        return NextResponse.json(
          { success: false, message: 'Hauwezi kuongeza kikundi chini ya mzazi aliyelemazwa' },
          { status: 400 }
        );
      }

      // Non-admin users can only create sub-units under their own org or child orgs
      if (user.role !== 'admin') {
        const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, data.parentId);
        if (!canAccess) {
          return NextResponse.json(
            { success: false, message: 'Hauna ruhusa ya kuunda kikundi chini ya mzazi huyu.' },
            { status: 403 }
          );
        }
      }
    }

    // Generate code
    const code = await generateNextCode(orgLevel, data.parentId || null);

    // Check for duplicate name within same parent
    const existingName = await db.orgUnit.findFirst({
      where: {
        name: data.name,
        parentId: data.parentId || null,
      },
    });
    if (existingName) {
      return NextResponse.json(
        { success: false, message: `Jina "${data.name}" tayari linatumika kwenye kikundi hiki` },
        { status: 409 }
      );
    }

    // Create org unit
    const orgUnit = await db.orgUnit.create({
      data: {
        name: data.name,
        code,
        type: orgLevel,
        parentId: data.parentId || null,
        isActive: true,
      },
      include: {
        parent: {
          select: { id: true, name: true, code: true, type: true },
        },
        _count: {
          select: {
            children: true,
            users: true,
            transactions: true,
          },
        },
      },
    });

    // Log org creation
    await createAuditLog(request, {
      action: 'create',
      entity: 'orgUnit',
      entityId: orgUnit.id,
      details: `Kikundi kipya cha shirika: ${orgUnit.name} (${orgUnit.code}) - Aina: ${orgLevel}`,
      newValue: JSON.stringify({ id: orgUnit.id, name: orgUnit.name, code: orgUnit.code, type: orgLevel }),
    });

    return NextResponse.json(
      {
        success: true,
        message: `${config.label} imeundwa kwa mafanikio`,
        data: orgUnit,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create organization error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}
