-- Ensure authenticated users (management, accountant, supervisor) can read
-- wo_milestones. Without this SELECT policy, the WO detail phases section
-- returns an empty result and displays nothing.

ALTER TABLE public.wo_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view wo_milestones" ON public.wo_milestones;
CREATE POLICY "Authenticated users can view wo_milestones"
  ON public.wo_milestones
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert wo_milestones" ON public.wo_milestones;
CREATE POLICY "Authenticated users can insert wo_milestones"
  ON public.wo_milestones
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update wo_milestones" ON public.wo_milestones;
CREATE POLICY "Authenticated users can update wo_milestones"
  ON public.wo_milestones
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
