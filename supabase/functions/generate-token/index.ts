import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AccessToken } from "https://esm.sh/livekit-server-sdk@2.6.1";

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

    const { roomId, role, identity } = await req.json();

    if (!roomId || !role) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: roomId, role' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Generating token for room: ${roomId}, role: ${role}`);

    // Fetch config with secret
    const { data: config, error: configError } = await supabase
      .from('livekit_config')
      .select('api_key, api_secret')
      .limit(1)
      .single();

    if (configError || !config) {
      console.error('No LiveKit config found');
      return new Response(
        JSON.stringify({ error: 'LiveKit not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate participant identity
    const participantIdentity = identity || `${role}-${crypto.randomUUID().slice(0, 8)}`;

    // Create access token
    const token = new AccessToken(config.api_key, config.api_secret, {
      identity: participantIdentity,
      name: role === 'presenter' ? 'Presenter' : `Viewer ${participantIdentity.slice(-4)}`,
    });

    // Grant permissions based on role
    token.addGrant({
      room: roomId,
      roomJoin: true,
      canPublish: true, // Both can publish audio
      canSubscribe: true,
      canPublishData: true,
      // Presenter gets admin permissions
      roomAdmin: role === 'presenter',
      canUpdateOwnMetadata: true,
    });

    const jwt = await token.toJwt();
    console.log('Token generated successfully');

    return new Response(
      JSON.stringify({ 
        token: jwt,
        identity: participantIdentity,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in generate-token:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
