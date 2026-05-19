import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, buildOrgScopedWhere, checkRateLimit, canAccessOrg } from '@/lib/rbac';
import { getApprovalSummary, getChildSubmissionsForConsolidation } from '@/lib/approval-engine';

// GET /api/dashboard - Get comprehensive dashboard data for an org unit with RBAC
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
    const month = searchParams.get('month');

    // Default to user's own org if not specified
    const orgId = orgUnitId ? parseInt(orgUnitId) : user.orgUnitId;
    const yr = year ? parseInt(year) : new Date().getFullYear();
    const mo = month ? parseInt(month) : new Date().getMonth() + 1;

    // 3. Verify user can access this org's data
    const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, orgId);
    if (!canAccess) {
      return NextResponse.json(
        { error: 'Hauna ruhusa ya kuona data ya kitengo hiki' },
        { status: 403 }
      );
    }

    // Get org unit
    const orgUnit = await db.orgUnit.findUnique({
      where: { id: orgId },
      include: {
        parent: true,
      },
    });

    if (!orgUnit) {
      return NextResponse.json(
        { error: 'Kitengo cha shirika hakipatikani' },
        { status: 404 }
      );
    }

    const isConsolidated = orgUnit.type === 'jimbo' || orgUnit.type === 'markaz';
    const allDescendantIds = isConsolidated ? await getAllDescendantIds(orgId) : [];

    // ---- 1. Summary Stats ----
    const ownIncomeStats = await db.transaction.aggregate({
      where: { orgUnitId: orgId, type: 'income', year: yr },
      _sum: { amount: true },
      _count: true,
    });

    const ownExpenseStats = await db.transaction.aggregate({
      where: { orgUnitId: orgId, type: 'expense', year: yr },
      _sum: { amount: true },
      _count: true,
    });

    const ownIncome = ownIncomeStats._sum.amount || 0;
    const ownExpense = ownExpenseStats._sum.amount || 0;
    const ownTransactionCount = ownIncomeStats._count + ownExpenseStats._count;

    // ---- 2. Monthly Chart Data (own) ----
    const monthlyData: { month: number; income: number; expense: number }[] = [];
    for (let m = 1; m <= 12; m++) {
      const monthIncome = await db.transaction.aggregate({
        where: { orgUnitId: orgId, type: 'income', month: m, year: yr },
        _sum: { amount: true },
      });
      const monthExpense = await db.transaction.aggregate({
        where: { orgUnitId: orgId, type: 'expense', month: m, year: yr },
        _sum: { amount: true },
      });
      monthlyData.push({
        month: m,
        income: monthIncome._sum.amount || 0,
        expense: monthExpense._sum.amount || 0,
      });
    }

    // ---- 3. Department Breakdown ----
    const departments = ['Daawah', 'Elimu', 'Ustawi wa Jamii', 'Uchumi & Miradi', 'Habari'];
    const departmentBreakdown: { department: string; income: number; expense: number; balance: number }[] = [];

    for (const dept of departments) {
      const deptIncome = await db.transaction.aggregate({
        where: { orgUnitId: orgId, type: 'income', department: dept, year: yr },
        _sum: { amount: true },
      });
      const deptExpense = await db.transaction.aggregate({
        where: { orgUnitId: orgId, type: 'expense', department: dept, year: yr },
        _sum: { amount: true },
      });
      departmentBreakdown.push({
        department: dept,
        income: deptIncome._sum.amount || 0,
        expense: deptExpense._sum.amount || 0,
        balance: (deptIncome._sum.amount || 0) - (deptExpense._sum.amount || 0),
      });
    }

    // ---- 4. Approval Summary ----
    const approvalSummary = await getApprovalSummary(orgId, mo, yr);

    // ---- 5. Child Org Summaries (for jimbo/markaz) ----
    let childSummaries: any[] = [];
    let childSubmissions: any[] = [];

    if (isConsolidated) {
      const children = await db.orgUnit.findMany({
        where: { parentId: orgId, isActive: true },
      });

      for (const child of children) {
        const childIncome = await db.transaction.aggregate({
          where: { orgUnitId: child.id, type: 'income', year: yr },
          _sum: { amount: true },
          _count: true,
        });
        const childExpense = await db.transaction.aggregate({
          where: { orgUnitId: child.id, type: 'expense', year: yr },
          _sum: { amount: true },
          _count: true,
        });

        childSummaries.push({
          id: child.id,
          name: child.name,
          type: child.type,
          code: child.code,
          income: childIncome._sum.amount || 0,
          expense: childExpense._sum.amount || 0,
          balance: (childIncome._sum.amount || 0) - (childExpense._sum.amount || 0),
          transactionCount: childIncome._count + childExpense._count,
        });

        const childSub = await db.monthlySubmission.findUnique({
          where: { orgUnitId_month_year: { orgUnitId: child.id, month: mo, year: yr } },
        });

        childSubmissions.push({
          id: child.id,
          name: child.name,
          type: child.type,
          isSubmitted: childSub?.isSubmitted || false,
          approvalStatus: childSub?.approvalStatus || 'entered',
        });
      }
    }

    // ---- 6. Submission Tracking ----
    const submission = await db.monthlySubmission.findUnique({
      where: {
        orgUnitId_month_year: {
          orgUnitId: orgId,
          month: mo,
          year: yr,
        },
      },
    });

    // ---- 7. Recent Transactions ----
    const recentTransactions = await db.transaction.findMany({
      where: { orgUnitId: orgId, year: yr },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // ---- 8. Consolidated data for jimbo/markaz ----
    let consolidated: any | null = null;
    if (isConsolidated && allDescendantIds.length > 0) {
      const consolIncome = await db.transaction.aggregate({
        where: {
          orgUnitId: { in: [orgId, ...allDescendantIds] },
          type: 'income',
          year: yr,
        },
        _sum: { amount: true },
        _count: true,
      });

      const consolExpense = await db.transaction.aggregate({
        where: {
          orgUnitId: { in: [orgId, ...allDescendantIds] },
          type: 'expense',
          year: yr,
        },
        _sum: { amount: true },
        _count: true,
      });

      const consolTotalIncome = consolIncome._sum.amount || 0;
      const consolTotalExpense = consolExpense._sum.amount || 0;

      consolidated = {
        totalIncome: consolTotalIncome,
        totalExpense: consolTotalExpense,
        balance: consolTotalIncome - consolTotalExpense,
        transactionCount: consolIncome._count + consolExpense._count,
        ownIncome,
        ownExpense,
        childIncome: consolTotalIncome - ownIncome,
        childExpense: consolTotalExpense - ownExpense,
      };

      // Consolidated monthly data
      const consolMonthlyData: { month: number; income: number; expense: number }[] = [];
      for (let m = 1; m <= 12; m++) {
        const mIncome = await db.transaction.aggregate({
          where: {
            orgUnitId: { in: [orgId, ...allDescendantIds] },
            type: 'income',
            month: m,
            year: yr,
          },
          _sum: { amount: true },
        });
        const mExpense = await db.transaction.aggregate({
          where: {
            orgUnitId: { in: [orgId, ...allDescendantIds] },
            type: 'expense',
            month: m,
            year: yr,
          },
          _sum: { amount: true },
        });
        consolMonthlyData.push({
          month: m,
          income: mIncome._sum.amount || 0,
          expense: mExpense._sum.amount || 0,
        });
      }
      consolidated.monthlyData = consolMonthlyData;

      // Consolidated child submissions for the flow view
      consolidated.childFlow = await getChildSubmissionsForConsolidation(orgId, mo, yr);
    }

    // ---- 9. Unread notification count ----
    const unreadNotifications = await db.notification.count({
      where: { userId: user.userId, isRead: false },
    });

    return NextResponse.json({
      data: {
        orgUnit: {
          id: orgUnit.id,
          name: orgUnit.name,
          type: orgUnit.type,
          code: orgUnit.code,
          parent: orgUnit.parent ? {
            id: orgUnit.parent.id,
            name: orgUnit.parent.name,
            type: orgUnit.parent.type,
          } : null,
        },
        year: yr,
        month: mo,
        summary: {
          totalIncome: consolidated?.totalIncome || ownIncome,
          totalExpense: consolidated?.totalExpense || ownExpense,
          balance: consolidated?.balance || (ownIncome - ownExpense),
          transactionCount: consolidated?.transactionCount || ownTransactionCount,
          incomeCount: ownIncomeStats._count,
          expenseCount: ownExpenseStats._count,
          ownIncome,
          ownExpense,
        },
        monthlyData: consolidated?.monthlyData || monthlyData,
        departmentBreakdown,
        approvalSummary,
        childSummaries,
        childSubmissions,
        submission: submission ? {
          id: submission.id,
          isSubmitted: submission.isSubmitted,
          approvalStatus: submission.approvalStatus,
          submittedAt: submission.submittedAt,
          totalIncome: submission.totalIncome,
          totalExpense: submission.totalExpense,
          netBalance: submission.netBalance,
        } : null,
        recentTransactions,
        consolidated,
        unreadNotifications,
        userCapabilities: {
          canEnterData: ['muhasibu', 'mweka_hazina', 'admin'].includes(user.role),
          canReview: ['mweka_hazina', 'katibu', 'mudir', 'admin'].includes(user.role),
          canApprove: ['mudir', 'admin'].includes(user.role),
          canAccessAdmin: user.role === 'admin',
        },
      },
    });
  } catch (error) {
    console.error('Error getting dashboard data:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kupata taarifa za dashibodi' },
      { status: 500 }
    );
  }
}

// Helper: Recursively get all descendant org unit IDs
async function getAllDescendantIds(parentId: number): Promise<number[]> {
  const children = await db.orgUnit.findMany({
    where: { parentId, isActive: true },
    select: { id: true },
  });

  const ids: number[] = [];
  for (const child of children) {
    ids.push(child.id);
    const grandChildren = await getAllDescendantIds(child.id);
    ids.push(...grandChildren);
  }
  return ids;
}
