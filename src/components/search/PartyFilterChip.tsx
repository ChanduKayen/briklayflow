/**
 * "You are looking at one party's list."
 *
 * A page reached from the search's Orders / Bills / Contracts / Payments row arrives already
 * narrowed to one party. Without this you land on a list that is quietly missing most of itself
 * and nothing on screen says why. It names them, and takes it off again.
 */
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

const CSS = `
.csx-party{display:inline-flex; align-items:center; gap:9px; background:#F7E9E2; border:1px solid #E4C9B9;
  color:#8A3E22; border-radius:999px; padding:6px 8px 6px 14px; font-family:'DM Sans',-apple-system,sans-serif;
  font-size:13px; white-space:nowrap; max-width:100%}
.csx-party b{font-weight:600; overflow:hidden; text-overflow:ellipsis}
.csx-party button{border:0; background:rgba(138,62,34,.1); color:#8A3E22; width:20px; height:20px; border-radius:50%;
  font-size:11px; line-height:1; cursor:pointer; flex:none}
.csx-party button:hover{background:rgba(138,62,34,.2)}
`;

export default function PartyFilterChip({ what }: { what: string }) {
  const [params, setParams] = useSearchParams();
  const id = params.get('party');
  // Cached, so bouncing between a party's Orders and Bills doesn't re-ask who they are.
  const { data: name } = useQuery({
    queryKey: ['party_name', id],
    enabled: !!id,
    staleTime: 5 * 60_000,
    queryFn: async () => (await supabase.from('stakeholders').select('name').eq('stakeholder_id', id!).maybeSingle()).data?.name ?? null,
  });

  if (!id) return null;
  return (
    <span className="csx-party">
      <style>{CSS}</style>
      {what} of <b>{name ?? '…'}</b>
      <button
        onClick={() => { const p = new URLSearchParams(params); p.delete('party'); setParams(p, { replace: true }); }}
        aria-label="Show everyone"
      >✕</button>
    </span>
  );
}
