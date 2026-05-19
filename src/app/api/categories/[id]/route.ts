import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, checkRateLimit } from '@/lib/rbac';

// GET /api/categories/[id] - Get category by ID
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limit
    const rateLimit = checkRateLimit(_request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // Auth + Permission check
    const rbac = await enforceRbac(_request, { permission: 'view_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;
    const { id } = await params;
    const category = await db.category.findUnique({
      where: { id: parseInt(id) },
      include: {
        orgUnit: true,
        _count: {
          select: { transactions: true },
        },
      },
    });

    if (!category) {
      return NextResponse.json(
        { error: 'Kundi halipatikani' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: category });
  } catch (error) {
    console.error('Error getting category:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kupata kundi' },
      { status: 500 }
    );
  }
}

// PUT /api/categories/[id] - Update category
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
    const rbac = await enforceRbac(request, { permission: 'access_admin' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;
    const { id } = await params;
    const categoryId = parseInt(id);
    const body = await request.json();

    const existing = await db.category.findUnique({
      where: { id: categoryId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Kundi halipatikani' },
        { status: 404 }
      );
    }

    const updateData: any = {};

    if (body.name !== undefined) updateData.name = body.name;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.orgLevel !== undefined) updateData.orgLevel = body.orgLevel;
    if (body.orgUnitId !== undefined) updateData.orgUnitId = body.orgUnitId ? parseInt(body.orgUnitId) : null;
    if (body.isDefault !== undefined) updateData.isDefault = body.isDefault;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.sortOrder !== undefined) updateData.sortOrder = parseInt(body.sortOrder);

    const updated = await db.category.update({
      where: { id: categoryId },
      data: updateData,
    });

    // If category name changed, update denormalized categoryName in transactions
    if (body.name && body.name !== existing.name) {
      await db.transaction.updateMany({
        where: { categoryId: categoryId },
        data: { categoryName: body.name },
      });
    }

    // Log to audit
    if (body.userId) {
      await db.auditLog.create({
        data: {
          action: 'update',
          entity: 'category',
          entityId: categoryId,
          userId: parseInt(body.userId),
          details: `Kundi #${categoryId} limehaririwa`,
        },
      });
    }

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('Error updating category:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kuhariri kundi' },
      { status: 500 }
    );
  }
}

// DELETE /api/categories/[id] - Deactivate category (soft delete)
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
    const rbac = await enforceRbac(request, { permission: 'access_admin' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;
    const { id } = await params;
    const categoryId = parseInt(id);

    const existing = await db.category.findUnique({
      where: { id: categoryId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Kundi halipatikani' },
        { status: 404 }
      );
    }

    // Soft delete - deactivate instead of deleting
    const updated = await db.category.update({
      where: { id: categoryId },
      data: { isActive: false },
    });

    // Log to audit
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (userId) {
      await db.auditLog.create({
        data: {
          action: 'delete',
          entity: 'category',
          entityId: categoryId,
          userId: parseInt(userId),
          details: `Kundi #${categoryId} limelemavwa: ${existing.name}`,
        },
      });
    }

    return NextResponse.json({ data: updated, message: 'Kundi limelemavwa kikamilifu' });
  } catch (error) {
    console.error('Error deactivating category:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kulemavua kundi' },
      { status: 500 }
    );
  }
}
