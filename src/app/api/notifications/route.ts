import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRbac, checkRateLimit } from '@/lib/rbac';
import { createAuditLog } from '@/lib/api-helpers';

// GET /api/notifications - Get notifications for the current user only
export async function GET(request: NextRequest) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth check - users can only see their own notifications
    const rbac = await enforceRbac(request, {});
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    const { searchParams } = new URL(request.url);
    const isRead = searchParams.get('isRead');
    const type = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') || '50');
    const page = parseInt(searchParams.get('page') || '1');

    // Users can ONLY see their own notifications - enforced by userId filter
    const where: any = { userId: user.userId };

    if (isRead !== null && isRead !== undefined && isRead !== '') {
      where.isRead = isRead === 'true';
    }
    if (type) where.type = type;

    const [notifications, total, unreadCount] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.notification.count({ where }),
      db.notification.count({
        where: { userId: user.userId, isRead: false },
      }),
    ]);

    return NextResponse.json({
      data: notifications,
      unreadCount,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error getting notifications:', error);
    return NextResponse.json({ error: 'Imeshindwa kupata arifa' }, { status: 500 });
  }
}

// PUT /api/notifications - Mark notifications as read (own notifications only)
export async function PUT(request: NextRequest) {
  try {
    // 1. Rate limit
    const rateLimit = checkRateLimit(request);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    // 2. Auth check
    const rbac = await enforceRbac(request, {});
    if (!rbac.allowed) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.statusCode });
    }
    const user = rbac.user!;

    const body = await request.json();

    if (body.markAllRead) {
      // Mark all of user's own notifications as read
      const result = await db.notification.updateMany({
        where: { userId: user.userId, isRead: false },
        data: { isRead: true, readAt: new Date() },
      });
      return NextResponse.json({ data: { markedAll: true, count: result.count } });
    }

    if (body.notificationId) {
      const notificationId = parseInt(body.notificationId);
      if (isNaN(notificationId)) {
        return NextResponse.json({ error: 'Kitambulisho cha arifa si halali' }, { status: 400 });
      }

      // Verify the notification belongs to this user
      const notification = await db.notification.findUnique({
        where: { id: notificationId },
      });

      if (!notification) {
        return NextResponse.json({ error: 'Arifa hapatikani' }, { status: 404 });
      }

      if (notification.userId !== user.userId) {
        return NextResponse.json(
          { error: 'Huwezi kubadilisha arifa ambayo si yako.' },
          { status: 403 }
        );
      }

      await db.notification.update({
        where: { id: notificationId },
        data: { isRead: true, readAt: new Date() },
      });
      return NextResponse.json({ data: { marked: notificationId } });
    }

    return NextResponse.json({ error: 'Taarifa hazijawasilishwa' }, { status: 400 });
  } catch (error) {
    console.error('Error updating notifications:', error);
    return NextResponse.json({ error: 'Imeshindwa kubadilisha arifa' }, { status: 500 });
  }
}
