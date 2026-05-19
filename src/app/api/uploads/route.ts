// ============================================================
// AMYC Financial Management System - File Upload API
// POST: Secure file upload with validation
// GET: List attachments with filtering
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { db } from '@/lib/db';
import { enforceRbac, checkRateLimit, buildOrgScopedWhere } from '@/lib/rbac';
import { createAuditLog } from '@/lib/api-helpers';
import {
  validateFileType,
  validateFileSize,
  sanitizeFileName,
  generateUniqueFileName,
  getExtensionFromMime,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  UPLOAD_DIR,
} from '@/lib/file-upload';

// ============================================================
// Zod Validation Schema
// ============================================================

const uploadFormSchema = z.object({
  category: z.enum(['receipt', 'voucher', 'invoice', 'contract', 'other']),
  orgUnitId: z.coerce.number().int().positive(),
  transactionId: z.coerce.number().int().positive().optional(),
  description: z.string().trim().max(500).optional(),
});

// ============================================================
// POST: Upload a file
// ============================================================

export async function POST(request: NextRequest) {
  try {
    // 1. Rate limiting
    const rateLimit = checkRateLimit(request, 30); // 30 uploads per minute
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Maombi mengi mno. Tafadhali subiri kidogo.' },
        { status: 429 }
      );
    }

    // 2. Authentication & RBAC
    const rbac = await enforceRbac(request, { permission: 'enter_data' });
    if (!rbac.allowed) {
      return NextResponse.json(
        { error: rbac.error },
        { status: rbac.statusCode }
      );
    }
    const user = rbac.user!;

    // 3. Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'Faili halijapatikana. Tafadhali chagua faili.' },
        { status: 400 }
      );
    }

    // 4. Validate file type
    if (!validateFileType(file.type)) {
      return NextResponse.json(
        {
          error: `Aina ya faili haijaruhusiwa. Aina zinzuruhusiwa: ${ALLOWED_MIME_TYPES.join(', ')}`,
          allowedTypes: ALLOWED_MIME_TYPES,
        },
        { status: 415 }
      );
    }

    // 5. Validate file size
    if (!validateFileSize(file.size)) {
      return NextResponse.json(
        {
          error: `Faili ni kubwa mno. Ukubwa wa juu: ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
          maxSize: MAX_FILE_SIZE,
        },
        { status: 413 }
      );
    }

    // 6. Validate form fields
    const formFields = {
      category: formData.get('category') as string,
      orgUnitId: formData.get('orgUnitId') as string,
      transactionId: formData.get('transactionId') as string | null,
      description: formData.get('description') as string | null,
    };

    const parsed = uploadFormSchema.safeParse(formFields);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message).join(', ');
      return NextResponse.json(
        { error: `Data si sahihi: ${errors}` },
        { status: 400 }
      );
    }
    const { category, orgUnitId, transactionId, description } = parsed.data;

    // 7. Org scope check
    const { canAccessOrg } = await import('@/lib/rbac');
    const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, orgUnitId);
    if (!canAccess) {
      return NextResponse.json(
        { error: 'Hauna ruhusa ya kuweka faili katika kitengo hiki.' },
        { status: 403 }
      );
    }

    // 8. If transactionId provided, verify transaction exists and belongs to org
    if (transactionId) {
      const transaction = await db.transaction.findFirst({
        where: { id: transactionId, orgUnitId },
      });
      if (!transaction) {
        return NextResponse.json(
          { error: 'Muamala haujapatikana au hauhusiani na kitengo hiki.' },
          { status: 400 }
        );
      }
    }

    // 9. Generate unique filename and save file
    const sanitizedOriginalName = sanitizeFileName(file.name);
    const uniqueFileName = generateUniqueFileName(file.name);
    const filePath = path.join(UPLOAD_DIR, uniqueFileName);

    // Ensure upload directory exists
    try {
      await mkdir(UPLOAD_DIR, { recursive: true });
    } catch {
      // Directory may already exist
    }

    // Read file buffer and write to disk
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, fileBuffer);

    // 10. Create database record
    const attachment = await db.attachment.create({
      data: {
        fileName: sanitizedOriginalName,
        fileType: file.type,
        fileSize: file.size,
        fileData: uniqueFileName, // Store the unique filename as reference
        filePath: filePath, // Store full disk path
        category,
        transactionId: transactionId || null,
        orgUnitId,
        uploadedBy: user.userId,
        description: description || null,
      },
    });

    // 11. Audit log
    await createAuditLog(request, {
      action: 'create',
      entity: 'attachment',
      entityId: attachment.id,
      details: `Faili lilipakiwa: ${sanitizedOriginalName} (${category}, ${file.size} bytes)`,
      newValue: JSON.stringify({
        id: attachment.id,
        fileName: sanitizedOriginalName,
        fileType: file.type,
        fileSize: file.size,
        category,
        orgUnitId,
        transactionId: transactionId || null,
      }),
    });

    // 12. Return attachment record (without file path for security)
    const { filePath: _fp, fileData: _fd, ...safeAttachment } = attachment;
    return NextResponse.json(
      {
        attachment: safeAttachment,
        message: 'Faili limepakiwa kikamilifu',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[Upload API] Error:', error);
    return NextResponse.json(
      { error: 'Hitilafu ya ndani ya seva. Tafadhali jaribu tena.' },
      { status: 500 }
    );
  }
}

// ============================================================
// GET: List attachments
// ============================================================

export async function GET(request: NextRequest) {
  try {
    // 1. Rate limiting
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Maombi mengi mno. Tafadhali subiri kidogo.' },
        { status: 429 }
      );
    }

    // 2. Authentication & RBAC
    const rbac = await enforceRbac(request, { permission: 'view_data' });
    if (!rbac.allowed) {
      return NextResponse.json(
        { error: rbac.error },
        { status: rbac.statusCode }
      );
    }
    const user = rbac.user!;

    // 3. Parse query params
    const { searchParams } = new URL(request.url);
    const orgUnitId = searchParams.get('orgUnitId');
    const transactionId = searchParams.get('transactionId');
    const category = searchParams.get('category');

    // 4. Build where clause
    const where: Record<string, any> = {};

    // Org scope filtering
    if (orgUnitId) {
      const parsedOrgId = parseInt(orgUnitId, 10);
      if (!isNaN(parsedOrgId)) {
        // Check if user can access this org
        const { canAccessOrg } = await import('@/lib/rbac');
        const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, parsedOrgId);
        if (!canAccess) {
          return NextResponse.json(
            { error: 'Hauna ruhusa ya kuona data ya kitengo hiki.' },
            { status: 403 }
          );
        }
        where.orgUnitId = parsedOrgId;
      }
    } else {
      // Apply org scope from user permissions
      const orgScope = await buildOrgScopedWhere(user.orgUnitId, user.orgLevel);
      Object.assign(where, orgScope);
    }

    if (transactionId) {
      where.transactionId = parseInt(transactionId, 10);
    }

    if (category) {
      where.category = category;
    }

    // 5. Fetch attachments (without file data/path)
    const attachments = await db.attachment.findMany({
      where,
      select: {
        id: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        category: true,
        description: true,
        transactionId: true,
        orgUnitId: true,
        uploadedBy: true,
        createdAt: true,
        uploader: {
          select: { id: true, fullName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ attachments });
  } catch (error) {
    console.error('[Upload API] GET Error:', error);
    return NextResponse.json(
      { error: 'Hitilafu ya ndani ya seva. Tafadhali jaribu tena.' },
      { status: 500 }
    );
  }
}
