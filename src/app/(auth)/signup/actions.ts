'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { signIn } from '@/server/auth/config';
import { provisionUser } from '@/server/auth/provision';

const SignupSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export interface SignupState {
  error?: string;
}

export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const parsed = SignupSchema.safeParse({
    name: formData.get('name')?.toString() || undefined,
    email: formData.get('email')?.toString(),
    password: formData.get('password')?.toString(),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? 'Invalid input' };
  }

  const email = parsed.data.email.toLowerCase();
  const existing = (
    await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  )[0];
  if (existing) return { error: 'An account with that email already exists.' };

  await provisionUser({
    email,
    name: parsed.data.name ?? null,
    password: parsed.data.password,
  });

  // Sign the user in immediately. NextAuth's signIn() throws a redirect.
  await signIn('credentials', {
    email,
    password: parsed.data.password,
    redirect: false,
  });

  redirect('/dashboard?onboarding=1');
}
