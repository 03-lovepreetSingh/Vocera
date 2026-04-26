'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { LoginState } from './actions';

interface Props {
  action: (state: LoginState, formData: FormData) => Promise<LoginState>;
  googleAction: (() => Promise<void>) | null;
}

export function LoginForm({ action, googleAction }: Props) {
  const [state, dispatch] = useFormState(action, {} as LoginState);
  return (
    <div className="mt-6 grid gap-3">
      <form action={dispatch} className="grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-ink-3">Email</span>
          <input
            name="email"
            type="email"
            required
            className="rounded-md border border-line-soft bg-paper px-3 py-2 outline-none focus:border-accent"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-3">Password</span>
          <input
            name="password"
            type="password"
            required
            className="rounded-md border border-line-soft bg-paper px-3 py-2 outline-none focus:border-accent"
          />
        </label>
        {state?.error && <p className="text-sm text-red-500">{state.error}</p>}
        <Submit />
      </form>
      {googleAction && (
        <>
          <div className="my-2 text-center text-xs text-ink-3">or</div>
          <form action={googleAction}>
            <button
              type="submit"
              className="w-full rounded-md border border-line-soft bg-paper px-4 py-2 font-medium hover:bg-fill"
            >
              Continue with Google
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-accent px-4 py-2 font-medium text-paper disabled:opacity-60"
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}
