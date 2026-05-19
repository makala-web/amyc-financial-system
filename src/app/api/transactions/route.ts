import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, buildOrgScopedWhere, checkRateLimit, sanitizeString, validateMonth, validateYear } from '@/lib/rbac';
import { createAuditLog } from '@/lib/api-helpers';
import { createTransactionSchema } from '@/lib/validations';
import { validateFinancialPeriod, enforceOpeningBalanceLock } from '@/lib/financial-integrity';
import type { Permission } from '@/lib/rbac';

// GET /api/transactions - List transactions with comprehensive filters + RBAC
export async function GET(request: NextRequest) {
  try {
    // Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // Auth + Permission check
    const rbac = await enforceRbac(request, { permission: 'view_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    const { searchParams } = new URL(request.url);

    const orgUnitId = searchParams.get('orgUnitId');
    const type = searchParams.get('type');
    const month = searchParams.get('month');
    const year = searchParams.get('year');
    const department = searchParams.get('department');
    const categoryId = searchParams.get('categoryId');
    const approvalStatus = searchParams.get('approvalStatus');
    const isSubmitted = searchParams.get('isSubmitted');
    const isLocked = searchParams.get('isLocked');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Build where clause with org scope restriction
    const orgScope = await buildOrgScopedWhere(user.orgUnitId, user.orgLevel);
    const where: any = { ...orgScope };

    // If specific org requested, verify access
    if (orgUnitId) {
      const targetOrgId = parseInt(orgUnitId);
      where.orgUnitId = targetOrgId;
    }

    if (type) where.type = type;
    if (month) where.month = validateMonth(month);
    if (year) where.year = validateYear(year);
    if (department) where.department = sanitizeString(department);
    if (categoryId) where.categoryId = parseInt(categoryId);
    if (approvalStatus) where.approvalStatus = approvalStatus;
    if (isSubmitted !== null && isSubmitted !== undefined && isSubmitted !== '') {
      where.isSubmitted = isSubmitted === 'true';
    }
    if (isLocked !== null && isLocked !== undefined && isLocked !== '') {
      where.isLocked = isLocked === 'true';
    }
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }
    if (search) {
      const q = sanitizeString(search);
      where.OR = [
        { description: { contains: q } },
        { categoryName: { contains: q } },
        { vendor: { contains: q } },
        { source: { contains: q } },
        { department: { contains: q } },
        { orgUnitName: { contains: q } },
      ];
    }

    const [transactions, total] = await Promise.all([
      db.transaction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.transaction.count({ where }),
    ]);

    return NextResponse.json({
      data: transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error listing transactions:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kupata taarifa za fedha' },
      { status: 500 }
    );
  }
}

// POST /api/transactions - Create transaction with Zod validation + Financial Integrity + RBAC
export async function POST(request: NextRequest) {
  try {
    // Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // Auth + Permission check: must be able to enter data
    const rbac = await enforceRbac(request, { permission: 'enter_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    const body = await request.json();

    // ============================================================
    // Zod Validation - First line of defense against bad data
    // ============================================================
    const parseResult = createTransactionSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Taarifa si sahihi',
          details: parseResult.error.issues.map((e) => ({
            field: (e.path || []).join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }
    const validatedData = parseResult.data;

    // Verify user can enter data for this org
    const targetOrgId = validatedData.orgUnitId;
    if (targetOrgId !== user.orgUnitId && user.orgLevel !== 'markaz') {
      return NextResponse.json(
        { error: 'Hauna ruhusa ya kuingiza data kwa kitengo hiki' },
        { status: 403 }
      );
    }

    // ============================================================
    // Financial Integrity Checks - Enforce business rules
    // ============================================================

    // Check financial period validity (month closed? submission locked?)
    const periodCheck = await validateFinancialPeriod(targetOrgId, validatedData.month, validatedData.year);
    if (!periodCheck.valid) {
      return NextResponse.json({ error: periodCheck.error }, { status: 409 });
    }

    // Check opening balance lock (only one opening balance per org/year)
    if (validatedData.isOpening) {
      const openingLock = await enforceOpeningBalanceLock(targetOrgId, validatedData.year);
      if (openingLock.locked) {
        return NextResponse.json(
          { error: `Salio la ufunguzi kwa mwaka ${validatedData.year} limeshawekwa (Muamala #${openingLock.existingId})` },
          { status: 409 }
        );
      }
    }

    // Auto-fill: get orgUnit info
    const orgUnit = await db.orgUnit.findUnique({
      where: { id: targetOrgId },
    });
    if (!orgUnit) {
      return NextResponse.json(
        { error: 'Kitengo cha shirika hakipatikani' },
        { status: 404 }
      );
    }

    // Auto-fill: get category info
    const category = await db.category.findUnique({
      where: { id: validatedData.categoryId },
    });
    if (!category) {
      return NextResponse.json(
        { error: 'Kundi la muamala halipatikani' },
        { status: 404 }
      );
    }

    // Create transaction with approval status 'entered'
    const transaction = await db.transaction.create({
      data: {
        type: validatedData.type,
        amount: validatedData.amount,
        date: new Date(validatedData.date),
        month: validatedData.month,
        year: validatedData.year,
        department: sanitizeString(validatedData.department),
        categoryId: validatedData.categoryId,
        categoryName: category.name,
        description: validatedData.description ? sanitizeString(validatedData.description) : null,
        source: validatedData.source ? sanitizeString(validatedData.source) : null,
        vendor: validatedData.vendor ? sanitizeString(validatedData.vendor) : null,
        quantity: validatedData.quantity ?? null,
        unitPrice: validatedData.unitPrice ?? null,
        unit: validatedData.unit ? sanitizeString(validatedData.unit) : null,
        orgUnitId: targetOrgId,
        orgUnitName: orgUnit.name,
        orgLevel: orgUnit.type,
        enteredBy: user.userId,
        importBatchId: validatedData.importBatchId ?? null,
        financialYear: validatedData.year,
        isOpening: validatedData.isOpening,
        approvalStatus: 'entered',
      },
    });

    // Create initial approval step
    await db.approvalStep.create({
      data: {
        entityType: 'transaction',
        entityId: transaction.id,
        step: 'entered',
        userId: user.userId,
        notes: 'Muamala umeingizwa',
        previousStatus: '',
        newStatus: 'entered',
      },
    });

    // Log to audit
    await db.auditLog.create({
      data: {
        action: 'create',
        entity: 'transaction',
        entityId: transaction.id,
        userId: user.userId,
        details: `Muamala wa ${validatedData.type === 'income' ? 'mapato' : 'matumizi'} - Kiasi: ${validatedData.amount}, Kundi: ${category.name}, Kitengo: ${orgUnit.name}`,
        newValue: JSON.stringify({ type: validatedData.type, amount: validatedData.amount, department: validatedData.department, categoryId: validatedData.categoryId, month: validatedData.month, year: validatedData.year }),
        ipAddress: request.headers.get('x-forwarded-for') || null,
        userAgent: request.headers.get('user-agent') || null,
      },
    });

    // Notify reviewers that new data needs review
    const reviewerRoles = user.orgLevel === 'tawi'
      ? ['mweka_hazina', 'mudir']
      : user.orgLevel === 'jimbo'
      ? ['katibu', 'mudir']
      : ['admin'];

    const reviewers = await db.user.findMany({
      where: {
        orgUnitId: targetOrgId,
        isActive: true,
        role: { in: reviewerRoles },
      },
    });

    for (const reviewer of reviewers) {
      await db.notification.create({
        data: {
          userId: reviewer.id,
          type: 'approval_needed',
          title: 'Taarifa mpya zinahitaji uhakiki',
          message: `${user.fullName} ameingiza ${validatedData.type === 'income' ? 'mapato' : 'matumizi'} ya TZS ${Number(validatedData.amount).toLocaleString()} - ${category.name}`,
          entityType: 'transaction',
          entityId: transaction.id,
          orgUnitId: targetOrgId,
          priority: 'normal',
        },
      });
    }

    return NextResponse.json({ data: transaction }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('lazima')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error creating transaction:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kuunda muamala' },
      { status: 500 }
    );
  }
}
