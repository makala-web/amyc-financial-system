import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/api-helpers';
import { enforceRbac, checkRateLimit } from '@/lib/rbac';

// GET /api/organizations/[id] - Get org unit by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // Auth + Permission check
    const rbac = await enforceRbac(request, { permission: 'view_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;
    const { id } = await params;
    const orgId = parseInt(id);

    if (isNaN(orgId)) {
      return NextResponse.json(
        { success: false, message: 'Kitambulisho cha shirika si halali' },
        { status: 400 }
      );
    }

    const orgUnit = await db.orgUnit.findUnique({
      where: { id: orgId },
      include: {
        parent: {
          select: { id: true, name: true, code: true, type: true, isActive: true },
        },
        _count: {
          select: {
            children: true,
            users: true,
            transactions: true,
            notes: true,
            submissions: true,
          },
        },
      },
    });

    if (!orgUnit) {
      return NextResponse.json(
        { success: false, message: 'Kikundi cha shirika hakipatikani' },
        { status: 404 }
      );
    }

    // Get active children count separately
    const activeChildrenCount = await db.orgUnit.count({
      where: { parentId: orgId, isActive: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...orgUnit,
        activeChildrenCount,
      },
    });
  } catch (error) {
    console.error('Get organization error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}

// PUT /api/organizations/[id] - Update org unit
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // Auth + Permission check
    const rbac = await enforceRbac(request, { permission: 'register_subunits' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;
    const { id } = await params;
    const orgId = parseInt(id);

    if (isNaN(orgId)) {
      return NextResponse.json(
        { success: false, message: 'Kitambulisho cha shirika si halali' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, code, isActive } = body;

    // Check if org unit exists
    const existingOrg = await db.orgUnit.findUnique({
      where: { id: orgId },
    });

    if (!existingOrg) {
      return NextResponse.json(
        { success: false, message: 'Kikundi cha shirika hakipatikani' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      if (!name.trim()) {
        return NextResponse.json(
          { success: false, message: 'Jina haliwezi kuwa tupu' },
          { status: 400 }
        );
      }
      updateData.name = name.trim();
    }

    if (code !== undefined) {
      if (!code.trim()) {
        return NextResponse.json(
          { success: false, message: 'Kodi haliwezi kuwa tupu' },
          { status: 400 }
        );
      }
      // Check for duplicate code (excluding current org)
      const duplicateCode = await db.orgUnit.findFirst({
        where: { code: code.trim() },
      });
      if (duplicateCode && duplicateCode.id !== orgId) {
        return NextResponse.json(
          { success: false, message: 'Kodi tayari inatumika' },
          { status: 409 }
        );
      }
      updateData.code = code.trim();
    }

    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }

    const updatedOrg = await db.orgUnit.update({
      where: { id: orgId },
      data: updateData,
      include: {
        parent: {
          select: { id: true, name: true, code: true, type: true },
        },
        _count: {
          select: {
            children: true,
            users: true,
            transactions: true,
          },
        },
      },
    });

    // Log org update
    const changedFields = Object.keys(updateData);
    await createAuditLog(request, {
      action: 'update',
      entity: 'orgUnit',
      entityId: orgId,
      details: `Kikundi cha shirika kimesasishwa: ${existingOrg.name} (${existingOrg.code}) - Sehemu zilizobadilishwa: ${changedFields.join(', ')}`,
    });

    return NextResponse.json({
      success: true,
      message: 'Kikundi cha shirika kimesasishwa kwa mafanikio',
      data: updatedOrg,
    });
  } catch (error) {
    console.error('Update organization error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}

// DELETE /api/organizations/[id] - Soft delete (deactivate) org unit
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // Auth + Permission check
    const rbac = await enforceRbac(request, { permission: 'register_subunits' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;
    const { id } = await params;
    const orgId = parseInt(id);

    if (isNaN(orgId)) {
      return NextResponse.json(
        { success: false, message: 'Kitambulisho cha shirika si halali' },
        { status: 400 }
      );
    }

    const orgUnit = await db.orgUnit.findUnique({
      where: { id: orgId },
      include: {
        _count: {
          select: {
            children: { where: { isActive: true } },
          },
        },
      },
    });

    if (!orgUnit) {
      return NextResponse.json(
        { success: false, message: 'Kikundi cha shirika hakipatikani' },
        { status: 404 }
      );
    }

    if (!orgUnit.isActive) {
      return NextResponse.json(
        { success: false, message: 'Kikundi tayari kimelemazwa' },
        { status: 400 }
      );
    }

    // Don't allow deactivation if there are active children
    if (orgUnit._count.children > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Huwezi kulemaza kikundi chenye vikundi vidogo ${orgUnit._count.children} vilivyo hai. Lemaza vikundi vidogo kwanza`,
        },
        { status: 400 }
      );
    }

    // Soft delete - set isActive to false
    await db.orgUnit.update({
      where: { id: orgId },
      data: { isActive: false },
    });

    // Log deactivation
    await createAuditLog(request, {
      action: 'deactivate',
      entity: 'orgUnit',
      entityId: orgId,
      details: `Kikundi cha shirika kimelemazwa: ${orgUnit.name} (${orgUnit.code})`,
    });

    return NextResponse.json({
      success: true,
      message: 'Kikundi cha shirika kimelemazwa kwa mafanikio',
    });
  } catch (error) {
    console.error('Deactivate organization error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}
