import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface LiveKitConfig {
  configured: boolean;
  url?: string;
  apiKey?: string;
  updatedAt?: string;
}

export function useLiveKitConfig() {
  const [config, setConfig] = useState<LiveKitConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data, error: fnError } = await supabase.functions.invoke('get-config');
      
      if (fnError) {
        throw new Error(fnError.message);
      }
      
      setConfig(data);
    } catch (err) {
      console.error('Error fetching config:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch config');
    } finally {
      setLoading(false);
    }
  }, []);

  const saveConfig = useCallback(async (url: string, apiKey: string, apiSecret: string) => {
    try {
      setLoading(true);
      setError(null);
      
      const { data, error: fnError } = await supabase.functions.invoke('save-config', {
        body: { url, apiKey, apiSecret },
      });
      
      if (fnError) {
        throw new Error(fnError.message);
      }
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Refresh config after save
      await fetchConfig();
      return true;
    } catch (err) {
      console.error('Error saving config:', err);
      setError(err instanceof Error ? err.message : 'Failed to save config');
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchConfig]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return {
    config,
    loading,
    error,
    fetchConfig,
    saveConfig,
  };
}
