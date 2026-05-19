async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const p = new PrismaClient();
  try {
    const recs = await p.regionalReport.findMany({ where: { month: 5, year: 2026 } });
    console.log(JSON.stringify(recs, null, 2));
  } catch (err) {
    console.error('err', err);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}

main();
