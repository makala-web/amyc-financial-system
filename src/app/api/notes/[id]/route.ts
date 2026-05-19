import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, checkRateLimit, canAccessOrg } from '@/lib/rbac';
import { createAuditLog } from '@/lib/api-helpers';

// GET /api/notes/[id] - Get note by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth + Permission check
    const rbac = await enforceRbac(request, { permission: 'view_data' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;
    const { id } = await params;
    const note = await db.note.findUnique({
      where: { id: parseInt(id) },
      include: {
        orgUnit: {
          select: { id: true, name: true, type: true },
        },
        author: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    if (!note) {
      return NextResponse.json(
        { error: 'Maoni hayapatikani' },
        { status: 404 }
      );
    }

    // 3. Check org access
    if (note.orgUnitId == null) {
      if (user.role !== 'admin') {
        return NextResponse.json({ error: 'Hauna ruhusa ya kuona maoni haya.' }, { status: 403 });
      }
    } else {
      const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, note.orgUnitId);
      if (!canAccess) {
        return NextResponse.json(
          { error: 'Hauna ruhusa ya kuona maoni haya.' },
          { status: 403 }
        );
      }
    }

    return NextResponse.json({ data: note });
  } catch (error) {
    console.error('Error getting note:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kupata maoni' },
      { status: 500 }
    );
  }
}

// PUT /api/notes/[id] - Update note
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;
    const noteId = parseInt(id);
    const body = await request.json();

    const existing = await db.note.findUnique({
      where: { id: noteId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Maoni hayapatikani' },
        { status: 404 }
      );
    }

    // 3. Check org access
    if (existing.orgUnitId == null) {
      if (user.role !== 'admin') {
        return NextResponse.json({ error: 'Hauna ruhusa ya kuhariri maoni haya.' }, { status: 403 });
      }
    } else {
      const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, existing.orgUnitId);
      if (!canAccess) {
        return NextResponse.json(
          { error: 'Hauna ruhusa ya kuhariri maoni haya.' },
          { status: 403 }
        );
      }
    }

    // Only the author or admin can edit
    if (existing.createdBy !== user.userId && user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Huwezi kuhariri maoni ambayo hayako yako.' },
        { status: 403 }
      );
    }

    const updateData: any = {};

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length < 2) {
        return NextResponse.json({ error: 'Kichwa cha habari si sahihi' }, { status: 400 });
      }
      updateData.title = body.title.trim();
    }
    if (body.content !== undefined) {
      if (typeof body.content !== 'string' || body.content.trim().length < 1) {
        return NextResponse.json({ error: 'Maudhui ni lazima' }, { status: 400 });
      }
      updateData.content = body.content.trim();
    }
    if (body.type !== undefined) {
      const validTypes = ['meeting', 'decision', 'reminder', 'memo', 'general'];
      if (!validTypes.includes(body.type)) {
        return NextResponse.json({ error: 'Aina si sahihi' }, { status: 400 });
      }
      updateData.type = body.type;
    }
    if (body.priority !== undefined) {
      const validPriorities = ['low', 'normal', 'high', 'urgent'];
      if (!validPriorities.includes(body.priority)) {
        return NextResponse.json({ error: 'Kipaumbele si sahihi' }, { status: 400 });
      }
      updateData.priority = body.priority;
    }
    if (body.isPinned !== undefined) {
      updateData.isPinned = Boolean(body.isPinned);
    }

    const updated = await db.note.update({
      where: { id: noteId },
      data: updateData,
    });

    // Audit log
    await createAuditLog(request, {
      action: 'update',
      entity: 'note',
      entityId: noteId,
      details: `Maoni #${noteId} yamehaririwa`,
      oldValue: JSON.stringify({ id: existing.id, title: existing.title }),
      newValue: JSON.stringify({ id: updated.id, title: updated.title }),
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('Error updating note:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kuhariri maoni' },
      { status: 500 }
    );
  }
}

// DELETE /api/notes/[id] - Delete note
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;
    const noteId = parseInt(id);

    const existing = await db.note.findUnique({
      where: { id: noteId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Maoni hayapatikani' },
        { status: 404 }
      );
    }

    // 3. Only the author or admin can delete
    if (existing.createdBy !== user.userId && user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Huwezi kufuta maoni ambayo hayako yako.' },
        { status: 403 }
      );
    }

    await db.note.delete({
      where: { id: noteId },
    });

    // Audit log
    await createAuditLog(request, {
      action: 'delete',
      entity: 'note',
      entityId: noteId,
      details: `Maoni #${noteId} yamefutwa: ${existing.title}`,
      oldValue: JSON.stringify({ id: existing.id, title: existing.title, type: existing.type }),
    });

    return NextResponse.json({ message: 'Maoni yamefutwa kikamilifu' });
  } catch (error) {
    console.error('Error deleting note:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kufuta maoni' },
      { status: 500 }
    );
  }
}
