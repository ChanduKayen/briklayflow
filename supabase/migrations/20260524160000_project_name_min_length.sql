-- Prevent project names shorter than 4 characters.
-- Frontend already enforces this; constraint is a belt-and-suspenders guard.

-- Safety check: rename any existing short-named projects before adding constraint.
-- (Run the SELECT below manually first to review; the UPDATE is a no-op if none exist.)
-- SELECT project_id, name FROM projects WHERE length(trim(name)) < 4;

DO $$
BEGIN
  -- Pad any existing short names so the constraint can be added cleanly.
  UPDATE projects
  SET name = name || repeat('_', 4 - length(trim(name)))
  WHERE length(trim(name)) < 4;

  ALTER TABLE projects
    ADD CONSTRAINT chk_project_name_min_length
    CHECK (length(trim(name)) >= 4);
END;
$$;
