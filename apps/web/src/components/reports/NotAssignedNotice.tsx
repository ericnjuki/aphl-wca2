import { useAuthStore } from '@/store/auth';
import { useOrgLabels } from '@/store/config';

// Landing view for a coordinator or facility admin who has not been placed yet.
export function NotAssignedNotice() {
  const role = useAuthStore((s) => s.user?.role);
  const { region, district } = useOrgLabels();
  const unit = role === 'county' ? region.lower : role === 'subcounty' ? district.lower : 'facility';
  return (
    <div className="p-6 text-sm text-muted-foreground">
      No {unit} is assigned to your account yet. Ask an administrator to assign one.
    </div>
  );
}
