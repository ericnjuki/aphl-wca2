import { EyeOff } from 'lucide-react';

interface Props { entity: 'district' | 'facility' }

// Shown on a partner's district/facility report whose own row is hidden in the
// list above it (the API blanks every figure).
export function PrivacyHiddenNotice({ entity }: Props) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-sm border bg-muted/40 p-3 text-sm">
      <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span>
        Results for this {entity} are hidden for privacy — too few people responded in the area above it to show
        them without identifying individuals.
      </span>
    </div>
  );
}
