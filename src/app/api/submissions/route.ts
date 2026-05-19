import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, buildOrgScopedWhere, checkRateLimit, validateMonth, validateYear } from '@/lib/rbac';
import { processSubmissionApproval, getChildSubmissionsForConsolidation } from '@/lib/approval-engine';

// GET /api/submissions - List submissions with filters + RBAC
export async function GET(request: NextRequest) {
  try {
    const rbac = await enforceRbac(request, { permission: 'view_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    const { searchParams } = new URL(request.url);

    const orgUnitId = searchParams.get('orgUnitId');
    const month = searchParams.get('month');
    const year = searchParams.get('year');
    const isSubmitted = searchParams.get('isSubmitted');
    const isApproved = searchParams.get('isApproved');
    const approvalStatus = searchParams.get('approvalStatus');
    const includeChildren = searchParams.get('includeChildren') === 'true';

    // Build where clause with org scope
    const orgScope = await buildOrgScopedWhere(user.orgUnitId, user.orgLevel);
    const where: any = { ...orgScope };

    if (orgUnitId) where.orgUnitId = parseInt(orgUnitId);
    if (month) where.month = validateMonth(month);
    if (year) where.year = validateYear(year);
    if (isSubmitted !== null && isSubmitted !== undefined && isSubmitted !== '') {
      where.isSubmitted = isSubmitted === 'true';
    }
    if (isApproved !== null && isApproved !== undefined && isApproved !== '') {
      where.approvalStatus = isApproved === 'true' ? 'approved' : { not: 'approved' };
    }
    if (approvalStatus) where.approvalStatus = approvalStatus;

    const submissions = await db.monthlySubmission.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: {
        orgUnit: {
          select: { id: true, name: true, type: true, code: true },
        },
        submitter: {
          select: { id: true, fullName: true, email: true },
        },
        approver: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    // If requested, include child submission data for consolidated view
    let childData: any[] | null = null;
    if (includeChildren && (user.orgLevel === 'jimbo' || user.orgLevel === 'markaz')) {
      const mo = month ? validateMonth(month) : new Date().getMonth() + 1;
      const yr = year ? validateYear(year) : new Date().getFullYear();
      const targetOrgId = orgUnitId ? parseInt(orgUnitId) : user.orgUnitId;
      childData = await getChildSubmissionsForConsolidation(targetOrgId, mo, yr);
    }

    return NextResponse.json({ data: submissions, childData });
  } catch (error) {
    console.error('Error listing submissions:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kupata mawasilisho' },
      { status: 500 }
    );
  }
}

// POST /api/submissions - Create/update submission (mark month as submitted) + RBAC
export async function POST(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana' }, { status: 429 });
    }

    const rbac = await enforceRbac(request, { permission: 'submit_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    const body = await request.json();

    const { orgUnitId, month, year, notes, isConsolidated, childDataJson } = body;

    if (!orgUnitId || !month || !year) {
      return NextResponse.json(
        { error: 'Taarifa muhimu hazijawasilishwa' },
        { status: 400 }
      );
    }

    // Verify user can submit for this org
    const targetOrgId = parseInt(orgUnitId);
    if (targetOrgId !== user.orgUnitId && user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Hauna ruhusa ya kuwasilisha kwa kitengo hiki' },
        { status: 403 }
      );
    }

    const m = validateMonth(month);
    const y = validateYear(year);

    // Check if month is already approved (locked)
    const existingSubmission = await db.monthlySubmission.findUnique({
      where: { orgUnitId_month_year: { orgUnitId: targetOrgId, month: m, year: y } },
    });

    if (existingSubmission?.approvalStatus === 'approved') {
      return NextResponse.json(
        { error: 'Mwezi huu umekwishaidhinishwa na hauwezi kubadilishwa' },
        { status: 409 }
      );
    }

    // Calculate totals from transactions for this org/month/year
    const incomeResult = await db.transaction.aggregate({
      where: {
        orgUnitId: targetOrgId,
        month: m,
        year: y,
        type: 'income',
      },
      _sum: { amount: true },
    });

    const expenseResult = await db.transaction.aggregate({
      where: {
        orgUnitId: targetOrgId,
        month: m,
        year: y,
        type: 'expense',
      },
      _sum: { amount: true },
    });

    const totalIncome = incomeResult._sum.amount || 0;
    const totalExpense = expenseResult._sum.amount || 0;
    const netBalance = totalIncome - totalExpense;

    // Upsert submission
    const submission = await db.monthlySubmission.upsert({
      where: {
        orgUnitId_month_year: {
          orgUnitId: targetOrgId,
          month: m,
          year: y,
        },
      },
      create: {
        orgUnitId: targetOrgId,
        month: m,
        year: y,
        isSubmitted: true,
        submittedAt: new Date(),
        submitterId: user.userId,
        totalIncome,
        totalExpense,
        netBalance,
        notes: notes || null,
        approvalStatus: 'entered',
        isConsolidated: isConsolidated || false,
        childDataJson: childDataJson || null,
      },
      update: {
        isSubmitted: true,
        submittedAt: new Date(),
        submitterId: user.userId,
        totalIncome,
        totalExpense,
        netBalance,
        notes: notes || null,
        isConsolidated: isConsolidated || false,
        childDataJson: childDataJson || null,
      },
    });

    // Mark all transactions for this org/month/year as submitted
    await db.transaction.updateMany({
      where: {
        orgUnitId: targetOrgId,
        month: m,
        year: y,
        isSubmitted: false,
      },
      data: {
        isSubmitted: true,
        submittedAt: new Date(),
      },
    });

    // Log to audit
    await db.auditLog.create({
      data: {
        action: 'submit',
        entity: 'submission',
        entityId: submission.id,
        userId: user.userId,
        details: `Mawasilisho ya mwezi ${m}/${y} - Mapato: ${totalIncome}, Matumizi: ${totalExpense}, Salio: ${netBalance}`,
        newValue: JSON.stringify({ totalIncome, totalExpense, netBalance, isConsolidated }),
        ipAddress: request.headers.get('x-forwarded-for') || null,
        userAgent: request.headers.get('user-agent') || null,
      },
    });

    // Notify reviewers/approvers
    const org = await db.orgUnit.findUnique({ where: { id: targetOrgId } });
    if (org) {
      const reviewerRoles = org.type === 'tawi'
        ? ['mweka_hazina', 'mudir']
        : org.type === 'jimbo'
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
            title: `Mawasilisho ya ${getMonthName(m)} ${y}`,
            message: `${user.fullName} amewasilisha taarifa za ${getMonthName(m)} ${y} za ${org.name}. Mapato: TZS ${totalIncome.toLocaleString()}, Matumizi: TZS ${totalExpense.toLocaleString()}`,
            entityType: 'submission',
            entityId: submission.id,
            orgUnitId: targetOrgId,
            priority: 'high',
          },
        });
      }
    }

    return NextResponse.json({ data: submission }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('sahihi')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error creating/updating submission:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kuunda mawasilisho' },
      { status: 500 }
    );
  }
}

function getMonthName(month: number): string {
  const months = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni',
    'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
  return months[month - 1] || '';
}
