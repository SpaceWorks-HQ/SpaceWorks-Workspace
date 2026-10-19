import "server-only";

import NextAuth, { CredentialsSignin } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authAdapter } from "@/lib/authAdapter";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { prisma } from "@/lib/db";
import { hasVerifiedGoogleEmail } from "@/lib/googleAuth";
import { consumeMfaCode, consumeRecoveryCode, decryptMfaSecret } from "@/lib/mfa";
import { enabledOidcProviders, existingOidcMember } from "@/lib/shell/oidc";
import { getGoogleSsoSettings } from "@/lib/instanceSettings";

export const SESSION_COOKIE = "sww.session-token.v2";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  totp: z.string().trim().max(32).optional(),
});

/**
 * Returned only after the password is valid, so the sign-in screen can show
 * the second factor as its own step without revealing which emails use MFA.
 */
class MfaRequiredError extends CredentialsSignin {
  code = "mfa_required";
}

// Fixed, non-secret bcrypt hash: equal work for unknown and Google-only accounts.
const DUMMY_HASH = "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";

type TokenExtras = { authenticatedAt?: number; sessionVersion?: number; mfaPending?: boolean };
export type SsoMfaChallenge = { userId: string; sessionVersion: number; authenticatedAt: number };

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const [google, oidc] = await Promise.all([getGoogleSsoSettings().catch(() => null), enabledOidcProviders().catch(() => [])]);
  return {
    adapter: authAdapter,
    session: { strategy: "jwt" },
    // Versioned name: changing the payload or secret retires old cookies cleanly.
    cookies: { sessionToken: { name: SESSION_COOKIE } },
    trustHost: true,
    logger: {
      // Auth.js error causes can contain provider responses and credentials.
      error() { console.error("[auth] Authentication failed"); },
    },
    pages: { signIn: "/login", error: "/login" },
    providers: [
      ...oidc,
      Credentials({
        id: "sso-mfa",
        name: "SSO verification",
        credentials: { totp: { label: "Verification code", type: "text" } },
        async authorize(raw) {
          const session = await auth();
          const proof = (session as typeof session & { ssoMfa?: SsoMfaChallenge })?.ssoMfa;
          if (!proof || Date.now() - proof.authenticatedAt > 5 * 60_000) return null;
          if (await isActionRateLimited("auth", proof.userId)) return null;
          const user = await prisma.user.findUnique({ where: { id: proof.userId } });
          if (!user || user.disabledAt || user.sessionVersion !== proof.sessionVersion || !user.mfaEnabledAt || !user.mfaSecretEncrypted) return null;
          const code = z.string().trim().min(1).max(32).safeParse(raw.totp);
          if (!code.success) return null;
          const valid = await consumeMfaCode(decryptMfaSecret(user.mfaSecretEncrypted), user.email, code.data);
          if (!valid && !(await consumeRecoveryCode(user.id, code.data))) return null;
          return { id: user.id, name: user.name, email: user.email, image: user.image, sessionVersion: user.sessionVersion };
        },
      }),
      ...(google
        ? [
            Google({
              clientId: google.clientId,
              clientSecret: google.clientSecret,
              // Invited members who set a password may also use the same verified Google email.
              allowDangerousEmailAccountLinking: true,
            }),
          ]
        : []),
      Credentials({
        id: "credentials",
        name: "Email and password",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(raw) {
          const parsed = credentialsSchema.safeParse(raw);
          if (!parsed.success) return null;
          const { email, password } = parsed.data;
          if (await isActionRateLimited("auth", email)) return null;

          const user = await prisma.user.findUnique({
            where: { email },
            select: { id: true, name: true, email: true, image: true, passwordHash: true, sessionVersion: true, mfaSecretEncrypted: true, mfaEnabledAt: true, disabledAt: true },
          });
          const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
          if (!user?.passwordHash || !ok || user.disabledAt) return null;

          if (user.mfaEnabledAt && user.mfaSecretEncrypted) {
            const code = parsed.data.totp ?? "";
            if (!code) throw new MfaRequiredError();
            const validTotp = await consumeMfaCode(decryptMfaSecret(user.mfaSecretEncrypted), user.email, code);
            if (!validTotp && !(await consumeRecoveryCode(user.id, code))) return null;
          }

          return { id: user.id, name: user.name, email: user.email, image: user.image, sessionVersion: user.sessionVersion };
        },
      }),
    ],
    callbacks: {
      async signIn({ user, account, profile }) {
        if (account?.provider.startsWith("oidc-")) {
          const existing = await existingOidcMember(account.provider, profile);
          if (!existing) return false;
          const session = await auth();
          const currentId = session?.user?.id ?? (session as typeof session & { ssoMfa?: SsoMfaChallenge })?.ssoMfa?.userId;
          if (currentId && currentId !== existing.id) return false;
          user.email = existing.email;
          return true;
        }
        if (account?.provider !== "google") return true;
        if (!hasVerifiedGoogleEmail(profile)) return false;
        const email = user.email?.trim().toLowerCase();
        if (!email) return false;
        user.email = email;
        // Invite-only: Google can sign in an existing member, never create an account.
        const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, disabledAt: true } });
        if (!existing) return "/login?error=not_invited";
        if (existing.disabledAt) return "/login?error=disabled";
        return true;
      },
      async jwt({ token, user, account }) {
        const userId = user?.id ?? token.sub;
        if (!userId) return null;
        const current = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true, disabledAt: true, mfaEnabledAt: true } });
        if (!current || current.disabledAt) return null;
        const extras = token as typeof token & TokenExtras;
        if (user) {
          // Bind the session to the version checked with the password, so a
          // reset racing sign-in cannot mint a session from old proof.
          const verifiedVersion = (user as typeof user & { sessionVersion?: number }).sessionVersion;
          if (verifiedVersion !== undefined && verifiedVersion !== current.sessionVersion) return null;
          token.sub = user.id;
          extras.mfaPending = Boolean(current.mfaEnabledAt && account?.type !== "credentials");
          extras.authenticatedAt = Date.now();
          extras.sessionVersion = current.sessionVersion;
        } else if (extras.sessionVersion !== current.sessionVersion) {
          return null;
        }
        if (extras.mfaPending && Date.now() - (extras.authenticatedAt ?? 0) > 5 * 60_000) return null;
        return token;
      },
      session({ session, token }) {
        const extras = token as typeof token & TokenExtras;
        if (extras.mfaPending) {
          (session as typeof session & { ssoMfa?: SsoMfaChallenge }).ssoMfa = { userId: token.sub!, sessionVersion: extras.sessionVersion!, authenticatedAt: extras.authenticatedAt! };
          // A pending factor has no authenticated user for any page or API.
          session.user = undefined as unknown as typeof session.user;
          return session;
        }
        if (session.user && token.sub) session.user.id = token.sub;
        (session as typeof session & { authenticatedAt?: number }).authenticatedAt = (token as typeof token & TokenExtras).authenticatedAt;
        return session;
      },
    },
    events: {
      async signIn({ user, account }) {
        if (account?.provider === "google" && user.id) {
          await prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
        }
      },
    },
  };
});
