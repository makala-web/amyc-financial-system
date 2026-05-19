import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, checkRateLimit, canAccessOrg } from '@/lib/rbac';
import { excelImportSchema } from '@/lib/validations';
import { createAuditLog } from '@/lib/api-helpers';
import { assertStrongReportSignatureSalt } from '@/lib/reports/integrity';

// GET /api/imports - List import batches with filters
export async function GET(request: NextRequest) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth + Permission check
    const rbac = await enforceRbac(request, { permissions: ['import_data', 'view_data'] });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const targetOrgId = searchParams.get('targetOrgId');
    const sourceOrgId = searchParams.get('sourceOrgId');
    const importedBy = searchParams.get('importedBy');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const where: any = {};

    if (status) where.status = status;
    if (importedBy) where.importedBy = parseInt(importedBy);

    // Apply org scope - users can only see imports for their org or child orgs
    if (targetOrgId) {
      const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, parseInt(targetOrgId));
      if (!canAccess) {
        return NextResponse.json({ error: 'Hauna ruhusa ya kuona maagizo ya kitengo hiki.' }, { status: 403 });
      }
      where.targetOrgId = parseInt(targetOrgId);
    } else if (user.role !== 'admin') {
      const { getVisibleOrgIds } = await import('@/lib/rbac');
      const visibleIds = await getVisibleOrgIds(user.orgUnitId, user.orgLevel);
      where.targetOrgId = { in: visibleIds };
    }

    if (sourceOrgId) where.sourceOrgId = parseInt(sourceOrgId);

    const [batches, total] = await Promise.all([
      db.importBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          sourceOrg: {
            select: { id: true, name: true, type: true, code: true },
          },
          targetOrg: {
            select: { id: true, name: true, type: true, code: true },
          },
          importer: {
            select: { id: true, fullName: true, email: true },
          },
          _count: {
            select: { transactions: true },
          },
        },
      }),
      db.importBatch.count({ where }),
    ]);

    return NextResponse.json({
      data: batches,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error listing import batches:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kupata maagizo' },
      { status: 500 }
    );
  }
}

// POST /api/imports - Process Excel import (accept JSON data from parsed Excel)
export async function POST(request: NextRequest) {
  try {
    assertStrongReportSignatureSalt();
    // 1. Stricter rate limit for imports (30/min instead of 60/min)
    const rateLimit = checkRateLimit(request, 30);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Maombi mengi sana. Jaribu tena baadaye. Kikomo: mara 30 kila dakika.' },
        { status: 429 }
      );
    }

    // 2. Auth + Permission check
    const rbac = await enforceRbac(request, { permission: 'import_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    const body = await request.json();

    const {
      fileName,
      fileSize,
      sourceOrgId,
      targetOrgId,
      importType,
      records,
    } = body;

    // 3. Validate import metadata with Zod
    const metaParse = excelImportSchema.safeParse({
      sourceOrgId: sourceOrgId || targetOrgId,
      targetOrgId,
      importType,
      month: records?.[0]?.month || 1,
      year: records?.[0]?.year || new Date().getFullYear(),
    });
    if (!metaParse.success) {
      return NextResponse.json(
        {
          error: 'Taarifa si sahihi',
          details: metaParse.error.issues.map(e => ({
            field: (e.path || []).join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const parsedTargetOrgId = parseInt(targetOrgId);
    const parsedSourceOrgId = parseInt(sourceOrgId || targetOrgId);

    // 4. Strict offline-first flow:
    // target must be current user's org; source must be direct child of target.
    if (parsedTargetOrgId !== user.orgUnitId) {
      return NextResponse.json(
        { error: 'Kwa offline workflow, unaweza ku-import ndani ya kitengo chako tu.' },
        { status: 403 }
      );
    }

    if (!fileName || !targetOrgId || !importType || !records) {
      return NextResponse.json(
        { error: 'Taarifa muhimu hazijawasilishwa' },
        { status: 400 }
      );
    }

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json(
        { error: 'Hakuna rekodi za kuagiza' },
        { status: 400 }
      );
    }

    // Limit batch size to prevent abuse
    if (records.length > 500) {
      return NextResponse.json(
        { error: 'Ukubwa wa batchi ni mkubwa mno. Tuma rekodi 500 au chache kwa wakati mmoja.' },
        { status: 400 }
      );
    }

    // Create import batch
    const importBatch = await db.importBatch.create({
      data: {
        fileName,
        fileSize: fileSize || 0,
        sourceOrgId: parsedSourceOrgId,
        targetOrgId: parsedTargetOrgId,
        importType,
        recordCount: records.length,
        status: 'processing',
        importedBy: user.userId,
      },
    });

    // Validate target org exists
    const targetOrg = await db.orgUnit.findUnique({ where: { id: parsedTargetOrgId } });
    if (!targetOrg) {
      await db.importBatch.update({
        where: { id: importBatch.id },
        data: { status: 'error', errors: 'Kitengo cha shirika hakipatikani' },
      });
      return NextResponse.json(
        { error: 'Kitengo cha shirika hakipatikani' },
        { status: 404 }
      );
    }
    const sourceOrg = await db.orgUnit.findUnique({ where: { id: parsedSourceOrgId } });
    if (!sourceOrg) {
      return NextResponse.json({ error: 'Kitengo chanzo hakipatikani.' }, { status: 404 });
    }
    if (sourceOrg.parentId !== targetOrg.id) {
      return NextResponse.json(
        { error: 'Flow imekataliwa: import inaruhusiwa kutoka mtoto wa moja kwa moja tu.' },
        { status: 403 }
      );
    }

    const results: { created: number[]; errors: { index: number; error: string }[] } = {
      created: [],
      errors: [],
    };

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      try {
        if (!record.type || !record.amount || !record.date || !record.month || !record.year || !record.department || !record.categoryName) {
          results.errors.push({ index: i, error: `Rekodi #${i + 1}: Taarifa muhimu hazijawasilishwa` });
          continue;
        }

        // Find or create category
        let category = await db.category.findFirst({
          where: {
            name: record.categoryName,
            type: record.type,
            orgLevel: targetOrg.type,
          },
        });

        if (!category) {
          category = await db.category.create({
            data: {
              name: record.categoryName,
              type: record.type,
              orgLevel: targetOrg.type,
              orgUnitId: parseInt(targetOrgId),
              isDefault: false,
            },
          });
        }

        // Create transaction
        const transaction = await db.transaction.create({
          data: {
            type: record.type,
            amount: parseFloat(record.amount),
            date: new Date(record.date),
            month: parseInt(record.month),
            year: parseInt(record.year),
            department: record.department,
            categoryId: category.id,
            categoryName: category.name,
            description: record.description || null,
            source: record.source || null,
            vendor: record.vendor || null,
            quantity: record.quantity ? parseFloat(record.quantity) : null,
            unitPrice: record.unitPrice ? parseFloat(record.unitPrice) : null,
            unit: record.unit || null,
            orgUnitId: parseInt(targetOrgId),
            orgUnitName: targetOrg.name,
            orgLevel: targetOrg.type,
            enteredBy: user.userId,
            importBatchId: importBatch.id,
            financialYear: parseInt(record.year),
            isOpening: record.isOpening || false,
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

    // Update import batch
    await db.importBatch.update({
      where: { id: importBatch.id },
      data: {
        validCount: results.created.length,
        errorCount: results.errors.length,
        status: results.errors.length === 0 ? 'completed' : (results.created.length > 0 ? 'completed' : 'error'),
        errors: results.errors.length > 0 ? JSON.stringify(results.errors.slice(0, 50)) : null,
        processedAt: new Date(),
      },
    });

    // 5. Audit log
    await createAuditLog(request, {
      action: 'import',
      entity: 'import',
      entityId: importBatch.id,
      details: `Kuagiza faili: ${fileName} - ${results.created.length} zimeundwa, ${results.errors.length} makosa`,
      newValue: JSON.stringify({
        batchId: importBatch.id,
        fileName,
        totalRecords: records.length,
        created: results.created.length,
        errors: results.errors.length,
      }),
    });

    return NextResponse.json({
      data: {
        batchId: importBatch.id,
        fileName,
        totalRecords: records.length,
        created: results.created.length,
        errors: results.errors.length,
        errorDetails: results.errors.slice(0, 20),
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error processing import:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kusindika kuagiza' },
      { status: 500 }
    );
  }
}
