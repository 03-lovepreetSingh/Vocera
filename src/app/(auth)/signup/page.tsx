import Link from 'next/link';
import { signupAction } from './actions';
import { SignupForm } from './form';

export default function SignupPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Create your Vocera workspace</h1>
      <p className="mt-1 text-sm text-ink-3">Start with 100 free voice minutes a month.</p>
      <SignupForm action={signupAction} />
      <p className="mt-6 text-center text-sm text-ink-3">
        Already have an account?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
