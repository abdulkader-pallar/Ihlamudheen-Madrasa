-- Migration: Add phone and bio columns to users table
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard > SQL Editor)

-- 1. Add missing columns
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio text;

-- 2. Add INSERT policy so upsert works for users saving their own profile
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'Users: insert own row'
  ) THEN
    CREATE POLICY "Users: insert own row"
      ON public.profiles FOR INSERT
      WITH CHECK (auth.uid() = id);
  END IF;
END
$$;

-- 3. Create avatars storage bucket (if it doesn't exist)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 4. Storage policies for avatars bucket
DO $$
BEGIN
  -- Allow authenticated users to upload their own avatar
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND policyname = 'Avatar upload'
  ) THEN
    CREATE POLICY "Avatar upload"
      ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'avatars'
        AND auth.uid()::text = (storage.foldername(name))[1]
      );
  END IF;

  -- Allow authenticated users to update their own avatar
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND policyname = 'Avatar update'
  ) THEN
    CREATE POLICY "Avatar update"
      ON storage.objects FOR UPDATE
      USING (
        bucket_id = 'avatars'
        AND auth.uid()::text = (storage.foldername(name))[1]
      );
  END IF;

  -- Allow anyone to read avatars (public bucket)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND policyname = 'Avatar public read'
  ) THEN
    CREATE POLICY "Avatar public read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'avatars');
  END IF;
END
$$;
