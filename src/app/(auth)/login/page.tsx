import Link from 'next/link';
import { loginAction, googleLoginAction } from './actions';
import { LoginForm } from './form';

export default function LoginPage() {
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return (
    <>
      <h1 className="text-xl font-semibold">Sign in to Vocera</h1>
      <LoginForm action={loginAction} googleAction={googleEnabled ? googleLoginAction : null} />
      <p className="mt-6 text-center text-sm text-ink-3">
        New here?{' '}
        <Link href="/signup" className="text-accent hover:underline">
          Create a workspace
        </Link>
      </p>
    </>
  );
}
