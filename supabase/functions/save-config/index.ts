import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { url, apiKey, apiSecret } = await req.json();

    if (!url || !apiKey || !apiSecret) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: url, apiKey, apiSecret' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Saving LiveKit config...');

    // Check if config exists
    const { data: existing } = await supabase
      .from('livekit_config')
      .select('id')
      .limit(1)
      .single();

    if (existing) {
      // Update existing
      const { error } = await supabase
        .from('livekit_config')
        .update({
          url,
          api_key: apiKey,
          api_secret: apiSecret,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) throw error;
      console.log('Config updated successfully');
    } else {
      // Insert new
      const { error } = await supabase
        .from('livekit_config')
        .insert({
          url,
          api_key: apiKey,
          api_secret: apiSecret,
        });

      if (error) throw error;
      console.log('Config created successfully');
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in save-config:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
