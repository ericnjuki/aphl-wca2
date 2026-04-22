import { useTranslation } from 'react-i18next';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MATURITY } from '@/lib/reports/maturity';
import type { MaturityLevel } from '@/types/reports';

const ORDER: MaturityLevel[] = [1, 2, 3, 4, 0];

export function MaturityLegend({ className }: { className?: string }) {
  const { t } = useTranslation(['app']);
  return (
    <div className={`flex flex-wrap items-center gap-3 text-xs ${className ?? ''}`}>
      {ORDER.map((level) => {
        const spec = MATURITY[level];
        return (
          <Tooltip key={level}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 hover:bg-muted focus:outline-none"
              >
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: spec.color }}
                />
                <span className="text-muted-foreground">
                  {t(spec.labelKey, { defaultValue: spec.key })}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs">
              {t(`reports.maturity.tooltip.${spec.key}`, {
                defaultValue: `Maturity level: ${spec.key}`,
              })}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
