/**
 * UiSaveHint — ASK-voice helper line beside the Save control (brief §5:
 * "disabled actions always explain themselves"). Dumb presentation: the page
 * derives the message at render from the SAME conditions that disable Save
 * (vendor/project/named-item presence, open questions) and passes it in. Empty
 * text renders nothing, so an enabled Save shows no hint and reserves no space.
 */
import { V } from './voiceTokens';

export default function UiSaveHint({ text }: { text?: string | null }) {
  if (!text) return null;
  return <p className="text-xs mt-1 text-right" style={{ color: V.ask }}>{text}</p>;
}
