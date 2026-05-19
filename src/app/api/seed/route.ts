// ============================================================
// AMYC Financial Management System - Seed API Endpoint
// GET /api/seed - Triggers database seeding with default data
// ============================================================

import { NextResponse } from 'next/server';
import { seedDatabase } from '@/lib/seed';

export async function GET() {
  try {
    const result = await seedDatabase();

    if (result.success) {
      return NextResponse.json(result, { status: 200 });
    } else {
      return NextResponse.json(result, { status: 500 });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        message: `Seeding failed: ${errorMessage}`,
        details: {
          orgUnitsCreated: 0,
          usersCreated: 0,
          incomeCategoriesCreated: 0,
          expenseCategoriesCreated: 0,
          systemSettingsCreated: 0,
        },
      },
      { status: 500 }
    );
  }
}
