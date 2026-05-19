import { NextRequest, NextResponse } from 'next/server';
import { enforceRbac, checkRateLimit } from '@/lib/rbac';
import { saveImportedBranchReport } from '@/lib/reports/branch-unified-report';
import type { BranchReportSnapshot } from '@/lib/exporters/branch-export';

export async function POST(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request, 30);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Maombi mengi sana. Jaribu tena baadaye.' },
        { status: 429 }
      );
    }

    const rbac = await enforceRbac(request, { permission: 'import_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }

    const user = rbac.user!;
    const body = await request.json();
    const branchId = Number(body.branchId);
    const fileName = typeof body.fileName === 'string' ? body.fileName : undefined;
    const snapshot = body.snapshot as BranchReportSnapshot | undefined;

    if (!Number.isFinite(branchId) || branchId <= 0 || !snapshot) {
      return NextResponse.json(
        { error: 'Taarifa za import ya ripoti ya tawi hazijakamilika.' },
        { status: 400 }
      );
    }

    if (user.orgLevel !== 'jimbo') {
      return NextResponse.json(
        { error: 'Ripoti ya Tawi inaweza kupakiwa na Jimbo pekee.' },
        { status: 403 }
      );
    }

    await saveImportedBranchReport({
      snapshot,
      branchId,
      uploadedBy: user.userId,
      fileName,
    });

    return NextResponse.json({
      data: {
        success: true,
        branchId,
      },
    });
  } catch (error) {
    console.error('Error importing branch report:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Imeshindwa kupakia ripoti ya tawi.' },
      { status: 500 }
    );
  }
}
