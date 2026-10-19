import "server-only";

import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import { prisma } from "@/lib/db";

const base = PrismaAdapter(prisma);

/**
 * Auth.js adapter. The instance is invite-only, so the adapter never creates
 * users (the sign-in callbacks refuse unknown emails); it only
 * links a verified external identity to an existing member.
 */
export const authAdapter: Adapter = {
  ...base,
  async createUser() {
    throw new Error("Accounts are created by invitation only.");
  },
  async getUserByEmail(email) {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, email: true, name: true, image: true, emailVerified: true },
    });
    return user ? { id: user.id, email: user.email, name: user.name, image: user.image, emailVerified: user.emailVerified } : null;
  },
  linkAccount(account) {
    // Sign-in providers are used only for identity. Do not retain reusable OAuth tokens.
    return base.linkAccount!({
      userId: account.userId,
      type: account.type,
      provider: account.provider,
      providerAccountId: account.providerAccountId,
    });
  },
};
