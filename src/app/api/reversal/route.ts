import { NextRequest, NextResponse } from 'next/server';
import { enforceRbac, checkRateLimit } from '@/lib/rbac';
import { createReversalEntry } from '@/lib/financial-integrity';
import { z } from 'zod';
import { createAuditLog } from '@/lib/api-helpers';

// Zod schema for reversal request
const reversalSchema = z.object({
  transactionId: z.number().int().positive('Kitambulisho cha muamala ni lazima'),
  reason: z
    .string()
    .trim()
    .min(3, 'Sababu ya kubatilisha ni lazima (angalau herufi 3)')
    .max(500, 'Sababu ni ndefu mno'),
});

// POST /api/reversal - Create a reversal entry for a transaction
// Requires 'enter_data' permission
export async function POST(request: NextRequest) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth + Permission check
    const rbac = await enforceRbac(request, { permission: 'enter_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    // 3. Parse and validate body with Zod
    const body = await request.json();
    const parseResult = reversalSchema.safeParse(body);
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

    // 4. Create reversal entry using financial integrity engine
    const result = await createReversalEntry(
      data.transactionId,
      user.userId,
      data.reason
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    // 5. Audit log for the reversal request
    await createAuditLog(request, {
      action: 'reverse_request',
      entity: 'transaction',
      entityId: data.transactionId,
      details: `Ombi la kubatilisha muamala #${data.transactionId}. Sababu: ${data.reason}`,
      newValue: JSON.stringify({
        originalTransactionId: data.transactionId,
        reversalId: result.reversalId,
        reason: data.reason,
      }),
    });

    return NextResponse.json({
      data: {
        success: true,
        reversalId: result.reversalId,
        originalTransactionId: data.transactionId,
        message: 'Muamala umebatilishwa kwa mafanikio',
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating reversal:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kubatilisha muamala' },
      { status: 500 }
    );
  }
}
