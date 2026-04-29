-- Add 'starter' value to the subscription_plan enum
-- This needs to be committed before it can be used in other commands within the same transaction
ALTER TYPE public.subscription_plan ADD VALUE IF NOT EXISTS 'starter';
