-- ===========================================================================
-- Per-person spoken-language override for voice transcription.
--
-- ISO-639-1 (e.g. 'te', 'hi', 'en'). NULL -> fall back to the deployment locale
-- prior (env WA_STT_LANGUAGE) -> auto-detect from the audio. This is the strongest
-- signal we have for SPEECH: how someone TYPES is not how they SPEAK (romanized
-- English text is common among Telugu/Hindi speakers), so an admin sets the language
-- for any worker who differs from the regional default.
-- ===========================================================================

ALTER TABLE public.wa_registered_numbers
  ADD COLUMN IF NOT EXISTS preferred_language text;
