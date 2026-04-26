/**
 * Notifications tab — per-user toggles for email/Slack alerts.
 *
 * The schema doesn't yet have a `user_preferences` table, so the action
 * round-trips successfully without persisting. The form contract is what we
 * commit to here so we can ship the UI now and add storage later.
 */
import { auth } from '@/server/auth/config';
import { updateNotificationsAction } from '../actions';
import { Card, SubmitButton, ToggleRow } from '../fields';

export default async function NotificationsSettingsPage() {
  const session = await auth();
  // We render with sensible defaults since no preferences are persisted yet.
  // Once a user_preferences row exists we'll read it here.
  const email = session?.user?.email ?? 'you';

  return (
    <>
      <header className="mb-5">
        <h1 className="text-lg font-semibold">Notifications</h1>
        <p className="mt-1 text-xs text-ink-3">
          We'll email <span className="font-mono">{email}</span> for the events you opt into.
        </p>
      </header>

      <form action={updateNotificationsAction}>
        <Card title="Email">
          <ToggleRow
            name="weeklyEmail"
            label="Weekly usage summary"
            hint="A digest of conversations, leads, and spend — sent every Monday."
            defaultChecked
          />
          <ToggleRow
            name="callEscalation"
            label="Call escalations"
            hint="Real-time email when a voice agent hands off to a human."
            defaultChecked
          />
          <ToggleRow
            name="failedPayment"
            label="Failed payment"
            hint="Alert if Stripe fails to charge your card on file."
            defaultChecked
          />
        </Card>

        <div className="flex justify-end">
          <SubmitButton>Save preferences</SubmitButton>
        </div>
      </form>
    </>
  );
}
