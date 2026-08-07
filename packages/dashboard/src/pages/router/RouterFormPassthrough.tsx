import { useTranslation } from 'react-i18next';
import { RouterCreateForm } from './RouterFormShared';

export function RouterFormPassthrough() {
  const { t } = useTranslation();

  return (
    <RouterCreateForm
      kind="passthrough"
      buildExtraPayload={() => ({})}
      afterCreatePath={id => `/dashboard/routers/${id}/general`}
      submitLabel={t('routers.general.form.createPassthrough')}
    />
  );
}
