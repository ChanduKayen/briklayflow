// The Sites step (Step 2) row. Unlike parties (many, often new), an org has FEW projects and a sheet
// site almost always maps to one that already exists — so this shows a plain dropdown of every
// existing project (best guess first) to map to, plus "add as a new site". Far more discoverable than
// the party row's type-ahead: the whole list is one click away. Emits the same ResolveValue the commit
// path already reads (match → chosenId, newdone → created at commit); "change" reopens the dropdown.

import { useMemo } from 'react';
import { scoreProjectName } from '../../lib/projectSearch';
import type { ResolveValue } from './ResolveRow';

interface Props {
  src: string;
  count: number;
  doubt: boolean;
  projects: { id: string; name: string }[];   // the org's projects + any added this session (the pool)
  value: ResolveValue;
  onChange: (v: ResolveValue) => void;
}

export default function SiteResolveRow({ src, count, doubt, projects, value, onChange }: Props) {
  const resolved = (value.mode === 'match' && !!value.chosenId) || value.mode === 'newdone';
  // Existing projects, the closest guess to this sheet name floated to the top.
  const ranked = useMemo(
    () => [...projects].sort((a, b) => scoreProjectName(src, b.name) - scoreProjectName(src, a.name)),
    [projects, src],
  );

  return (
    <tr>
      <td>{src}{doubt && <span className="doubt"> ?</span>}</td>
      <td>
        {resolved ? (
          <div className="txt">
            <span>
              {value.mode === 'newdone'
                ? (value.newName || src)
                : (value.chosenLabel ?? ranked.find((p) => p.id === value.chosenId)?.name ?? '')}
              {value.mode === 'newdone' && <span className="tag new">new</span>}
            </span>
            <span className="lnk" onClick={() => onChange({ mode: 'pick' })}>change</span>
          </div>
        ) : (
          <select className="cb" value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              if (v === '__new') onChange({ mode: 'newdone', newName: src });
              else onChange({ mode: 'match', chosenId: v, chosenLabel: ranked.find((p) => p.id === v)?.name });
            }}>
            <option value="">— choose a site to map to —</option>
            {ranked.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="__new">＋ Add “{src}” as a new site</option>
          </select>
        )}
      </td>
      <td className="num">{count}</td>
    </tr>
  );
}
