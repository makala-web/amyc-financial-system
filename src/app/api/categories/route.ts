import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, checkRateLimit, buildOrgScopedWhere } from '@/lib/rbac';
import { createCategorySchema } from '@/lib/validations';
import { createAuditLog } from '@/lib/api-helpers';

// GET /api/categories - List categories with filters
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
    const orgLevel = searchParams.get('orgLevel');
    const isActive = searchParams.get('isActive');
    const orgUnitId = searchParams.get('orgUnitId');

    const where: any = {};

    if (type) where.type = type;
    if (orgLevel) where.orgLevel = orgLevel;
    if (isActive !== null && isActive !== undefined && isActive !== '') {
      where.isActive = isActive === 'true';
    }

    // Apply org scope filtering for categories
    if (orgUnitId) {
      where.orgUnitId = parseInt(orgUnitId);
    } else if (user.role !== 'admin') {
      // Non-admin users see categories for their org level + default categories
      const orgScope = await buildOrgScopedWhere(user.orgUnitId, user.orgLevel, 'orgUnitId');
      where.OR = [
        { isDefault: true, orgLevel: user.orgLevel },
        orgScope,
      ];
    }

    const categories = await db.category.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json({ data: categories });
  } catch (error) {
    console.error('Error listing categories:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kupata makundi' },
      { status: 500 }
    );
  }
}

// POST /api/categories - Create category
export async function POST(request: NextRequest) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth + Permission check
    const rbac = await enforceRbac(request, { permissions: ['access_admin', 'manage_budgets'] });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    // 3. Parse and validate body with Zod
    const body = await request.json();
    const parseResult = createCategorySchema.safeParse(body);
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

    // Check for duplicate name+type+orgLevel
    const existing = await db.category.findUnique({
      where: {
        name_type_orgLevel: {
          name: data.name,
          type: data.type,
          orgLevel: data.orgLevel,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Kundi hili limesha kuwepo' },
        { status: 409 }
      );
    }

    const category = await db.category.create({
      data: {
        name: data.name,
        type: data.type,
        orgLevel: data.orgLevel,
        orgUnitId: data.orgUnitId || null,
        isDefault: data.isDefault,
        sortOrder: data.sortOrder,
      },
    });

    // 5. Audit log
    await createAuditLog(request, {
      action: 'create',
      entity: 'category',
      entityId: category.id,
      details: `Kundi jipya: ${data.name} (${data.type}) - Ngazi: ${data.orgLevel}`,
      newValue: JSON.stringify(category),
    });

    return NextResponse.json({ data: category }, { status: 201 });
  } catch (error) {
    console.error('Error creating category:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kuunda kundi' },
      { status: 500 }
    );
  }
}
