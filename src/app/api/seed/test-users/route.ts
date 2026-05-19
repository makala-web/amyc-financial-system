// ============================================================
// API Endpoint: Create Test Users
// GET /api/seed/test-users
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth/server';

export async function GET(_request: NextRequest) {
  try {
    console.log('Creating test users...');

    const markaz = await db.orgUnit.findFirst({ where: { type: 'markaz' } });
    const jimbo = await db.orgUnit.findFirst({ where: { type: 'jimbo' } });
    const tawi = await db.orgUnit.findFirst({ where: { type: 'tawi' } });

    if (!markaz) {
      return NextResponse.json({ error: 'No Markaz (headquarters) found!' }, { status: 404 });
    }

    const testUsers: Array<{
      username: string;
      email: string;
      password: string;
      fullName: string;
      role: string;
      orgLevel: string;
      orgUnitId: number;
      securityQuestion: string;
      securityAnswer: string;
    }> = [
      {
        username: 'jimbo_user',
        email: 'jimbo@amyc.org',
        password: 'Jimbo@123',
        fullName: 'Mjumbe wa Jimbo',
        role: 'mudir',
        orgLevel: 'jimbo',
        orgUnitId: jimbo?.id || markaz.id,
        securityQuestion: 'Jina la mama yako ni nani?',
        securityAnswer: 'mama',
      },
      {
        username: 'tawi_user',
        email: 'tawi@amyc.org',
        password: 'Tawi@123',
        fullName: 'Mjumbe wa Tawi',
        role: 'mweka_hazina',
        orgLevel: 'tawi',
        orgUnitId: tawi?.id || markaz.id,
        securityQuestion: 'Jina la papa yako ni nani?',
        securityAnswer: 'papa',
      },
      {
        username: 'accountant',
        email: 'accountant@amyc.org',
        password: 'Account@123',
        fullName: 'Mhasibu',
        role: 'muhasibu',
        orgLevel: 'markaz',
        orgUnitId: markaz.id,
        securityQuestion: 'Nchi ya kwanza ulizotembelea?',
        securityAnswer: 'kenya',
      },
    ];

    const createdUsers: Array<{
      email: string;
      password: string;
      role: string;
      orgLevel: string;
    }> = [];

    for (const testUser of testUsers) {
      const existing = await db.user.findFirst({
        where: { OR: [{ email: testUser.email }, { username: testUser.username }] },
      });

      if (existing) {
        console.log(`Skipping ${testUser.email} (already exists)`);
        continue;
      }

      const passwordHash = hashPassword(testUser.password);
      const securityAnswerHash = hashPassword(testUser.securityAnswer);

      await db.user.create({
        data: {
          username: testUser.username,
          email: testUser.email,
          passwordHash,
          fullName: testUser.fullName,
          role: testUser.role,
          orgLevel: testUser.orgLevel,
          orgUnitId: testUser.orgUnitId,
          securityQuestion: testUser.securityQuestion,
          securityAnswerHash,
          isActive: true,
        },
      });

      createdUsers.push({
        email: testUser.email,
        password: testUser.password,
        role: testUser.role,
        orgLevel: testUser.orgLevel,
      });
    }

    const allUsers = await db.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        orgLevel: true,
        isActive: true,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Test users created successfully',
        created: createdUsers,
        allUsers,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
