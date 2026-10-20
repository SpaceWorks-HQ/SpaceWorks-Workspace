import { createHash, randomBytes } from 'node:crypto';
// Caller owns the operator privilege check. The configured administrator is
// resolved independently; a CLI email never selects an arbitrary member.
export async function recoverSuperAdmin(prisma, email, configuredEmail, baseOrigin) {
  const normalized=(email || '').trim().toLowerCase();
  if(!normalized || normalized !== (configuredEmail || '').trim().toLowerCase()) throw new Error('Only the configured super-admin account can be recovered.');
  const origin=new URL(baseOrigin);
  if(origin.origin!==baseOrigin || origin.protocol!=='https:') throw new Error('A canonical HTTPS origin is required.');
  const token=randomBytes(32).toString('hex');
  const found=await prisma.$transaction(async tx=>{
    const user=await tx.user.findUnique({where:{email:normalized},select:{id:true}});
    if(!user)return null;
    await tx.user.update({where:{id:user.id},data:{mfaSecretEncrypted:null,mfaEnabledAt:null,sessionVersion:{increment:1}}});
    await tx.mfaRecoveryCode.deleteMany({where:{userId:user.id}});
    await tx.session.deleteMany({where:{userId:user.id}});
    await tx.passwordResetToken.deleteMany({where:{userId:user.id,usedAt:null}});
    await tx.passwordResetToken.create({data:{userId:user.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+60*60*1000)}});
    await tx.auditEvent.create({data:{action:'operator.account_recovered',targetType:'User',targetId:user.id,metadata:{mfaReset:true,sessionsRevoked:true}}});
    return user;
  });
  return found ? `${origin.origin}/reset-password/${token}` : null;
}
