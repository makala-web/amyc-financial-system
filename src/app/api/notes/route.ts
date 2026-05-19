import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, checkRateLimit, buildOrgScopedWhere, canAccessOrg } from '@/lib/rbac';
import { createNoteSchema } from '@/lib/validations';
import { createAuditLog } from '@/lib/api-helpers';

// GET /api/notes - List notes with filters
export async function GET(request: NextRequest) {
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
    const { searchParams } = new URL(request.url);

    const orgUnitId = searchParams.get('orgUnitId');
    const type = searchParams.get('type');
    const priority = searchParams.get('priority');
    const createdBy = searchParams.get('createdBy');
    const isPinned = searchParams.get('isPinned');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: any = {};

    // Apply org scope - users can only see notes for their own org or child orgs
    if (orgUnitId) {
      const targetOrgId = parseInt(orgUnitId);
      const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, targetOrgId);
      if (!canAccess) {
        return NextResponse.json({ error: 'Hauna ruhusa ya kuona maoni ya kitengo hiki.' }, { status: 403 });
      }
      where.orgUnitId = targetOrgId;
    } else if (user.role !== 'admin') {
      const orgScope = await buildOrgScopedWhere(user.orgUnitId, user.orgLevel);
      where.orgUnitId = orgScope.orgUnitId || (orgScope.orgUnitId as any)?.in;
    }

    if (type) where.type = type;
    if (priority) where.priority = priority;
    if (createdBy) where.createdBy = parseInt(createdBy);
    if (isPinned !== null && isPinned !== undefined && isPinned !== '') {
      where.isPinned = isPinned === 'true';
    }
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { content: { contains: search } },
      ];
    }

    const [notes, total] = await Promise.all([
      db.note.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          orgUnit: {
            select: { id: true, name: true, type: true },
          },
          author: {
            select: { id: true, fullName: true, email: true },
          },
        },
      }),
      db.note.count({ where }),
    ]);

    return NextResponse.json({
      data: notes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error listing notes:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kupata maoni' },
      { status: 500 }
    );
  }
}

// POST /api/notes - Create note
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
    const parseResult = createNoteSchema.safeParse(body);
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

    // 4. Validate org ownership - user can only create notes for their own org or child orgs
    const canAccess = await canAccessOrg(user.orgUnitId, user.orgLevel, data.orgUnitId);
    if (!canAccess) {
      return NextResponse.json(
        { error: 'Hauna ruhusa ya kuunda maoni kwenye kitengo hiki.' },
        { status: 403 }
      );
    }

    const note = await db.note.create({
      data: {
        title: data.title,
        content: data.content,
        type: data.type,
        priority: data.priority,
        orgUnitId: data.orgUnitId,
        createdBy: user.userId,
        isPinned: false,
      },
    });

    // 5. Audit log
    await createAuditLog(request, {
      action: 'create',
      entity: 'note',
      entityId: note.id,
      details: `Maoni jipya: ${data.title} (${data.type})`,
      newValue: JSON.stringify(note),
    });

    return NextResponse.json({ data: note }, { status: 201 });
  } catch (error) {
    console.error('Error creating note:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kuunda maoni' },
      { status: 500 }
    );
  }
}
