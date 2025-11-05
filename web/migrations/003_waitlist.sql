-- Waitlist Migration
-- Date: 2025-01-04
-- Purpose: Create waitlist table for beta signups

CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT waitlist_email_check CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Create index for email lookups
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at DESC);

-- Enable Row Level Security
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Public can insert, no one can read (admin only via service role)
DROP POLICY IF EXISTS "Anyone can join waitlist" ON waitlist;
DROP POLICY IF EXISTS "Service role can manage waitlist" ON waitlist;

CREATE POLICY "Anyone can join waitlist" ON waitlist FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Service role can manage waitlist" ON waitlist FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON TABLE waitlist IS 'Email waitlist for beta signups. Public can insert, only service role can read.';
