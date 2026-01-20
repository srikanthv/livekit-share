import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useLiveKitConfig } from '@/hooks/useLiveKitConfig';
import { useLiveKitRoom } from '@/hooks/useLiveKitRoom';
import { ConfigSetup } from '@/components/ConfigSetup';
import { VideoDisplay } from '@/components/VideoDisplay';
import { ControlBar } from '@/components/ControlBar';
import { ParticipantList } from '@/components/ParticipantList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, Check, Link2, Loader2, Settings } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export default function PresenterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const roomId = searchParams.get('roomId') || `room-${Date.now()}`;
  
  const { config, loading: configLoading, error: configError, saveConfig } = useLiveKitConfig();
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const {
    status,
    error: roomError,
    participants,
    localParticipant,
    screenTrack,
    isMicEnabled,
    isSpeakerEnabled,
    isScreenSharing,
    reconnectAttempts,
    connect,
    disconnect,
    rejoin,
    restartAudio,
    startScreenShare,
    stopScreenShare,
    toggleMicrophone,
    toggleSpeaker,
    muteParticipant,
  } = useLiveKitRoom({
    roomId,
    role: 'presenter',
    livekitUrl: config?.url || '',
  });

  useEffect(() => {
    if (!searchParams.get('roomId')) {
      navigate(`/presenter?roomId=${roomId}`, { replace: true });
    }
  }, [roomId, navigate, searchParams]);

  const viewerUrl = `${window.location.origin}/viewer/${roomId}`;

  const copyViewerLink = () => {
    navigator.clipboard.writeText(viewerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!config?.configured) {
    return <ConfigSetup onSave={saveConfig} loading={configLoading} error={configError} />;
  }

  const isConnected = ['waiting', 'live', 'connected', 'publishing', 'reconnecting'].includes(status);

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Presenter View</h1>
            <p className="text-muted-foreground">Room: {roomId}</p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-card/50 border border-border/50 rounded-lg p-2">
              <Link2 className="w-4 h-4 text-muted-foreground" />
              <Input readOnly value={viewerUrl} className="w-64 h-8 bg-transparent border-0 text-sm" />
              <Button variant="ghost" size="sm" onClick={copyViewerLink} className="h-8">
                {copied ? <Check className="w-4 h-4 text-status-live" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>

            <Dialog open={showSettings} onOpenChange={setShowSettings}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon"><Settings className="w-5 h-5" /></Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Edit LiveKit Configuration</DialogTitle></DialogHeader>
                <ConfigSetup 
                  onSave={async (url, apiKey, apiSecret) => {
                    const result = await saveConfig(url, apiKey, apiSecret);
                    if (result) setShowSettings(false);
                    return result;
                  }} 
                  loading={configLoading} 
                  error={configError}
                />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-4">
            <VideoDisplay 
              track={screenTrack} 
              status={status}
              reconnectAttempts={reconnectAttempts}
              onRetry={connect}
              onRejoin={rejoin}
            />

            {!isConnected && status !== 'failed' && status !== 'error' ? (
              <Card className="border-border/50 bg-card/50">
                <CardContent className="flex flex-col items-center py-8">
                  <CardTitle className="text-lg mb-2">Ready to Present?</CardTitle>
                  <CardDescription className="text-center mb-4">
                    Connect to the room and start sharing your screen with viewers.
                  </CardDescription>
                  <Button size="lg" onClick={connect} disabled={status === 'connecting'} className="glow-primary">
                    {status === 'connecting' ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Connecting...</>) : 'Start Session'}
                  </Button>
                  {roomError && <p className="text-destructive text-sm mt-4">{roomError}</p>}
                </CardContent>
              </Card>
            ) : (
              <div className="flex justify-center">
                <ControlBar
                  role="presenter"
                  isMicEnabled={isMicEnabled}
                  isSpeakerEnabled={isSpeakerEnabled}
                  isScreenSharing={isScreenSharing}
                  isConnected={isConnected}
                  status={status}
                  onToggleMic={toggleMicrophone}
                  onToggleSpeaker={toggleSpeaker}
                  onStartScreenShare={startScreenShare}
                  onStopScreenShare={stopScreenShare}
                  onDisconnect={disconnect}
                  onRestartAudio={restartAudio}
                  onRejoin={rejoin}
                />
              </div>
            )}
          </div>

          <div className="space-y-4">
            <ParticipantList localParticipant={localParticipant} participants={participants} isPresenter={true} onMuteParticipant={muteParticipant} />
          </div>
        </div>
      </div>
    </div>
  );
}
