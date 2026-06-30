-- Add sender_name to site_narrations so a task's Updates feed shows WHO sent each WhatsApp update
-- (the registered team member's name) instead of a faceless "WhatsApp" — which becomes a subtle
-- badge in the UI. Stamped by the whatsapp-webhook agent at capture time; null for legacy rows or
-- unknown numbers (the card then reads "Site team").
ALTER TABLE public.site_narrations ADD COLUMN IF NOT EXISTS sender_name text;
