'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { signIn } from '@/server/auth/config';

const Schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = Schema.safeParse({
    email: formData.get('email')?.toString(),
    password: formData.get('password')?.toString(),
  });
  if (!parsed.success) return { error: 'Invalid email or password.' };

  try {
    await signIn('credentials', {
      email: parsed.data.email.toLowerCase(),
      password: parsed.data.password,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) return { error: 'Invalid email or password.' };
    throw err;
  }
  redirect('/dashboard');
}

export async function googleLoginAction() {
  await signIn('google', { redirectTo: '/dashboard' });
}
