import { useQuery } from '@tanstack/react-query';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';

interface Domain { id: number; code: string; name: string; version: number }

interface Props {
  value: string | null;
  onChange: (code: string | null) => void;
  className?: string;
  placeholder?: string;
}

const ALL = '__all__';

export function DomainSelect({ value, onChange, className, placeholder = 'All domains' }: Props) {
  const { data: domains } = useQuery({
    queryKey: ['assessments', 'domains'],
    queryFn: async () => {
      const res = await api.get<{ domains: Domain[] }>('/assessments/domains');
      if (res.error !== null) throw new Error(res.error);
      return res.data.domains;
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL ? null : v)}
    >
      <SelectTrigger className={className ?? 'h-8 w-56'}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {(domains ?? []).map((d) => (
          <SelectItem key={d.id} value={d.code}>{d.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
