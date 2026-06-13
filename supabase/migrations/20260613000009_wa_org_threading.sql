-- ===========================================================================
-- WhatsApp Sprint 1 -- org_id threading (T1.6)
--
-- Add org_id to wa_registered_numbers (the sender->org source) and to
-- rough_entries (today created with a null owner). BEFORE INSERT triggers fill
-- org_id so neither the webhook handlers nor the client insert code need changes.
-- ===========================================================================

-- -- wa_registered_numbers.org_id -----------------------------------------------
ALTER TABLE public.wa_registered_numbers
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(org_id) ON DELETE RESTRICT;

-- Backfill existing rows to the single active org.
UPDATE public.wa_registered_numbers
  SET org_id = (SELECT org_id FROM public.organizations WHERE status = 'active' ORDER BY created_at LIMIT 1)
  WHERE org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_wa_registered_numbers_org ON public.wa_registered_numbers(org_id);

-- Fill org_id on insert from the registering admin's active org (client path),
-- falling back to the single active org. Keeps the existing client insert
-- (ManageTeam / Settings) working without changes.
CREATE OR REPLACE FUNCTION public.wa_registered_numbers_set_org_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT m.org_id INTO NEW.org_id
    FROM public.org_memberships m
    WHERE m.user_id = auth.uid() AND m.status = 'active'
    ORDER BY m.joined_at NULLS LAST
    LIMIT 1;
  END IF;
  IF NEW.org_id IS NULL THEN
    SELECT org_id INTO NEW.org_id FROM public.organizations WHERE status = 'active' ORDER BY created_at LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS wa_registered_numbers_set_org_id ON public.wa_registered_numbers;
CREATE TRIGGER wa_registered_numbers_set_org_id
  BEFORE INSERT ON public.wa_registered_numbers
  FOR EACH ROW EXECUTE FUNCTION public.wa_registered_numbers_set_org_id();

-- -- rough_entries.org_id -------------------------------------------------------
ALTER TABLE public.rough_entries
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(org_id) ON DELETE RESTRICT;

-- Backfill: WhatsApp entries via sender_number -> wa_registered_numbers;
-- UI entries via created_by -> org_memberships; anything left -> active org.
UPDATE public.rough_entries re
  SET org_id = wrn.org_id
  FROM public.wa_registered_numbers wrn
  WHERE re.sender_number = wrn.phone_number AND re.org_id IS NULL;

UPDATE public.rough_entries re
  SET org_id = m.org_id
  FROM public.org_memberships m
  WHERE re.created_by = m.user_id AND m.status = 'active' AND re.org_id IS NULL;

UPDATE public.rough_entries
  SET org_id = (SELECT org_id FROM public.organizations WHERE status = 'active' ORDER BY created_at LIMIT 1)
  WHERE org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_rough_entries_org ON public.rough_entries(org_id);

-- Auto-fill org_id on insert: WhatsApp writes carry sender_number (resolve via
-- wa_registered_numbers); UI writes carry created_by/auth.uid() (resolve via
-- org_memberships). No handler/client edits needed.
CREATE OR REPLACE FUNCTION public.rough_entries_set_org_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.org_id IS NULL AND NEW.sender_number IS NOT NULL THEN
    SELECT wrn.org_id INTO NEW.org_id
    FROM public.wa_registered_numbers wrn
    WHERE wrn.phone_number = NEW.sender_number AND wrn.is_active = true
    LIMIT 1;
  END IF;
  IF NEW.org_id IS NULL AND auth.uid() IS NOT NULL THEN
    SELECT m.org_id INTO NEW.org_id
    FROM public.org_memberships m
    WHERE m.user_id = auth.uid() AND m.status = 'active'
    ORDER BY m.joined_at NULLS LAST
    LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rough_entries_set_org_id ON public.rough_entries;
CREATE TRIGGER rough_entries_set_org_id
  BEFORE INSERT ON public.rough_entries
  FOR EACH ROW EXECUTE FUNCTION public.rough_entries_set_org_id();

-- NOTE (flagged, NOT done here): rough_entries.org_id is left NULLABLE and its RLS
-- is still ROLE-based (staff_read via user_profiles), not org-scoped. Org-isolating
-- rough_entries (NOT NULL + org member access policy) is a follow-up once UI inserts
-- reliably populate org_id and the day-book read paths are confirmed. The webhook
-- additionally rejects senders with no resolvable org at ingest, so WhatsApp rows
-- are never written un-orged.
