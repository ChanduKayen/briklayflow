// PhoneInput — the one phone field for the whole platform. Shows a fixed +91 prefix,
// accepts only the 10 local digits, and plays a subtle success→settle animation the
// moment a valid mobile is entered. It ALWAYS emits the 10 local digits, so each caller
// keeps its own submit-time normalization (toE164 / '91'+local / raw) unchanged.
import { useEffect, useRef, useState } from 'react';

// One injected stylesheet, shared by every instance.
const STYLE_ID = 'phin-style';
const CSS = `
.phin{--phin-line:#e2dbcc;--phin-line-2:#d5cbb9;--phin-paper:#fdfbf7;--phin-ink:#3b2f27;--phin-muted:#8b7f70;--phin-faint:#a99e8e;--phin-terra:#b8613a;--phin-sage:#6a8564;
  position:relative;display:inline-flex;align-items:center;width:100%;min-width:220px;height:46px;overflow:hidden;
  border:1px solid var(--phin-line);border-radius:13px;background:var(--phin-paper);
  transition:border-color .3s ease,box-shadow .3s ease;font-family:"DM Sans",system-ui,sans-serif}
.phin.material{border-radius:10px}
.phin.disabled{opacity:.55;pointer-events:none}
.phin .phin-cc{padding-left:16px;color:var(--phin-muted);font-size:14px;font-weight:500;letter-spacing:.01em;user-select:none;transition:color .3s ease}
.phin .phin-div{width:1px;height:17px;margin:0 12px;background:var(--phin-line-2);transition:background .3s ease}
.phin .phin-in{flex:1;min-width:0;border:0;outline:none;background:transparent;height:100%;padding:0 30px 0 0;
  font-family:"DM Mono",ui-monospace,monospace;font-size:15.5px;letter-spacing:.1em;font-variant-numeric:tabular-nums;color:var(--phin-ink)}
.phin .phin-in::placeholder{color:var(--phin-faint);font-family:"DM Sans",system-ui,sans-serif;letter-spacing:.01em;font-size:14.5px}
/* progress underline — grows as the 10 digits arrive, warm while typing, sage when complete */
.phin .phin-fill{position:absolute;left:0;bottom:0;height:2px;background:var(--phin-terra);opacity:.28;
  transition:width .32s cubic-bezier(.33,1,.68,1),background .35s ease,opacity .35s ease}
/* Choose-from-contacts — only rendered where the browser actually has the picker
   (Chrome on Android today), so it never appears as a button that does nothing. */
.phin .phin-pick{position:absolute;right:5px;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;
  border:0;background:transparent;border-radius:10px;cursor:pointer;color:var(--phin-muted);
  transition:color .18s ease,background .18s ease,transform .12s ease}
.phin .phin-pick:hover{color:var(--phin-terra);background:color-mix(in srgb,var(--phin-terra) 8%,transparent)}
.phin .phin-pick:active{transform:scale(.92)}
.phin .phin-pick svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.phin.haspick .phin-ok{right:47px}
@media (prefers-reduced-motion:reduce){.phin .phin-pick{transition:none}}
.phin .phin-ok{position:absolute;right:15px;display:inline-flex;opacity:0;transform:translateX(5px);transition:opacity .32s ease,transform .4s cubic-bezier(.34,1.15,.5,1)}
.phin .phin-ok svg{width:15px;height:15px;stroke:var(--phin-sage);fill:none;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:20;stroke-dashoffset:20}
.phin:focus-within{border-color:var(--phin-terra);box-shadow:0 1px 2px rgba(59,47,39,.04),0 0 0 3px color-mix(in srgb,var(--phin-terra) 11%,transparent)}
.phin:focus-within .phin-div{background:color-mix(in srgb,var(--phin-terra) 45%,var(--phin-line-2))}
.phin.valid{border-color:color-mix(in srgb,var(--phin-sage) 48%,var(--phin-line))}
.phin.valid .phin-cc{color:var(--phin-ink)}
.phin.valid .phin-div{background:color-mix(in srgb,var(--phin-sage) 45%,var(--phin-line-2))}
.phin.valid .phin-fill{background:var(--phin-sage);opacity:.92}
.phin.valid .phin-ok{opacity:1;transform:translateX(0)}
.phin.valid .phin-ok svg{animation:phin-draw .5s .06s cubic-bezier(.62,0,.2,1) forwards}
/* one gentle settle-glow the moment it becomes valid, then rest */
.phin.pulse{animation:phin-settle .72s cubic-bezier(.33,1,.68,1)}
@keyframes phin-draw{to{stroke-dashoffset:0}}
@keyframes phin-settle{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--phin-sage) 26%,transparent)}45%{box-shadow:0 0 0 5px color-mix(in srgb,var(--phin-sage) 20%,transparent)}100%{box-shadow:0 0 0 6px color-mix(in srgb,var(--phin-sage) 0%,transparent)}}
`;
function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style'); el.id = STYLE_ID; el.textContent = CSS; document.head.appendChild(el);
}

/** Last 10 digits of anything (strips +91 / 91 / spaces / raw). */
export const localDigits = (v: string | null | undefined): string => (v || '').replace(/\D/g, '').slice(-10);
/** A valid Indian mobile: 10 digits starting 6–9. */
export const isValidMobile = (local: string): boolean => /^[6-9]\d{9}$/.test(local);

export interface PhoneInputProps {
  value: string | null | undefined;          // any stored format — only the local digits are shown
  onChange: (local10: string) => void;        // emits the 10 local digits (empty string while clearing)
  onValidChange?: (valid: boolean) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  variant?: 'cream' | 'material';
  className?: string;
  style?: React.CSSProperties;
  inputId?: string;
  name?: string;
  /** Called with the picked contact's name when the phone came from the OS contact picker,
   *  so a caller that also has a name field can fill it in the same tap. */
  onPickName?: (name: string) => void;
}

export default function PhoneInput({
  value, onChange, onValidChange, placeholder = '98765 43210',
  autoFocus, disabled, variant = 'cream', className = '', style, inputId, name, onPickName,
}: PhoneInputProps) {
  useEffect(ensureStyle, []);
  const local = localDigits(value);
  const valid = isValidMobile(local);
  const [pulse, setPulse] = useState(false);
  const prevValid = useRef(valid);

  // Fire the success pulse only on the invalid→valid transition, then settle.
  useEffect(() => {
    if (valid && !prevValid.current) { setPulse(true); const t = setTimeout(() => setPulse(false), 620); prevValid.current = valid; return () => clearTimeout(t); }
    prevValid.current = valid;
    onValidChange?.(valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid]);

  // The Contact Picker API is Chrome-on-Android only, needs a secure context, and must be
  // called from a user gesture. Feature-detect once on mount so the button is absent — not
  // present-but-dead — everywhere else.
  const [canPick, setCanPick] = useState(false);
  useEffect(() => {
    setCanPick(typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window);
  }, []);

  const pickFromContacts = async () => {
    const api = (navigator as unknown as { contacts?: {
      select: (p: string[], o?: { multiple?: boolean }) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
      getProperties?: () => Promise<string[]>;
    } }).contacts;
    if (!api) return;
    try {
      // Not every build exposes every property; ask for what this one supports.
      const supported = (await api.getProperties?.()) ?? ['name', 'tel'];
      const want = ['tel', 'name'].filter(pr => supported.includes(pr));
      if (!want.includes('tel')) return;
      const [picked] = await api.select(want, { multiple: false });
      if (!picked) return;
      const tels = picked.tel ?? [];
      // Prefer a number that is actually a valid Indian mobile; fall back to the first listed.
      const chosen = tels.map(localDigits).find(isValidMobile) ?? localDigits(tels[0]);
      if (chosen) onChange(chosen);
      const nm = (picked.name ?? [])[0];
      if (nm && onPickName) onPickName(nm);
    } catch {
      // The picker was dismissed, or the browser refused it — leave whatever is typed alone.
    }
  };

  const progress = Math.min(local.length, 10) / 10;
  return (
    <div className={`phin ${variant}${valid ? ' valid' : ''}${pulse ? ' pulse' : ''}${disabled ? ' disabled' : ''}${canPick ? ' haspick' : ''} ${className}`} style={style}>
      <span className="phin-cc">+91</span>
      <span className="phin-div" />
      <input
        id={inputId} name={name} className="phin-in" type="tel" inputMode="numeric" autoComplete="tel-national"
        maxLength={10} value={local} placeholder={placeholder} autoFocus={autoFocus} disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
        // pinned inline so a page's scoped `input {…}` rules can't override the field's look
        style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', height: '100%', padding: `0 ${canPick ? 76 : 30}px 0 0`, color: '#3b2f27', fontFamily: '"DM Mono", ui-monospace, monospace', fontSize: 15.5, letterSpacing: '.1em' }}
      />
      <span className="phin-ok" aria-hidden={!valid}>
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
      </span>
      {canPick && !disabled && (
        <button type="button" className="phin-pick" onClick={pickFromContacts} aria-label="Choose from contacts" title="Choose from contacts">
          <svg viewBox="0 0 24 24"><path d="M17 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" /><circle cx="10" cy="7" r="3.2" /><path d="M18 8.5v5M20.5 11h-5" /></svg>
        </button>
      )}
      <span className="phin-fill" style={{ width: `${progress * 100}%` }} />
    </div>
  );
}
