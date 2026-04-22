import { useQuery } from '@tanstack/react-query';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';

interface Domain { id: number; code: string; name: string }
interface Item {
  competency_value: string;
  competency_text: string;
}

interface Props {
  domainCode: string | null;
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
}

const ALL = '__all__';

export function CompetencySelect({ domainCode, value, onChange, className }: Props) {
  // Resolve domain code → domain id (needed for /items endpoint).
  const { data: domain } = useQuery({
    queryKey: ['assessments', 'domain-by-code', domainCode],
    enabled: !!domainCode,
    queryFn: async () => {
      const res = await api.get<{ domains: Domain[] }>('/assessments/domains');
      if (res.error !== null) throw new Error(res.error);
      return res.data.domains.find((d) => d.code === domainCode) ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: items } = useQuery({
    queryKey: ['assessments', 'items', domain?.id ?? null],
    enabled: !!domain,
    queryFn: async () => {
      const res = await api.get<{ items: Item[] }>(`/assessments/domains/${domain!.id}/items`);
      if (res.error !== null) throw new Error(res.error);
      return res.data.items;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Distinct competency_value/competency_text pairs.
  const unique = Array.from(
    new Map((items ?? []).map((i) => [i.competency_value, i.competency_text])).entries(),
  );

  return (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL ? null : v)}
      disabled={!domainCode}
    >
      <SelectTrigger className={className ?? 'h-8 w-56'}>
        <SelectValue placeholder={domainCode ? 'All competencies' : 'Select a domain first'} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All competencies</SelectItem>
        {unique.map(([val, text]) => (
          <SelectItem key={val} value={val}>{text}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
