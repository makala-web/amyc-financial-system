import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, checkRateLimit, sanitizeString } from '@/lib/rbac';
import { processTransactionApproval } from '@/lib/approval-engine';
import { updateTransactionSchema } from '@/lib/validations';
import { isTransactionLocked, validateFinancialPeriod, createReversalEntry } from '@/lib/financial-integrity';

// GET /api/transactions/[id] - Get single transaction
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rbac = await enforceRbac(request, { permission: 'view_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    const { id } = await params;
    const transactionId = parseInt(id);
    const transaction = await db.transaction.findUnique({
      where: { id: transactionId },
      include: {
        attachments: true,
        enteredByUser: { select: { id: true, fullName: true, role: true } },
        reviewer: { select: { id: true, fullName: true, role: true } },
        approver: { select: { id: true, fullName: true, role: true } },
      },
    });

    if (!transaction) {
      return NextResponse.json({ error: 'Muamala hupatikani' }, { status: 404 });
    }

    // Verify org scope access
    const { canAccessOrg } = await import('@/lib/rbac');
    const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, transaction.orgUnitId);
    if (!canAccess) {
      return NextResponse.json({ error: 'Hauna ruhusa ya kuona muamala huu' }, { status: 403 });
    }

    const approvalSteps = await db.approvalStep.findMany({
      where: {
        entityType: 'transaction',
        entityId: transactionId,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, fullName: true, role: true } },
      },
    });

    return NextResponse.json({ data: { ...transaction, approvalSteps } });
  } catch (error) {
    console.error('Error getting transaction:', error);
    return NextResponse.json({ error: 'Imeshindwa kupata muamala' }, { status: 500 });
  }
}

// PUT /api/transactions/[id] - Update transaction with Zod + Financial Integrity checks
// Handles both regular updates and approval workflow
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana' }, { status: 429 });
    }

    const { id } = await params;
    const txnId = parseInt(id);
    const body = await request.json();

    // ============================================================
    // Approval Workflow Branch
    // ============================================================
    if (body.approvalAction) {
      const rbac = await enforceRbac(request, {
        permissions: ['review_data', 'approve_data'],
      });
      if (!rbac.allowed) {
        return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
      }
      const user = rbac.user!;

      const result = await processTransactionApproval({
        entityType: 'transaction',
        entityId: txnId,
        action: body.approvalAction, // review, approve, reject
        userId: user.userId,
        userRole: user.role,
        userOrgLevel: user.orgLevel,
        notes: body.notes,
        rejectionReason: body.rejectionReason,
      });

      if (!result.success) {
        return NextResponse.json({ error: result.message }, { status: 400 });
      }

      // Audit log
      await db.auditLog.create({
        data: {
          action: body.approvalAction === 'approve' ? 'approve' : body.approvalAction === 'reject' ? 'reject' : 'review',
          entity: 'transaction',
          entityId: txnId,
          userId: user.userId,
          details: `Muamala #${txnId} - ${result.message}`,
          oldValue: JSON.stringify({ approvalStatus: body.previousStatus }),
          newValue: JSON.stringify({ approvalStatus: result.newStatus }),
          ipAddress: request.headers.get('x-forwarded-for') || null,
          userAgent: request.headers.get('user-agent') || null,
        },
      });

      return NextResponse.json({ data: result });
    }

    // ============================================================
    // Regular Update Branch - with Zod validation + Financial Integrity
    // ============================================================
    const rbac = await enforceRbac(request, { permission: 'enter_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    const existing = await db.transaction.findUnique({
      where: { id: txnId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Muamala hupatikani' }, { status: 404 });
    }

    // Financial Integrity: Cannot edit locked/approved transactions
    if (existing.isLocked || existing.approvalStatus === 'approved') {
      return NextResponse.json(
        { error: 'Muamala umekwishaidhinishwa na hauwezi kubadilishwa' },
        { status: 409 }
      );
    }

    // Verify user can edit this org's data
    if (existing.orgUnitId !== user.orgUnitId && user.role !== 'admin') {
      return NextResponse.json({ error: 'Hauna ruhusa ya kubadilisha muamala huu' }, { status: 403 });
    }

    // Financial Integrity: Validate the financial period is still open
    const periodCheck = await validateFinancialPeriod(existing.orgUnitId, existing.month, existing.year);
    if (!periodCheck.valid) {
      return NextResponse.json({ error: periodCheck.error }, { status: 409 });
    }

    // Zod validation for partial update
    const partialSchema = updateTransactionSchema.partial().omit({ id: true });
    const parseResult = partialSchema.safeParse(body);
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

    // Store old values for audit
    const oldValue = JSON.stringify({
      type: existing.type,
      amount: Number(existing.amount),
      department: existing.department,
      categoryId: existing.categoryId,
      description: existing.description,
      source: existing.source,
      vendor: existing.vendor,
      quantity: existing.quantity ? Number(existing.quantity) : null,
      unitPrice: existing.unitPrice ? Number(existing.unitPrice) : null,
      unit: existing.unit,
    });

    const updateData: any = {};
    if (body.amount !== undefined) updateData.amount = body.amount;
    if (body.description !== undefined) updateData.description = body.description ? sanitizeString(body.description) : null;
    if (body.source !== undefined) updateData.source = body.source ? sanitizeString(body.source) : null;
    if (body.vendor !== undefined) updateData.vendor = body.vendor ? sanitizeString(body.vendor) : null;
    if (body.quantity !== undefined) updateData.quantity = body.quantity ?? null;
    if (body.unitPrice !== undefined) updateData.unitPrice = body.unitPrice ?? null;
    if (body.unit !== undefined) updateData.unit = body.unit ? sanitizeString(body.unit) : null;
    if (body.department !== undefined) updateData.department = sanitizeString(body.department);
    if (body.categoryId !== undefined) {
      updateData.categoryId = parseInt(body.categoryId);
      const cat = await db.category.findUnique({ where: { id: parseInt(body.categoryId) } });
      if (cat) updateData.categoryName = cat.name;
    }

    const updated = await db.transaction.update({
      where: { id: txnId },
      data: updateData,
    });

    // Audit log with old/new values
    await db.auditLog.create({
      data: {
        action: 'update',
        entity: 'transaction',
        entityId: txnId,
        userId: user.userId,
        details: `Muamala #${txnId} umebadilishwa`,
        oldValue,
        newValue: JSON.stringify({
          type: updated.type,
          amount: Number(updated.amount),
          department: updated.department,
          categoryId: updated.categoryId,
          description: updated.description,
          source: updated.source,
          vendor: updated.vendor,
          quantity: updated.quantity ? Number(updated.quantity) : null,
          unitPrice: updated.unitPrice ? Number(updated.unitPrice) : null,
          unit: updated.unit,
        }),
        ipAddress: request.headers.get('x-forwarded-for') || null,
        userAgent: request.headers.get('user-agent') || null,
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('Error updating transaction:', error);
    return NextResponse.json({ error: 'Imeshindwa kubadilisha muamala' }, { status: 500 });
  }
}

// DELETE /api/transactions/[id] - Soft delete via reversal entry
// Production financial systems NEVER hard-delete transactions.
// Instead, we create a reversal entry and mark the original as rejected.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rbac = await enforceRbac(request, { permission: 'delete_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    const { id } = await params;
    const txnId = parseInt(id);

    // Get reason from query params (required for reversal)
    const { searchParams } = new URL(request.url);
    const reason = searchParams.get('reason');

    if (!reason || reason.trim().length < 3) {
      return NextResponse.json(
        { error: 'Sababu ya kubatilisha muamala ni lazima (angalau herufi 3)' },
        { status: 400 }
      );
    }

    // Check if transaction is locked via financial integrity engine
    const locked = await isTransactionLocked(txnId);
    if (locked) {
      // For locked/approved transactions, we cannot even reverse them via normal means
      const existing = await db.transaction.findUnique({ where: { id: txnId } });
      if (!existing) {
        return NextResponse.json({ error: 'Muamala hupatikani' }, { status: 404 });
      }
      return NextResponse.json(
        { error: 'Muamala umekwishaidhinishwa na hauwezi kufutwa. Wasiliana na msimamizi kwa mbinu ya kubadilisha kuidhinishwa.' },
        { status: 409 }
      );
    }

    const existing = await db.transaction.findUnique({
      where: { id: txnId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Muamala hupatikani' }, { status: 404 });
    }

    // Verify user can delete this org's data
    if (existing.orgUnitId !== user.orgUnitId && user.role !== 'admin') {
      return NextResponse.json({ error: 'Hauna ruhusa ya kufuta muamala huu' }, { status: 403 });
    }

    // Financial Integrity: Validate the financial period is still open
    const periodCheck = await validateFinancialPeriod(existing.orgUnitId, existing.month, existing.year);
    if (!periodCheck.valid) {
      return NextResponse.json({ error: periodCheck.error }, { status: 409 });
    }

    // ============================================================
    // Use Reversal Entry instead of hard delete
    // This is the correct accounting practice
    // ============================================================
    const reversalResult = await createReversalEntry(
      txnId,
      user.userId,
      reason.trim()
    );

    if (!reversalResult.success) {
      return NextResponse.json(
        { error: reversalResult.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      data: {
        id: txnId,
        deleted: false, // Not truly deleted - reversed
        reversed: true,
        reversalId: reversalResult.reversalId,
        message: 'Muamala umebatilishwa kwa usahihi. Muamala wa kubatilisha umewekwa.',
      },
    });
  } catch (error) {
    console.error('Error reversing transaction:', error);
    return NextResponse.json({ error: 'Imeshindwa kubatilisha muamala' }, { status: 500 });
  }
}
