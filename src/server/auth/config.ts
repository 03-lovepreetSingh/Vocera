/**
 * Auth.js (NextAuth v5) configuration.
 *
 * Sessions are stateless JWTs — fast and cheap. Workspace resolution lives in the
 * `session` callback: we look up the user's primary membership once on token mint
 * and stash workspace_id in the JWT so request paths don't pay a DB round-trip.
 */
import { verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { z } from 'zod';
import { db } from '@/db/client';
import { memberships, users, workspaces } from '@/db/schema';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string; // user external id (usr_...)
      userIdNum: number;
      workspaceId: number;
      workspaceExternalId: string;
      role: 'admin' | 'member' | 'viewer';
    };
  }
  interface JWT {
    userIdNum?: number;
    userExternalId?: string;
    workspaceId?: number;
    workspaceExternalId?: string;
    role?: 'admin' | 'member' | 'viewer';
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 }, // 30d, rolling
  trustHost: true,
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = (
          await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1)
        )[0];
        if (!user?.passwordHash) return null;

        const ok = await verify(user.passwordHash, password);
        if (!ok) return null;

        return {
          id: user.externalId,
          name: user.name ?? user.email,
          email: user.email,
          image: user.image ?? undefined,
        };
      },
    }),
    // Google is conditionally enabled — if env vars are missing, the provider is
    // simply not registered, and the login UI hides the button.
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // For Google sign-ins, ensure a user row exists. Credentials sign-ups are
      // handled by the signup server action which creates everything in one tx.
      if (account?.provider === 'google' && profile?.email) {
        const email = profile.email.toLowerCase();
        const existing = (
          await db.select().from(users).where(eq(users.email, email)).limit(1)
        )[0];
        if (!existing) {
          // Lazy provisioning: create user + workspace + membership.
          const { provisionUser } = await import('./provision');
          await provisionUser({
            email,
            name: profile.name ?? null,
            image: (profile as { picture?: string }).picture ?? null,
          });
        }
        user.id = email; // overwritten below by jwt callback
      }
      return true;
    },

    async jwt({ token, user }) {
      // First-call hydration: enrich token with workspace_id + role.
      const t = token as Record<string, unknown>;
      if (user || !t.userIdNum) {
        const email = (user?.email ?? token.email)?.toLowerCase();
        if (!email) return token;

        const row = (
          await db
            .select({
              userId: users.id,
              userExt: users.externalId,
              wsId: workspaces.id,
              wsExt: workspaces.externalId,
              role: memberships.role,
            })
            .from(users)
            .innerJoin(memberships, eq(memberships.userId, users.id))
            .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
            .where(eq(users.email, email))
            .limit(1)
        )[0];
        if (row) {
          t.userIdNum = row.userId;
          t.userExternalId = row.userExt;
          t.workspaceId = row.wsId;
          t.workspaceExternalId = row.wsExt;
          t.role = row.role;
        }
      }
      return token;
    },

    async session({ session, token }) {
      const t = token as Record<string, unknown>;
      if (t.userIdNum && session.user) {
        session.user.id = (t.userExternalId as string) ?? '';
        session.user.userIdNum = t.userIdNum as number;
        session.user.workspaceId = (t.workspaceId as number) ?? 0;
        session.user.workspaceExternalId = (t.workspaceExternalId as string) ?? '';
        session.user.role = (t.role as 'admin' | 'member' | 'viewer') ?? 'member';
      }
      return session;
    },
  },
});
