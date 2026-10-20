// Verify every model table/column from the authoritative Prisma data model.
// Never emit connection details or query data.
import { Prisma, PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const columns = await prisma.$queryRaw`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`;
  const present = new Set(columns.map(c => `${c.table_name}.${c.column_name}`));
  const missing = Prisma.dmmf.datamodel.models.flatMap(model => model.fields.filter(f => f.kind !== 'object').filter(f => !present.has(`${model.dbName || model.name}.${f.dbName || f.name}`)).map(f => `${model.name}.${f.name}`));
  if (missing.length) throw new Error('Schema is incomplete. Apply pending migrations before starting the application.');
  const failed = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  if (failed[0].count) throw new Error('A migration did not finish. Resolve it before deploying.');
  console.log(`Production schema verified: ${Prisma.dmmf.datamodel.models.length} models.`);
} catch { console.error('Production schema verification failed. Check migrations from a trusted operator session.'); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
