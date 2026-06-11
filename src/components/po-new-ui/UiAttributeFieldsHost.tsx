/**
 * UiAttributeFieldsHost — wrapper around the SHARED ItemAttributeFields
 * component (decision 4 / brief §1). ItemAttributeFields holds local state
 * (openDropdown, customInputs), a ref, and a click-outside effect, so it must
 * be CSS-hidden — never unmounted — by callers, and must not be edited in this
 * branch. This host is the seam that lets the redesign place those fields
 * inside the resolution strip without touching the shared file. It forwards
 * every prop verbatim (exact prop types via ComponentProps) — no re-binding.
 *
 * (InlineAttributePills, the other would-be consumer, is dead code — see the
 * cleanup ticket. It is intentionally left untouched in this branch.)
 */
import type { ComponentProps } from 'react';
import { ItemAttributeFields } from '../ItemAttributeFields';

type UiAttributeFieldsHostProps = ComponentProps<typeof ItemAttributeFields>;

export default function UiAttributeFieldsHost(props: UiAttributeFieldsHostProps) {
  return <ItemAttributeFields {...props} />;
}
