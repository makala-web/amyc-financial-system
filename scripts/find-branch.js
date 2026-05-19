async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const p = new PrismaClient();
  try {
    const list = await p.orgUnit.findMany({ take: 20, orderBy: { id: 'asc' } });
    console.log(JSON.stringify(list, null, 2));
  } catch (err) {
    console.error('err', err);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}

main();
