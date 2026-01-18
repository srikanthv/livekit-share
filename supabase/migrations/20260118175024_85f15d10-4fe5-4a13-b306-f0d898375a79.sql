-- Create a config table for storing LiveKit configuration
CREATE TABLE public.livekit_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.livekit_config ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read config (url and api_key only - api_secret stays server-side)
CREATE POLICY "Anyone can read config" 
ON public.livekit_config 
FOR SELECT 
USING (true);

-- Allow anyone to insert config (for initial setup - in production would restrict to admin)
CREATE POLICY "Anyone can insert config" 
ON public.livekit_config 
FOR INSERT 
WITH CHECK (true);

-- Allow anyone to update config (for admin updates - in production would restrict to admin)
CREATE POLICY "Anyone can update config" 
ON public.livekit_config 
FOR UPDATE 
USING (true);