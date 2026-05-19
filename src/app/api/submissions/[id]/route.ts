import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, checkRateLimit } from '@/lib/rbac';
import { processSubmissionApproval } from '@/lib/approval-engine';
import { approvalActionSchema, createSubmissionSchema } from '@/lib/validations';
import { validateReportIntegrity } from '@/lib/financial-integrity';
import { createAuditLog } from '@/lib/api-helpers';

// GET /api/submissions/[id] - Get submission by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana' }, { status: 429 });
    }

    // 2. Auth + Permission check
    const rbac = await enforceRbac(request, { permission: 'view_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }

    const { id } = await params;
    const submission = await db.monthlySubmission.findUnique({
      where: { id: parseInt(id) },
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

    if (!submission) {
      return NextResponse.json(
        { error: 'Mawasilisho hayapatikani' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: submission });
  } catch (error) {
    console.error('Error getting submission:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kupata mawasilisho' },
      { status: 500 }
    );
  }
}

// PUT /api/submissions/[id] - Update submission (approve/reject, add notes)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana' }, { status: 429 });
    }

    const { id } = await params;
    const submissionId = parseInt(id);
    const body = await request.json();

    const existing = await db.monthlySubmission.findUnique({
      where: { id: submissionId },
      include: { orgUnit: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Mawasilisho hayapatikani' },
        { status: 404 }
      );
    }

    // Handle approval workflow actions
    if (body.approvalAction) {
      // 2. Auth + Permission check for approval actions
      const rbac = await enforceRbac(request, {
        permissions: ['review_data', 'approve_data'],
      });
      if (!rbac.allowed) {
        return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
      }
      const user = rbac.user!;

      // 3. Validate approval action with Zod
      const approvalData = {
        entityType: 'submission' as const,
        entityId: submissionId,
        action: body.approvalAction,
        notes: body.notes,
        rejectionReason: body.rejectionReason,
      };
      const parseResult = approvalActionSchema.safeParse(approvalData);
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

      // 4. Financial integrity check before approval
      if (body.approvalAction === 'approve') {
        const integrity = await validateReportIntegrity(
          existing.orgUnitId,
          existing.month,
          existing.year
        );
        if (!integrity.valid) {
          return NextResponse.json(
            {
              error: 'Ukaguzi wa maadamu wa kifedha umeshindwa',
              details: integrity.errors,
              totals: integrity.totals,
            },
            { status: 409 }
          );
        }
      }

      const result = await processSubmissionApproval({
        entityType: 'submission',
        entityId: submissionId,
        action: body.approvalAction,
        userId: user.userId,
        userRole: user.role,
        userOrgLevel: user.orgLevel,
        notes: body.notes,
        rejectionReason: body.rejectionReason,
        orgUnitId: existing.orgUnitId,
        month: existing.month,
        year: existing.year,
      });

      if (!result.success) {
        return NextResponse.json({ error: result.message }, { status: 400 });
      }

      // Audit log
      await createAuditLog(request, {
        action: body.approvalAction === 'approve' ? 'approve' : body.approvalAction === 'reject' ? 'reject' : 'review',
        entity: 'submission',
        entityId: submissionId,
        details: `Mawasilisho #${submissionId} - ${result.message}`,
        oldValue: JSON.stringify({ approvalStatus: existing.approvalStatus }),
        newValue: JSON.stringify({ approvalStatus: result.newStatus }),
      });

      return NextResponse.json({ data: result });
    }

    // Regular update (notes only, for non-approved submissions)
    const rbac = await enforceRbac(request, { permission: 'submit_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    if (existing.approvalStatus === 'approved') {
      return NextResponse.json(
        { error: 'Mawasilisho yameidhinishwa na hayawezi kubadilishwa' },
        { status: 409 }
      );
    }

    // Validate update data
    const updateData: any = {};
    if (body.notes !== undefined) {
      if (typeof body.notes !== 'string' || body.notes.length > 5000) {
        return NextResponse.json(
          { error: 'Taarifa si sahihi', details: [{ field: 'notes', message: 'Maudhui ni ndefu sana' }] },
          { status: 400 }
        );
      }
      updateData.notes = body.notes;
    }

    const updated = await db.monthlySubmission.update({
      where: { id: submissionId },
      data: updateData,
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('Error updating submission:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kuhariri mawasilisho' },
      { status: 500 }
    );
  }
}
