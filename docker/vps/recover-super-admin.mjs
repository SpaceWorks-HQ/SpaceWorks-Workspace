import { PrismaClient } from '@prisma/client';
import { recoverSuperAdmin } from './recover-super-admin-lib.mjs';
if(process.getuid?.()!==0) { console.error('Run this operator command as root.');process.exit(1); }
const prisma=new PrismaClient();
try {
  const url=await recoverSuperAdmin(prisma,process.argv[2]||process.env.SUPER_ADMIN_EMAIL,process.env.SUPER_ADMIN_EMAIL,process.env.NEXT_PUBLIC_BASE_URL);
  if(!url){console.error('The configured super-admin account does not exist. Complete first-run setup.');process.exitCode=1;}
  else { console.log('Authenticator and recovery codes removed; every session revoked.');console.log('Open this single-use link within one hour, then re-enrol MFA:');console.log(url); }
} catch { console.error('Recovery failed. Check the configured administrator and canonical HTTPS origin.');process.exitCode=1; }
finally { await prisma.$disconnect(); }
