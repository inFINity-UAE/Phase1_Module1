-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.companies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trn text,
  base_currency character NOT NULL DEFAULT 'AED'::bpchar,
  is_free_zone_entity boolean NOT NULL DEFAULT false,
  fiscal_year_start_month smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month >= 1 AND fiscal_year_start_month <= 12),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT companies_pkey PRIMARY KEY (id)
);
CREATE TABLE public.company_settings (
  company_id uuid NOT NULL,
  journal_approval_threshold numeric,
  approval_threshold_currency character NOT NULL DEFAULT 'AED'::bpchar,
  default_period_length text NOT NULL DEFAULT 'monthly'::text,
  allow_period_reopen boolean NOT NULL DEFAULT true,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT company_settings_pkey PRIMARY KEY (company_id),
  CONSTRAINT company_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  account_number character NOT NULL,
  account_name text NOT NULL,
  category USER-DEFINED NOT NULL,
  sub_category text,
  normal_balance USER-DEFINED NOT NULL,
  parent_account_id uuid,
  depth smallint NOT NULL DEFAULT 1 CHECK (depth >= 1 AND depth <= 4),
  is_system_account boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  locked_at timestamp with time zone,
  locked_reason text,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT accounts_pkey PRIMARY KEY (id),
  CONSTRAINT accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
  CONSTRAINT accounts_parent_account_id_fkey FOREIGN KEY (parent_account_id) REFERENCES public.accounts(id)
);
CREATE TABLE public.accounting_periods (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  fiscal_year integer NOT NULL,
  status USER-DEFINED NOT NULL DEFAULT 'open'::period_status,
  soft_closed_by uuid,
  soft_closed_at timestamp with time zone,
  closed_by uuid,
  closed_at timestamp with time zone,
  reopened_by uuid,
  reopened_at timestamp with time zone,
  reopen_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT accounting_periods_pkey PRIMARY KEY (id),
  CONSTRAINT accounting_periods_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.journal_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  entry_number bigint NOT NULL,
  period_id uuid NOT NULL,
  entry_date date NOT NULL,
  entry_type USER-DEFINED NOT NULL DEFAULT 'manual'::journal_entry_type,
  status USER-DEFINED NOT NULL DEFAULT 'draft'::journal_entry_status,
  narration text NOT NULL,
  reference_number text,
  reverses_entry_id uuid,
  reversed_by_entry_id uuid,
  recurring_template_id uuid,
  requires_approval boolean NOT NULL DEFAULT false,
  approved_by uuid,
  approved_at timestamp with time zone,
  rejected_by uuid,
  rejected_at timestamp with time zone,
  rejection_reason text,
  created_by uuid NOT NULL,
  posted_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT journal_entries_pkey PRIMARY KEY (id),
  CONSTRAINT journal_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
  CONSTRAINT journal_entries_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.accounting_periods(id),
  CONSTRAINT journal_entries_reverses_entry_id_fkey FOREIGN KEY (reverses_entry_id) REFERENCES public.journal_entries(id),
  CONSTRAINT journal_entries_reversed_by_entry_id_fkey FOREIGN KEY (reversed_by_entry_id) REFERENCES public.journal_entries(id),
  CONSTRAINT fk_journal_entries_recurring_template FOREIGN KEY (recurring_template_id) REFERENCES public.recurring_journal_templates(id)
);
CREATE TABLE public.journal_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL,
  line_number smallint NOT NULL,
  account_id uuid NOT NULL,
  debit numeric NOT NULL DEFAULT 0 CHECK (debit >= 0::numeric),
  credit numeric NOT NULL DEFAULT 0 CHECK (credit >= 0::numeric),
  description text,
  cost_center text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT journal_lines_pkey PRIMARY KEY (id),
  CONSTRAINT journal_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id),
  CONSTRAINT journal_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id)
);
CREATE TABLE public.journal_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size_bytes bigint,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT journal_attachments_pkey PRIMARY KEY (id),
  CONSTRAINT journal_attachments_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id)
);
CREATE TABLE public.recurring_journal_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  template_name text NOT NULL,
  narration_template text NOT NULL,
  frequency USER-DEFINED NOT NULL,
  start_date date NOT NULL,
  end_date date,
  next_run_date date NOT NULL,
  day_of_month smallint CHECK (day_of_month >= 1 AND day_of_month <= 31),
  auto_post boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT recurring_journal_templates_pkey PRIMARY KEY (id),
  CONSTRAINT recurring_journal_templates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.recurring_journal_template_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  line_number smallint NOT NULL,
  account_id uuid NOT NULL,
  debit numeric NOT NULL DEFAULT 0 CHECK (debit >= 0::numeric),
  credit numeric NOT NULL DEFAULT 0 CHECK (credit >= 0::numeric),
  description text,
  CONSTRAINT recurring_journal_template_lines_pkey PRIMARY KEY (id),
  CONSTRAINT recurring_journal_template_lines_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.recurring_journal_templates(id),
  CONSTRAINT recurring_journal_template_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id)
);
CREATE TABLE public.audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action USER-DEFINED NOT NULL,
  actor_id uuid NOT NULL,
  old_data jsonb,
  new_data jsonb,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT audit_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);