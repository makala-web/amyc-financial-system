import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, checkRateLimit, buildOrgScopedWhere, canAccessOrg } from '@/lib/rbac';
import { createBudgetSchema } from '@/lib/validations';
import { createAuditLog } from '@/lib/api-helpers';

// GET /api/budgets - List budgets with filters
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

    const orgUnitId = searchParams.get('orgUnitId');
    const year = searchParams.get('year');
    const type = searchParams.get('type');
    const department = searchParams.get('department');
    const isApproved = searchParams.get('isApproved');

    const where: any = {};

    if (orgUnitId) {
      const targetOrgId = parseInt(orgUnitId);
      const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, targetOrgId);
      if (!canAccess) {
        return NextResponse.json({ error: 'Hauna ruhusa ya kuona bajeti ya kitengo hiki.' }, { status: 403 });
      }
      where.orgUnitId = targetOrgId;
    } else if (user.role !== 'admin') {
      const orgScope = await buildOrgScopedWhere(user.orgUnitId, user.orgLevel);
      where.orgUnitId = orgScope.orgUnitId || (orgScope.orgUnitId as any)?.in;
    }

    if (year) where.year = parseInt(year);
    if (type) where.type = type;
    if (department) where.department = department;
    if (isApproved !== null && isApproved !== undefined && isApproved !== '') {
      where.isApproved = isApproved === 'true';
    }

    const budgets = await db.budget.findMany({
      where,
      orderBy: [{ department: 'asc' }, { category: 'asc' }],
      include: {
        orgUnit: {
          select: { id: true, name: true, type: true, code: true },
        },
        creator: {
          select: { id: true, fullName: true, email: true },
        },
        approver: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    // Calculate actual amounts for each budget
    const budgetsWithActual = await Promise.all(
      budgets.map(async (budget) => {
        const actual = await db.transaction.aggregate({
          where: {
            orgUnitId: budget.orgUnitId,
            type: budget.type,
            department: budget.department,
            categoryName: budget.category,
            year: budget.year,
          },
          _sum: { amount: true },
        });

        const actualAmount = actual._sum.amount || 0;
        const variance = budget.plannedAmount - actualAmount;

        // Update the budget record with actual amounts
        await db.budget.update({
          where: { id: budget.id },
          data: {
            actualAmount,
            variance,
          },
        });

        return {
          ...budget,
          actualAmount,
          variance,
        };
      })
    );

    return NextResponse.json({ data: budgetsWithActual });
  } catch (error) {
    console.error('Error listing budgets:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kupata bajeti' },
      { status: 500 }
    );
  }
}

// POST /api/budgets - Create/update budget (admin/muhasibu only)
export async function POST(request: NextRequest) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth + Permission check - only admin/muhasibu can create budgets
    const rbac = await enforceRbac(request, { permissions: ['manage_budgets', 'access_admin'] });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    // 3. Parse and validate body with Zod
    const body = await request.json();
    const parseResult = createBudgetSchema.safeParse(body);
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

    // 4. Validate org access - user can only create budgets for their own org or child orgs
    const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, data.orgUnitId);
    if (!canAccess) {
      return NextResponse.json(
        { error: 'Hauna ruhusa ya kuunda bajeti kwenye kitengo hiki.' },
        { status: 403 }
      );
    }

    // Upsert budget (unique on orgUnitId+year+department+category+type)
    const budget = await db.budget.upsert({
      where: {
        orgUnitId_year_department_category_type: {
          orgUnitId: data.orgUnitId,
          year: data.year,
          department: data.department,
          category: data.category,
          type: data.type,
        },
      },
      create: {
        orgUnitId: data.orgUnitId,
        year: data.year,
        department: data.department,
        category: data.category,
        type: data.type,
        plannedAmount: data.plannedAmount,
        notes: data.notes || null,
        createdBy: user.userId,
        isApproved: false,
      },
      update: {
        plannedAmount: data.plannedAmount,
        notes: data.notes || null,
      },
    });

    // Calculate actual amount
    const actual = await db.transaction.aggregate({
      where: {
        orgUnitId: data.orgUnitId,
        type: data.type,
        department: data.department,
        categoryName: data.category,
        year: data.year,
      },
      _sum: { amount: true },
    });

    const actualAmount = actual._sum.amount || 0;
    const variance = data.plannedAmount - Number(actualAmount);

    await db.budget.update({
      where: { id: budget.id },
      data: { actualAmount, variance },
    });

    // 5. Audit log
    await createAuditLog(request, {
      action: 'create',
      entity: 'budget',
      entityId: budget.id,
      details: `Bajeti: ${data.category} (${data.type}) - ${data.department} - Kiasi: ${data.plannedAmount}`,
      newValue: JSON.stringify({ id: budget.id, category: data.category, type: data.type, plannedAmount: data.plannedAmount }),
    });

    return NextResponse.json({
      data: {
        ...budget,
        actualAmount,
        variance,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating/updating budget:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kuunda bajeti' },
      { status: 500 }
    );
  }
}
