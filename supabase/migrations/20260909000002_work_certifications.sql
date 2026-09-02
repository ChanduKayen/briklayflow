-- ===========================================================================
-- Phase 1C — work certifications: the accountable event that MINTS a contract
-- obligation. Replaces the implicit "a stage reading is the obligation" with an
-- explicit, evidenced, role-gated record. Only an APPROVED certification counts
-- as a payable (a pending one is not owed — same discipline as a pending PO).
--
-- Composition (mirrors the attendance stage math, now governed):
--   · measured milestone → each cert is an incremental ₹; total = Σ approved
--   · lump milestone     → each cert is the cumulative ₹ at that %; total = latest approved
--   · piece / gutha      → each cert is one discrete job ₹; total = Σ approved
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.work_certifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  project_id      text REFERENCES public.projects(project_id) ON DELETE SET NULL,
  wo_id           text REFERENCES public.work_orders(wo_id) ON DELETE SET NULL,
  milestone_id    uuid REFERENCES public.wo_milestones(milestone_id) ON DELETE SET NULL,
  crew_id         uuid REFERENCES public.labour_crews(crew_id) ON DELETE SET NULL,   -- the engagement
  stakeholder_id  text REFERENCES public.stakeholders(stakeholder_id) ON DELETE SET NULL, -- who is owed
  reading_kind    text NOT NULL CHECK (reading_kind IN ('lump','measured','piece')),
  reading_value   numeric NOT NULL DEFAULT 0,        -- % for lump, qty for measured, count for piece
  computed_amount numeric NOT NULL DEFAULT 0,        -- ₹ this certification asserts (see composition)
  reading_date    date NOT NULL DEFAULT current_date,
  evidence_url    text,
  note            text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  source          text NOT NULL DEFAULT 'wizard' CHECK (source IN ('wizard','legacy','party_page')),
  submitted_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  escalated_to    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.work_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.work_certifications
  FOR ALL USING (org_id IN (SELECT public.get_my_org_ids())) WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER work_certifications_touch BEFORE UPDATE ON public.work_certifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX work_certifications_org_idx        ON public.work_certifications(org_id);
CREATE INDEX work_certifications_milestone_idx  ON public.work_certifications(milestone_id);
CREATE INDEX work_certifications_party_idx      ON public.work_certifications(stakeholder_id);
CREATE INDEX work_certifications_status_idx     ON public.work_certifications(org_id, status);

-- ── submit — creates a certification; auto-approves within the submitter's authority ─────────────
CREATE OR REPLACE FUNCTION public.submit_work_certification(
  p_org_id         uuid,
  p_project_id     text,
  p_wo_id          text,
  p_milestone_id   uuid,
  p_crew_id        uuid,
  p_stakeholder_id text,
  p_reading_kind   text,
  p_reading_value  numeric,
  p_computed_amount numeric,
  p_reading_date   date,
  p_evidence_url   text,
  p_note           text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_can boolean; v_limit numeric; v_higher uuid; v_proj uuid;
  v_auto boolean; v_status text; v_escalate uuid; v_id uuid;
BEGIN
  IF p_org_id NOT IN (SELECT public.get_my_org_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  SELECT can_certify_work, work_certification_limit, higher_approver_id
    INTO v_can, v_limit, v_higher
    FROM public.org_memberships
   WHERE user_id = auth.uid() AND org_id = p_org_id AND status = 'active'
   LIMIT 1;

  SELECT works_approver_id INTO v_proj FROM public.projects WHERE project_id = p_project_id;

  -- Auto-approve when the submitter holds the power AND the event is within their cap.
  v_auto := COALESCE(v_can, false) AND (v_limit IS NULL OR p_computed_amount <= v_limit);
  v_status   := CASE WHEN v_auto THEN 'approved' ELSE 'pending' END;
  -- Pending routes PROJECT-FIRST, MEMBER-FALLBACK.
  v_escalate := CASE WHEN v_auto THEN NULL ELSE COALESCE(v_proj, v_higher) END;

  INSERT INTO public.work_certifications (
    org_id, project_id, wo_id, milestone_id, crew_id, stakeholder_id,
    reading_kind, reading_value, computed_amount, reading_date, evidence_url, note,
    status, source, submitted_by, approved_by, approved_at, escalated_to
  ) VALUES (
    p_org_id, NULLIF(p_project_id,''), NULLIF(p_wo_id,''), p_milestone_id, p_crew_id, NULLIF(p_stakeholder_id,''),
    p_reading_kind, COALESCE(p_reading_value,0), COALESCE(p_computed_amount,0), COALESCE(p_reading_date, current_date),
    NULLIF(p_evidence_url,''), NULLIF(p_note,''),
    v_status, 'wizard', auth.uid(),
    CASE WHEN v_auto THEN auth.uid() ELSE NULL END,
    CASE WHEN v_auto THEN now() ELSE NULL END,
    v_escalate
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'status', v_status, 'escalated_to', v_escalate);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

-- ── decide — approve or reject a pending certification (the Works Approver) ───────────────────────
CREATE OR REPLACE FUNCTION public.decide_work_certification(
  p_id      uuid,
  p_approve boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org uuid; v_amount numeric; v_submitter uuid;
  v_can boolean; v_limit numeric; v_status text;
BEGIN
  SELECT org_id, computed_amount, submitted_by INTO v_org, v_amount, v_submitter
    FROM public.work_certifications WHERE id = p_id;
  IF v_org IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not found'); END IF;
  IF v_org NOT IN (SELECT public.get_my_org_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  SELECT can_certify_work, work_certification_limit INTO v_can, v_limit
    FROM public.org_memberships
   WHERE user_id = auth.uid() AND org_id = v_org AND status = 'active' LIMIT 1;

  -- Must hold the power and be authorised for this amount (or be management/principal).
  IF NOT (COALESCE(v_can, false) AND (v_limit IS NULL OR v_amount <= v_limit))
     AND NOT public.has_role_in_org(v_org, VARIADIC ARRAY['management'::text,'principal'::text]) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not authorised to certify this amount');
  END IF;

  v_status := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
  UPDATE public.work_certifications
     SET status = v_status, approved_by = auth.uid(), approved_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('success', true, 'status', v_status);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

REVOKE ALL     ON FUNCTION public.submit_work_certification(uuid,text,text,uuid,uuid,text,text,numeric,numeric,date,text,text) FROM public;
GRANT  EXECUTE ON FUNCTION public.submit_work_certification(uuid,text,text,uuid,uuid,text,text,numeric,numeric,date,text,text) TO authenticated;
REVOKE ALL     ON FUNCTION public.decide_work_certification(uuid,boolean) FROM public;
GRANT  EXECUTE ON FUNCTION public.decide_work_certification(uuid,boolean) TO authenticated;

-- ── Legacy backfill — preserve continuity ────────────────────────────────────────────────────────
-- Every existing attendance stage reading becomes an APPROVED legacy certification, so no certified
-- obligation is lost when the views switch their source to work_certifications. New readings flow
-- through the wizard (pending → approved). Idempotent: only seeds when the table is empty.
INSERT INTO public.work_certifications (
  org_id, project_id, wo_id, milestone_id, crew_id, stakeholder_id,
  reading_kind, reading_value, computed_amount, reading_date, status, source, approved_at
)
SELECT wo.org_id, wo.project_id, wo.wo_id, m.milestone_id,
       (SELECT c.crew_id FROM public.labour_crews c WHERE c.wo_id = wo.wo_id ORDER BY c.created_at LIMIT 1),
       wo.stakeholder_id,
       CASE WHEN COALESCE(m.unit_type,'LS')='LS' THEN 'lump' ELSE 'measured' END,
       a.value,
       CASE WHEN COALESCE(m.unit_type,'LS')='LS' THEN m.planned_amount * a.value / 100.0
            ELSE m.rate * a.value END,
       a.work_date, 'approved', 'legacy', now()
  FROM public.labour_attendance a
  JOIN public.wo_milestones m ON m.milestone_id = a.milestone_id
  JOIN public.work_orders wo   ON wo.wo_id = m.wo_id
 WHERE a.subject_type = 'stage'
   AND NOT EXISTS (SELECT 1 FROM public.work_certifications);
