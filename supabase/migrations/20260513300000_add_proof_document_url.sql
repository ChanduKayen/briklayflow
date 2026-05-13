-- Add proof_document_url to transactions for WhatsApp image proofs
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS proof_document_url text;
