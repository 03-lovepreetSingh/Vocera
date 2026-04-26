import { AppTopbar } from '@/components/layout/AppTopbar';
import { CreateAgentWizard } from '@/components/wizard/CreateAgentWizard';
import { LANGUAGES } from '@/lib/languages';
import { createAgentAction } from './actions';

export default function NewAgentPage() {
  return (
    <>
      <AppTopbar title="Create AI Agent" />
      <main className="flex-1 px-6 py-6">
        <CreateAgentWizard languages={LANGUAGES} action={createAgentAction} />
      </main>
    </>
  );
}
