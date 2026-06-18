-- ===========================================================================
-- Normalise wa_registered_numbers.phone_number to the canonical international
-- form ('91' + last 10 digits) the inbound webhook matches against.
--
-- WHY: Meta delivers an inbound message's `from` as the full international MSISDN
-- (e.g. 919876543210). The webhook looks a sender up with
-- `.eq('phone_number', from)`. The Day Book Manage-team / invite flows used to
-- store the BARE 10-digit number, so those senders failed the lookup and got the
-- "You're not registered" reply even though they were active. The frontend now
-- writes the canonical form; this backfills rows already stored short (and is a
-- no-op for rows already in the 91XXXXXXXXXX form).
--
-- India-only (+91), matching the app's hardcoded country code everywhere. If two
-- rows would collapse to the same number (one stored short, one full) the UNIQUE
-- constraint will flag it — resolve that pair by hand, it means a duplicate sender.
-- ===========================================================================

UPDATE public.wa_registered_numbers
SET    phone_number = '91' || right(regexp_replace(phone_number, '\D', '', 'g'), 10)
WHERE  length(regexp_replace(phone_number, '\D', '', 'g')) >= 10
  AND  phone_number IS DISTINCT FROM ('91' || right(regexp_replace(phone_number, '\D', '', 'g'), 10));
