import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, checkRateLimit, buildOrgScopedWhere } from '@/lib/rbac';

// GET /api/audit - List audit logs with filters (paginated)
// Only mkaguzi and admin can view audit logs
export async function GET(request: NextRequest) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth + Permission check: must have view_audit permission
    // Only mkaguzi and admin roles have view_audit permission
    const rbac = await enforceRbac(request, { permission: 'view_audit' });
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;
    const { searchParams } = new URL(request.url);

    const action = searchParams.get('action');
    const entity = searchParams.get('entity');
    const userIdFilter = searchParams.get('userId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const entityId = searchParams.get('entityId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: any = {};

    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (userIdFilter) where.userId = parseInt(userIdFilter);
    if (entityId) where.entityId = parseInt(entityId);
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    // Non-admin users can only see audit logs for their org scope
    if (user.role !== 'admin') {
      // Mkaguzi can see all audit logs within their org scope
      // But we limit by users who belong to their org or child orgs
      const orgScope = await buildOrgScopedWhere(user.orgUnitId, user.orgLevel, 'orgUnitId');
      const scopedUserIds = await db.user.findMany({
        where: { orgUnitId: orgScope.orgUnitId || (orgScope.orgUnitId as any)?.in },
        select: { id: true },
      });
      if (scopedUserIds.length > 0) {
        where.userId = { in: scopedUserIds.map(u => u.id) };
      } else {
        where.userId = -1; // No results
      }
    }

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: { id: true, fullName: true, email: true, role: true },
          },
        },
      }),
      db.auditLog.count({ where }),
    ]);

    // Get distinct actions and entities for filter options
    const [distinctActions, distinctEntities] = await Promise.all([
      db.auditLog.findMany({
        select: { action: true },
        distinct: ['action'],
        orderBy: { action: 'asc' },
      }),
      db.auditLog.findMany({
        select: { entity: true },
        distinct: ['entity'],
        orderBy: { entity: 'asc' },
      }),
    ]);

    return NextResponse.json({
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      filters: {
        actions: distinctActions.map((a) => a.action),
        entities: distinctEntities.map((e) => e.entity),
      },
    });
  } catch (error) {
    console.error('Error listing audit logs:', error);
    return NextResponse.json(
      { error: 'Imeshindwa kupata kumbukumbu za ukaguzi' },
      { status: 500 }
    );
  }
}
