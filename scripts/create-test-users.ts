// ============================================================
// Create Test Users for All Org Levels
// ============================================================

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth/server';

async function createTestUsers() {
  try {
    console.log('🔍 Checking existing users...');
    const existingUsers = await db.user.findMany();
    console.log(`Found ${existingUsers.length} existing users`);

    // Get org units
    const markaz = await db.orgUnit.findFirst({
      where: { type: 'markaz' },
    });
    const jimbo = await db.orgUnit.findFirst({
      where: { type: 'jimbo' },
    });
    const tawi = await db.orgUnit.findFirst({
      where: { type: 'tawi' },
    });

    if (!markaz) {
      console.error('❌ No Markaz (headquarters) found!');
      return;
    }

    console.log(`\n📦 Found:
    - Markaz: ${markaz.name} (ID: ${markaz.id})
    - Jimbo: ${jimbo?.name || 'N/A'} (ID: ${jimbo?.id || 'N/A'})
    - Tawi: ${tawi?.name || 'N/A'} (ID: ${tawi?.id || 'N/A'})`);

    // Test users to create
    const testUsers = [
      {
        username: 'jimbo_user',
        email: 'jimbo@amyc.org',
        password: 'Jimbo@123',
        fullName: 'Mjumbe wa Jimbo',
        role: 'regional_manager',
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
        role: 'branch_manager',
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
        role: 'accountant',
        orgLevel: 'markaz',
        orgUnitId: markaz.id,
        securityQuestion: 'Nchi ya kwanza ulizotembelea?',
        securityAnswer: 'kenya',
      },
    ];

    console.log('\n👤 Creating test users...');
    for (const testUser of testUsers) {
      const existing = await db.user.findFirst({
        where: { OR: [{ email: testUser.email }, { username: testUser.username }] },
      });

      if (existing) {
        console.log(`⏭️  Skipping ${testUser.email} (already exists)`);
        continue;
      }

      const passwordHash = hashPassword(testUser.password);
      const securityAnswerHash = hashPassword(testUser.securityAnswer);

      const newUser = await db.user.create({
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

      console.log(`✅ Created: ${testUser.email} (${testUser.password})`);
    }

    // List all users
    console.log('\n📋 All users in database:');
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

    allUsers.forEach(user => {
      console.log(
        `  - ${user.email} (${user.role}/${user.orgLevel}) - Active: ${user.isActive}`
      );
    });

    console.log('\n✨ Test users created successfully!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

createTestUsers();
