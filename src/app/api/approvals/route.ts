import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, buildOrgScopedWhere, checkRateLimit } from '@/lib/rbac';
import { getApprovalSummary, getChildSubmissionsForConsolidation } from '@/lib/approval-engine';

// GET /api/approvals - Get approval status summary and pending items
export async function GET(request: NextRequest) {
  try {
    const rbac = await enforceRbac(request, {
      permissions: ['review_data', 'approve_data', 'view_data'],
    });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const year = searchParams.get('year');
    const orgUnitId = searchParams.get('orgUnitId');
    const includeChildren = searchParams.get('includeChildren') === 'true';

    const mo = month ? parseInt(month) : new Date().getMonth() + 1;
    const yr = year ? parseInt(year) : new Date().getFullYear();
    const targetOrgId = orgUnitId ? parseInt(orgUnitId) : user.orgUnitId;

    // Get approval summary for this org
    const summary = await getApprovalSummary(targetOrgId, mo, yr);

    // Get pending transactions that need review/approval
    const orgScope = await buildOrgScopedWhere(user.orgUnitId, user.orgLevel);
    const pendingTransactions = await db.transaction.findMany({
      where: {
        ...orgScope,
        approvalStatus: { in: ['entered', 'reviewed'] },
        month: mo,
        year: yr,
      },
      orderBy: [{ date: 'desc' }],
      include: {
        enteredByUser: { select: { id: true, fullName: true, role: true } },
        reviewer: { select: { id: true, fullName: true, role: true } },
      },
      take: 50,
    });

    // Get rejected transactions
    const rejectedTransactions = await db.transaction.findMany({
      where: {
        ...orgScope,
        approvalStatus: 'rejected',
        month: mo,
        year: yr,
      },
      orderBy: [{ rejectedAt: 'desc' }],
      take: 20,
    });

    // Get pending submissions
    const pendingSubmissions = await db.monthlySubmission.findMany({
      where: {
        ...orgScope,
        approvalStatus: { in: ['entered', 'reviewed'] },
      },
      include: {
        orgUnit: { select: { id: true, name: true, type: true, code: true } },
        submitter: { select: { id: true, fullName: true } },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    // Get child submissions for consolidated view (Jimbo/Markaz)
    let childSubmissions: any[] | null = null;
    if (includeChildren && (user.orgLevel === 'jimbo' || user.orgLevel === 'markaz')) {
      childSubmissions = await getChildSubmissionsForConsolidation(targetOrgId, mo, yr);
    }

    // Determine what actions the user can take
    const canReview = ['mweka_hazina', 'katibu', 'mudir', 'admin'].includes(user.role);
    const canApprove = ['mudir', 'admin'].includes(user.role);

    return NextResponse.json({
      data: {
        summary,
        pendingTransactions,
        rejectedTransactions,
        pendingSubmissions,
        childSubmissions,
        userCapabilities: {
          canReview,
          canApprove,
          canEnterData: ['muhasibu', 'mweka_hazina', 'admin'].includes(user.role),
        },
      },
    });
  } catch (error) {
    console.error('Error getting approval data:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kupata taarifa za uidhinishaji' },
      { status: 500 }
    );
  }
}
