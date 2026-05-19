async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const cryptoModule = await import('crypto');
  const crypto = cryptoModule.default ?? cryptoModule;
  const nodeFetch = await import('node-fetch');
  const fetch = global.fetch || nodeFetch.default || nodeFetch;

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({ where: { role: 'admin', isActive: true } });
    if (!user) {
      console.error('No active admin user found in DB');
      process.exit(2);
    }

    // Ensure we have a branch (tawi) to test. Find or create one under the first markaz.
    let branch = await prisma.orgUnit.findFirst({ where: { type: 'tawi' } });
    if (!branch) {
      const markaz = await prisma.orgUnit.findFirst({ where: { type: 'markaz' } });
      const parentId = markaz ? markaz.id : null;
      branch = await prisma.orgUnit.create({ data: { name: 'Auto Test Tawi', type: 'tawi', parentId: parentId, code: 'TAWI-AUTO-1' } });
      console.log('Created test tawi:', branch.id);
      // add a couple of transactions so the report has data
      await prisma.transaction.createMany({ data: [
        { type: 'income', amount: 50000, date: new Date('2026-05-01'), month: 5, year: 2026, orgUnitId: branch.id },
        { type: 'expense', amount: 15000, date: new Date('2026-05-02'), month: 5, year: 2026, orgUnitId: branch.id },
      ]});
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      orgLevel: user.orgLevel,
      orgUnitId: user.orgUnitId || branch.id || 0,
      fullName: user.fullName || user.email,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };

    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'AMYC_SESSION_SECRET_2024_CHANGE_IN_PRODUCTION')
      .update(payloadB64)
      .digest('base64url');

    const token = `${payloadB64}.${signature}`;

    const url = `http://localhost:3000/api/reports/branch-unified?branchId=${branch.id}&year=2026&month=5`;
    console.log('Requesting', url, 'as user', user.email);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    console.log('HTTP', res.status, res.statusText);
    console.log(text);
  } catch (err) {
    console.error('Script error:', err);
    process.exit(1);
  } finally {
    try { await prisma.$disconnect(); } catch {};
  }
}

main();
