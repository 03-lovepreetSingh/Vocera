'use server';

import { signOut } from '@/server/auth/config';

export async function signOutAction() {
  await signOut({ redirectTo: '/' });
}
