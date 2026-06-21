-- ===========================================================================
-- wa_message_log.message_type — widen the CHECK to cover interactive replies.
--
-- The original constraint (20260513200000_whatsapp.sql) allowed only
-- text/image/audio/document. But the inbound audit logs the RAW WhatsApp
-- message.type, and every button tap, list pick AND Flow completion arrives as
-- type 'interactive' — so each of those log inserts has been failing the check
-- (non-fatal: logMessage only console.errors, but the audit row was lost).
--
-- Widen to the full set of inbound WhatsApp message types we may see, so the
-- audit log is complete. logMessage still inserts message.type verbatim.
-- ===========================================================================

ALTER TABLE public.wa_message_log
  DROP CONSTRAINT IF EXISTS wa_message_log_message_type_check;

ALTER TABLE public.wa_message_log
  ADD CONSTRAINT wa_message_log_message_type_check
  CHECK (message_type IN (
    'text', 'image', 'audio', 'video', 'document', 'sticker',
    'location', 'contacts', 'interactive', 'button', 'reaction',
    'order', 'system', 'unsupported'
  ));
