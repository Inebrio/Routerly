import { useTranslation } from 'react-i18next';
import { RouterCreateForm } from './RouterFormShared';

/**
 * Orchestrator creation is step 1 of 2: name + timeout only. Candidates are
 * added afterward on the created router's Orchestrator tab (unchanged).
 */
export function RouterFormOrchestrator() {
  const { t } = useTranslation();
  return (
    <RouterCreateForm
      kind="orchestrator"
      buildExtraPayload={() => ({})}
      afterCreatePath={id => `/dashboard/routers/${id}/orchestrator`}
      submitLabel={t('routers.general.form.createOrchestrator')}
    />
  );
}
