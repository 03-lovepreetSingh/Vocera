'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { SignupState } from './actions';

interface Props {
  action: (state: SignupState, formData: FormData) => Promise<SignupState>;
}

export function SignupForm({ action }: Props) {
  const [state, dispatch] = useFormState(action, {} as SignupState);
  return (
    <form action={dispatch} className="mt-6 grid gap-3">
      <Field label="Workspace name (optional)" name="name" placeholder="Acme Inc" />
      <Field label="Email" name="email" type="email" required placeholder="you@company.com" />
      <Field label="Password" name="password" type="password" required minLength={8} />
      {state?.error && <p className="text-sm text-red-500">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  minLength?: number;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-ink-3">{props.label}</span>
      <input
        name={props.name}
        type={props.type ?? 'text'}
        required={props.required}
        minLength={props.minLength}
        placeholder={props.placeholder}
        className="rounded-md border border-line-soft bg-paper px-3 py-2 outline-none focus:border-accent"
      />
    </label>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 rounded-md bg-accent px-4 py-2 font-medium text-paper disabled:opacity-60"
    >
      {pending ? 'Creating workspace…' : 'Create workspace'}
    </button>
  );
}
