import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveKitConfig } from '@/hooks/useLiveKitConfig';
import { useLiveKitRoom } from '@/hooks/useLiveKitRoom';
import { VideoDisplay } from '@/components/VideoDisplay';
import { ControlBar } from '@/components/ControlBar';
import { ParticipantList } from '@/components/ParticipantList';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Loader2, AlertCircle } from 'lucide-react';

export default function ViewerPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  
  const { config, loading: configLoading, error: configError } = useLiveKitConfig();
  
  const {
    status,
    error: roomError,
    participants,
    localParticipant,
    screenTrack,
    isMicEnabled,
    isSpeakerEnabled,
    connect,
    disconnect,
    toggleMicrophone,
    toggleSpeaker,
  } = useLiveKitRoom({
    roomId: roomId || '',
    role: 'viewer',
    livekitUrl: config?.url || '',
  });

  // Auto-connect when config is ready
  useEffect(() => {
    if (config?.configured && config.url && roomId && status === 'idle') {
      connect();
    }
  }, [config?.configured, config?.url, roomId, status, connect]);

  // Redirect if no roomId
  if (!roomId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md border-border/50 bg-card/50">
          <CardContent className="flex flex-col items-center py-8">
            <AlertCircle className="w-12 h-12 text-status-error mb-4" />
            <CardTitle className="text-lg mb-2">Invalid Room</CardTitle>
            <CardDescription className="text-center mb-4">
              No room ID was provided. Please use a valid viewer link from the presenter.
            </CardDescription>
            <Button onClick={() => navigate('/')}>Go Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show loading
  if (configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading configuration...</p>
        </div>
      </div>
    );
  }

  // Show error if not configured
  if (!config?.configured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md border-border/50 bg-card/50">
          <CardContent className="flex flex-col items-center py-8">
            <AlertCircle className="w-12 h-12 text-status-error mb-4" />
            <CardTitle className="text-lg mb-2">Not Configured</CardTitle>
            <CardDescription className="text-center">
              LiveKit has not been configured yet. Please ask the presenter to set it up first.
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isConnected = status === 'waiting' || status === 'live' || status === 'connected';

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Viewer</h1>
          <p className="text-muted-foreground">Room: {roomId}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Video */}
          <div className="lg:col-span-3 space-y-4">
            <VideoDisplay 
              track={screenTrack} 
              status={status} 
            />

            {/* Error display */}
            {roomError && (
              <Card className="border-status-error/50 bg-status-error/10">
                <CardContent className="flex items-center gap-3 py-4">
                  <AlertCircle className="w-5 h-5 text-status-error" />
                  <p className="text-status-error">{roomError}</p>
                </CardContent>
              </Card>
            )}

            {/* Controls */}
            {isConnected && (
              <div className="flex justify-center">
                <ControlBar
                  role="viewer"
                  isMicEnabled={isMicEnabled}
                  isSpeakerEnabled={isSpeakerEnabled}
                  isScreenSharing={false}
                  isConnected={isConnected}
                  onToggleMic={toggleMicrophone}
                  onToggleSpeaker={toggleSpeaker}
                  onDisconnect={disconnect}
                />
              </div>
            )}

            {/* Reconnect button if ended */}
            {status === 'ended' && (
              <div className="flex justify-center">
                <Button onClick={connect} size="lg" className="glow-primary">
                  Reconnect
                </Button>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <ParticipantList
              localParticipant={localParticipant}
              participants={participants}
              isPresenter={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
