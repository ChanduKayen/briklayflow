-- Add 'Client' to the stakeholder_type enum so client billing can use stakeholders as clients
ALTER TYPE public.stakeholder_type ADD VALUE IF NOT EXISTS 'Client';
