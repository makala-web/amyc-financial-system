// ============================================================
// AMYC Financial Management System - File Download/Delete API
// GET: Download a specific file by attachment ID
// DELETE: Delete an attachment (file + database record)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { db } from '@/lib/db';
import { enforceRbac, checkRateLimit, canAccessOrg } from '@/lib/rbac';
import { createAuditLog } from '@/lib/api-helpers';

// ============================================================
// GET: Download file
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // 3. Parse and validate ID
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Kitambulisho cha faili si sahihi.' },
        { status: 400 }
      );
    }

    // 4. Look up attachment record
    const attachment = await db.attachment.findUnique({
      where: { id },
      include: {
        orgUnit: { select: { id: true } },
      },
    });

    if (!attachment) {
      return NextResponse.json(
        { error: 'Faili haijapatikana.' },
        { status: 404 }
      );
    }

    // 5. Org scope check
    if (attachment.orgUnitId) {
      const canAccess = await canAccessOrg(
        user.orgUnitId,
        user.orgLevel,
        attachment.orgUnitId
      );
      if (!canAccess) {
        return NextResponse.json(
          { error: 'Hauna ruhusa ya kuona faili hii.' },
          { status: 403 }
        );
      }
    }

    // 6. Check if file exists on disk
    if (!attachment.filePath || !existsSync(attachment.filePath)) {
      return NextResponse.json(
        { error: 'Faili haipo kwenye seva. Inawezekana ilifutwa.' },
        { status: 404 }
      );
    }

    // 7. Read file from disk
    const fileBuffer = await readFile(attachment.filePath);
    const contentType = attachment.fileType ?? 'application/octet-stream';
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
      'Cache-Control': 'private, max-age=3600',
    };

    if (attachment.fileSize !== null) {
      headers['Content-Length'] = String(attachment.fileSize);
    }

    // 8. Return file with proper headers
    const response = new NextResponse(fileBuffer, {
      status: 200,
      headers,
    });

    return response;
  } catch (error) {
    console.error('[Download API] Error:', error);
    return NextResponse.json(
      { error: 'Hitilafu ya ndani ya seva. Tafadhali jaribu tena.' },
      { status: 500 }
    );
  }
}

// ============================================================
// DELETE: Delete attachment
// ============================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Rate limiting
    const rateLimit = checkRateLimit(request, 30);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Maombi mengi mno. Tafadhali subiri kidogo.' },
        { status: 429 }
      );
    }

    // 2. Authentication & RBAC (need delete_data or be admin)
    const rbac = await enforceRbac(request, {
      permissions: ['delete_data', 'access_admin'],
    });
    if (!rbac.allowed) {
      return NextResponse.json(
        { error: rbac.error },
        { status: rbac.statusCode }
      );
    }
    const user = rbac.user!;

    // 3. Parse and validate ID
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Kitambulisho cha faili si sahihi.' },
        { status: 400 }
      );
    }

    // 4. Look up attachment record
    const attachment = await db.attachment.findUnique({
      where: { id },
    });

    if (!attachment) {
      return NextResponse.json(
        { error: 'Faili haijapatikana.' },
        { status: 404 }
      );
    }

    // 5. Org scope check
    if (attachment.orgUnitId) {
      const canAccess = await canAccessOrg(
        user.orgUnitId,
        user.orgLevel,
        attachment.orgUnitId
      );
      if (!canAccess) {
        return NextResponse.json(
          { error: 'Hauna ruhusa ya kufuta faili hii.' },
          { status: 403 }
        );
      }
    }

    // 6. Delete file from disk
    if (attachment.filePath && existsSync(attachment.filePath)) {
      try {
        await unlink(attachment.filePath);
      } catch (err) {
        console.error('[Delete API] Failed to delete file from disk:', err);
        // Continue to delete DB record even if file deletion fails
      }
    }

    // 7. Delete database record
    await db.attachment.delete({
      where: { id },
    });

    // 8. Audit log
    await createAuditLog(request, {
      action: 'delete',
      entity: 'attachment',
      entityId: id,
      details: `Faili ilifutwa: ${attachment.fileName} (${attachment.category}, ${attachment.fileSize} bytes)`,
      oldValue: JSON.stringify({
        id: attachment.id,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        fileSize: attachment.fileSize,
        category: attachment.category,
        orgUnitId: attachment.orgUnitId,
        transactionId: attachment.transactionId,
      }),
    });

    return NextResponse.json({
      message: 'Faili imefutwa kikamilifu',
      deletedId: id,
    });
  } catch (error) {
    console.error('[Delete API] Error:', error);
    return NextResponse.json(
      { error: 'Hitilafu ya ndani ya seva. Tafadhali jaribu tena.' },
      { status: 500 }
    );
  }
}
