import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

interface OrgNode {
  id: number;
  name: string;
  code: string;
  type: string;
  parentId: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  children: OrgNode[];
  _count: {
    users: number;
    transactions: number;
  };
}

async function buildHierarchy(parentId: number): Promise<OrgNode[]> {
  const children = await db.orgUnit.findMany({
    where: { parentId },
    orderBy: { code: 'asc' },
    include: {
      _count: {
        select: {
          users: true,
          transactions: true,
        },
      },
    },
  });

  const nodes: OrgNode[] = [];
  for (const child of children) {
    const childChildren = await buildHierarchy(child.id);
    nodes.push({
      id: child.id,
      name: child.name,
      code: child.code,
      type: child.type,
      parentId: child.parentId,
      isActive: child.isActive,
      createdAt: child.createdAt,
      updatedAt: child.updatedAt,
      children: childChildren,
      _count: {
        users: child._count.users,
        transactions: child._count.transactions,
      },
    });
  }
  return nodes;
}

// GET /api/organizations/[id]/hierarchy - Get full hierarchy tree starting from this org
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

    // Get the root org
    const rootOrg = await db.orgUnit.findUnique({
      where: { id: orgId },
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

    if (!rootOrg) {
      return NextResponse.json(
        { success: false, message: 'Kikundi cha shirika hakipatikani' },
        { status: 404 }
      );
    }

    // Build the hierarchy tree recursively
    const children = await buildHierarchy(orgId);

    const hierarchy: OrgNode & { parent?: { id: number; name: string; code: string; type: string } } = {
      id: rootOrg.id,
      name: rootOrg.name,
      code: rootOrg.code,
      type: rootOrg.type,
      parentId: rootOrg.parentId,
      isActive: rootOrg.isActive,
      createdAt: rootOrg.createdAt,
      updatedAt: rootOrg.updatedAt,
      children,
      _count: {
        users: rootOrg._count.users,
        transactions: rootOrg._count.transactions,
      },
    };

    // Add parent info if exists
    if (rootOrg.parent) {
      hierarchy.parent = rootOrg.parent;
    }

    // Calculate total descendants count
    function countDescendants(node: OrgNode): number {
      let count = node.children.length;
      for (const child of node.children) {
        count += countDescendants(child);
      }
      return count;
    }

    const totalDescendants = countDescendants(hierarchy);

    return NextResponse.json({
      success: true,
      data: hierarchy,
      meta: {
        totalDescendants,
        totalActiveDescendants: countActiveDescendants(hierarchy),
        depth: getTreeDepth(hierarchy),
      },
    });
  } catch (error) {
    console.error('Get hierarchy error:', error);
    return NextResponse.json(
      { success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye' },
      { status: 500 }
    );
  }
}

function countActiveDescendants(node: OrgNode): number {
  let count = node.children.filter((c) => c.isActive).length;
  for (const child of node.children) {
    count += countActiveDescendants(child);
  }
  return count;
}

function getTreeDepth(node: OrgNode): number {
  if (node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map(getTreeDepth));
}
