import { useCallback } from 'react';
import { useCommonTranslation } from '@/i18n/hooks';
import { useOrgLabels } from '@/store/config';
import type { Role } from '@/lib/roles';

/** Display name for a role; coordinator roles follow the deployment's level labels. */
export function useRoleLabel(): (role: string) => string {
  const { t } = useCommonTranslation();
  const { region, district } = useOrgLabels();
  return useCallback(
    (role: string) => {
      const label = role === 'county' ? region.one : role === 'subcounty' ? district.one : undefined;
      return t(`roles.${role as Role}`, { label, defaultValue: role });
    },
    [t, region.one, district.one],
  );
}
