import { useTranslation } from 'react-i18next';
import { RouterCreateForm } from './RouterFormShared';

export function RouterFormRouter() {
  const { t } = useTranslation();
  return (
    <RouterCreateForm
      kind="router"
      buildExtraPayload={() => ({})}
      afterCreatePath={id => `/dashboard/routers/${id}/general`}
      submitLabel={t('routers.general.form.createRouter')}
    />
  );
}
