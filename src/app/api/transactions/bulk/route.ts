import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST /api/transactions/bulk - Create multiple transactions (for Excel import)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transactions, importBatchId, userId } = body;

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return NextResponse.json(
        { error: 'Hakuna taarifa za kuagiza' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'UserId inahitajika' },
        { status: 400 }
      );
    }

    const results: { created: number[]; errors: { index: number; error: string }[] } = {
      created: [],
      errors: [],
    };

    for (let i = 0; i < transactions.length; i++) {
      const txn = transactions[i];

      try {
        // Validate required fields
        if (!txn.type || !txn.amount || !txn.date || !txn.month || !txn.year || !txn.department || !txn.categoryId || !txn.orgUnitId) {
          results.errors.push({ index: i, error: 'Taarifa muhimu hazijawasilishwa' });
          continue;
        }

        // Auto-fill orgUnit info
        const orgUnit = await db.orgUnit.findUnique({
          where: { id: parseInt(txn.orgUnitId) },
        });
        if (!orgUnit) {
          results.errors.push({ index: i, error: 'Kitengo cha shirika hakipatikani' });
          continue;
        }

        // Auto-fill category info
        const category = await db.category.findUnique({
          where: { id: parseInt(txn.categoryId) },
        });
        if (!category) {
          results.errors.push({ index: i, error: 'Kundi halipatikani' });
          continue;
        }

        const transaction = await db.transaction.create({
          data: {
            type: txn.type,
            amount: parseFloat(txn.amount),
            date: new Date(txn.date),
            month: parseInt(txn.month),
            year: parseInt(txn.year),
            department: txn.department,
            categoryId: parseInt(txn.categoryId),
            categoryName: category.name,
            description: txn.description || null,
            source: txn.source || null,
            vendor: txn.vendor || null,
            quantity: txn.quantity ? parseFloat(txn.quantity) : null,
            unitPrice: txn.unitPrice ? parseFloat(txn.unitPrice) : null,
            unit: txn.unit || null,
            orgUnitId: parseInt(txn.orgUnitId),
            orgUnitName: orgUnit.name,
            orgLevel: orgUnit.type,
            enteredBy: parseInt(userId),
            importBatchId: importBatchId ? parseInt(importBatchId) : null,
            financialYear: parseInt(txn.year),
            isOpening: txn.isOpening || false,
          },
        });

        results.created.push(transaction.id);
      } catch (err) {
        results.errors.push({
          index: i,
          error: err instanceof Error ? err.message : 'Hitilafu isiyojulikana',
        });
      }
    }

    // Log to audit
    await db.auditLog.create({
      data: {
        action: 'import',
        entity: 'transaction',
        entityId: 0,
        userId: parseInt(userId),
        details: `Kuagiza muamala: ${results.created.length} zimeundwa, ${results.errors.length} makosa`,
      },
    });

    return NextResponse.json({
      data: results,
      summary: {
        total: transactions.length,
        created: results.created.length,
        errors: results.errors.length,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error in bulk create transactions:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kuunda miaamala' },
      { status: 500 }
    );
  }
}

// PUT /api/transactions/bulk - Bulk submit or lock transactions
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, orgUnitId, month, year, transactionIds, userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'UserId inahitajika' },
        { status: 400 }
      );
    }

    if (!action || !['submit', 'lock'].includes(action)) {
      return NextResponse.json(
        { error: 'Hatua si sahihi (submit au lock)' },
        { status: 400 }
      );
    }

    const where: any = {};

    // Filter by specific IDs or by orgUnitId/month/year
    if (transactionIds && Array.isArray(transactionIds) && transactionIds.length > 0) {
      where.id = { in: transactionIds.map((id: number) => parseInt(String(id))) };
    } else if (orgUnitId && month && year) {
      where.orgUnitId = parseInt(orgUnitId);
      where.month = parseInt(month);
      where.year = parseInt(year);
    } else {
      return NextResponse.json(
        { error: 'Taja transactionIds au orgUnitId/month/year' },
        { status: 400 }
      );
    }

    let updateData = {};
    let logMessage = '';

    if (action === 'submit') {
      // Can only submit unlocked transactions
      where.isSubmitted = false;
      where.isLocked = false;
      updateData = {
        isSubmitted: true,
        submittedAt: new Date(),
      };
      logMessage = `Muamala umewasilishwa kwa mwezi ${month}/${year}`;
    } else if (action === 'lock') {
      // Can only lock submitted transactions
      where.isSubmitted = true;
      where.isLocked = false;
      updateData = {
        isLocked: true,
        isApproved: true,
        approverId: parseInt(userId),
        approvedAt: new Date(),
      };
      logMessage = `Muamala umefungwa kwa mwezi ${month}/${year}`;
    }

    const result = await db.transaction.updateMany({
      where,
      data: updateData,
    });

    // Log to audit
    await db.auditLog.create({
      data: {
        action: action === 'submit' ? 'submit' : 'approve',
        entity: 'transaction',
        entityId: 0,
        userId: parseInt(userId),
        details: `${logMessage} - ${result.count} miaamala`,
      },
    });

    return NextResponse.json({
      data: {
        action,
        affectedCount: result.count,
      },
    });
  } catch (error) {
    console.error('Error in bulk update transactions:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kubadilisha miaamala' },
      { status: 500 }
    );
  }
}
