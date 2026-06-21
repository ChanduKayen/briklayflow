-- ===========================================================================
-- wa_conversations.staged_entry_id — drop the rough_entries FK (now polymorphic).
--
-- The column was added (20260613000008) when only the TRANSACTION agent staged
-- rows, all into rough_entries. The PROCUREMENT agent reuses the SAME column to
-- carry a purchase_requests.id (the staged PR draft), interpreted by owning_agent.
-- A purchase_requests id is not present in rough_entries, so the FK rejects every
-- procurement conversation:
--   ERROR 23503 wa_conversations_staged_entry_id_fkey
--     Key (staged_entry_id)=(…) is not present in table "rough_entries".
--
-- staged_entry_id is now a plain uuid whose target table is determined by
-- owning_agent (TRANSACTION -> rough_entries, PROCUREMENT -> purchase_requests).
-- Drop the single-table FK; integrity is owned by the agents, not the schema.
-- (The transaction path was already tolerant — openConversation only console.errors
-- on failure — so dropping the constraint changes no transaction behaviour.)
-- ===========================================================================

ALTER TABLE public.wa_conversations
  DROP CONSTRAINT IF EXISTS wa_conversations_staged_entry_id_fkey;

COMMENT ON COLUMN public.wa_conversations.staged_entry_id IS
  'Staged draft id for the OPEN turn. Polymorphic by owning_agent: TRANSACTION -> '
  'rough_entries.id, PROCUREMENT -> purchase_requests.id. No FK (two target tables).';
