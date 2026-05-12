-- Enums
CREATE TYPE public.user_role AS ENUM ('management', 'accountant', 'supervisor');
CREATE TYPE public.project_status AS ENUM ('Active', 'Completed', 'On Hold');

-- user_profiles table
CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  role public.user_role NOT NULL,
  assigned_projects text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- projects table
CREATE TABLE public.projects (
  project_id text PRIMARY KEY,
  name text NOT NULL,
  site_location text,
  status public.project_status DEFAULT 'Active',
  start_date date,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_assigned_projects()
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT assigned_projects FROM public.user_profiles WHERE id = auth.uid();
$$;

-- RLS Policies for user_profiles
CREATE POLICY "Users can read own profile" ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Management can read all profiles" ON public.user_profiles FOR SELECT
  USING (public.current_user_role() = 'management');

CREATE POLICY "Management can manage profiles" ON public.user_profiles FOR ALL
  USING (public.current_user_role() = 'management');

-- RLS Policies for projects
CREATE POLICY "Management and Accountant can read all projects" ON public.projects FOR SELECT
  USING (public.current_user_role() IN ('management', 'accountant'));

CREATE POLICY "Supervisor can read assigned projects" ON public.projects FOR SELECT
  USING (
    public.current_user_role() = 'supervisor' AND 
    project_id = ANY(public.current_user_assigned_projects())
  );

CREATE POLICY "Management can insert projects" ON public.projects FOR INSERT
  WITH CHECK (public.current_user_role() = 'management');

CREATE POLICY "Management can update projects" ON public.projects FOR UPDATE
  USING (public.current_user_role() = 'management');
