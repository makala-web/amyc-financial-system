import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/organizations/[id]/children - Get all child org units of a parent
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orgId = parseInt(id);

    if (isNaN(orgId)) {
      return NextResponse.json(
        { success: false, message: 'Kitambulisho cha shirika si halali' },
        { status: 400 }
      );
    }

    // Check if parent exists
    const parent = await db.orgUnit.findUnique({
      where: { id: orgId },
    });

    if (!parent) {
      return NextResponse.json(
        { success: false, message: 'Kikundi cha mzazi hakipatikani' },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const isActive = searchParams.get('isActive');

    const where: Record<string, unknown> = { parentId: orgId };
    if (isActive !== null && isActive !== undefined && isActive !== '') {
      where.isActive = isActive === 'true';
    }

    const children = await db.orgUnit.findMany({
      where,
      include: {
        _count: {
          select: {
            children: true,
            users: true,
            transactions: true,
          },
        },
      },
      orderBy: { code: 'asc' },
    });

    // Get submission status for current month for each child
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const childrenWithSubmissions = await Promise.all(
      children.map(async (child) => {
        const submission = await db.monthlySubmission.findUnique({
          where: {
            orgUnitId_month_year: {
              orgUnitId: child.id,
              month: currentMonth,
              year: currentYear,
            },
          },
        });

        return {
          ...child,
          currentMonthSubmission: submission
            ? {
                isSubmitted: submission.isSubmitted,
                submittedAt: submission.submittedAt,
                totalIncome: submission.totalIncome,
                totalExpense: submission.totalExpense,
                netBalance: submission.netBalance,
              }
            : null,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: childrenWithSubmissions,
      meta: {
        parentId: orgId,
        parentName: parent.name,
        parentCode: parent.code,
        parentType: parent.type,
        totalChildren: children.length,
        activeChildren: children.filter((c) => c.isActive).length,
        currentMonth,
        currentYear,
      },
    });
  } catch (error) {
    console.error('Get children error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}
