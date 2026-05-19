// ============================================================
// API Route: Generate Branch Unified Report (uses shared generator)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { generateBranchUnifiedReport } from '@/lib/reports/branch-unified-report';
import { enforceRbac } from '@/lib/rbac';
import { assertStrongReportSignatureSalt } from '@/lib/reports/integrity';

export async function GET(request: NextRequest) {
  try {
    assertStrongReportSignatureSalt();
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    if (!branchId || !year) {
      return NextResponse.json({ error: 'Missing required parameters: branchId, year' }, { status: 400 });
    }

    const bId = parseInt(branchId);
    const yr = parseInt(year);
    const mo = month ? parseInt(month) : undefined;

    // Validate parsed integers
    if (isNaN(bId) || isNaN(yr)) {
      return NextResponse.json({ error: 'Invalid branchId or year format' }, { status: 400 });
    }
    if (mo !== undefined && isNaN(mo)) {
      return NextResponse.json({ error: 'Invalid month format' }, { status: 400 });
    }

    const rbac = await enforceRbac(request, { permission: 'view_data', targetOrgId: bId });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }

    try {
      const report = await generateBranchUnifiedReport(bId, yr, mo, rbac.user?.userId);
      return NextResponse.json(report, { status: 200 });
    } catch (err) {
      // If generator throws because unit is not a branch or not found, return readable message
      const msg = err instanceof Error ? err.message : 'Failed to generate branch report';
      console.error('Branch unified report error:', err);
      return NextResponse.json({ error: msg }, { status: 404 });
    }
  } catch (error) {
    console.error('Error generating branch unified report:', error);
    return NextResponse.json({ error: 'Failed to generate report', details: String(error) }, { status: 500 });
  }
}
