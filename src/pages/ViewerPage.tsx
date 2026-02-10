import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveKitConfig } from '@/hooks/useLiveKitConfig';
import { useLiveKitRoom } from '@/hooks/useLiveKitRoom';
import { useLiveKitChat } from '@/hooks/useLiveKitChat';
import { usePresenterSignal } from '@/hooks/usePresenterSignal';
import { VideoDisplay } from '@/components/VideoDisplay';
import { ControlBar } from '@/components/ControlBar';
import { ParticipantList } from '@/components/ParticipantList';
import { LiveKitChatPanel } from '@/components/LiveKitChatPanel';
import { ViewerLobby } from '@/components/ViewerLobby';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Loader2, AlertCircle } from 'lucide-react';

export default function ViewerPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  
  const { config, loading: configLoading } = useLiveKitConfig();
  
  const {
    status,
    error: roomError,
    participants,
    localParticipant,
    screenTrack,
    isMicEnabled,
    isSpeakerEnabled,
    reconnectAttempts,
    connect,
    disconnect,
    rejoin,
    restartAudio,
    toggleMicrophone,
    toggleSpeaker,
    room,
  } = useLiveKitRoom({
    roomId: roomId || '',
    role: 'viewer',
    livekitUrl: config?.url || '',
  });

  const isConnected = ['waiting', 'live', 'connected', 'publishing', 'reconnecting'].includes(status);

  // Presenter-ready lobby gate
  const { presenterReady } = usePresenterSignal({
    room,
    role: 'viewer',
    isConnected,
  });

  const localIdentity = localParticipant?.identity || `viewer-${Date.now()}`;
  const hasJoinedRef = useRef(false);
  
  const { 
    messages, 
    sendMessage, 
    sendSystemMessage,
    clearMessages,
  } = useLiveKitChat({
    room,
    localIdentity,
    role: 'viewer',
  });

  // Auto-connect when config is ready — no "Join" button needed
  useEffect(() => {
    if (config?.configured && config.url && roomId && status === 'idle') {
      connect();
    }
  }, [config?.configured, config?.url, roomId, status, connect]);

  // Send join message when connected (only once per session)
  useEffect(() => {
    const isConnectedState = ['connected', 'publishing', 'waiting', 'live'].includes(status);
    if (isConnectedState && !hasJoinedRef.current && localIdentity) {
      hasJoinedRef.current = true;
      const timeout = setTimeout(() => {
        sendSystemMessage(`${localIdentity} joined the room`);
      }, 500);
      return () => clearTimeout(timeout);
    }
    if (status === 'ended') {
      hasJoinedRef.current = false;
      clearMessages();
    }
  }, [status, localIdentity, sendSystemMessage, clearMessages]);

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
          </CardContent>
        </Card>
      </div>
    );
  }

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

  // Show connecting state while auto-joining
  const isJoining = status === 'connecting' || status === 'idle';
  const inLobby = isConnected && !presenterReady;
  const inActiveMeeting = isConnected && presenterReady;

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Viewer</h1>
          <p className="text-muted-foreground">Room: {roomId}</p>
        </div>

        {/* Auto-joining spinner */}
        {isJoining && (
          <div className="flex justify-center py-12">
            <div className="text-center">
              <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Joining meeting…</p>
            </div>
          </div>
        )}

        {/* Lobby: connected but waiting for presenter */}
        {inLobby && (
          <ViewerLobby
            participantCount={participants.length}
            onDisconnect={disconnect}
          />
        )}

        {/* Active meeting: presenter is present */}
        {inActiveMeeting && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3 space-y-4">
              <VideoDisplay 
                track={screenTrack} 
                status={status}
                reconnectAttempts={reconnectAttempts}
                onRetry={connect}
                onRejoin={rejoin}
              />

              {roomError && (
                <Card className="border-status-error/50 bg-status-error/10">
                  <CardContent className="flex items-center gap-3 py-4">
                    <AlertCircle className="w-5 h-5 text-status-error" />
                    <p className="text-status-error">{roomError}</p>
                  </CardContent>
                </Card>
              )}

              <div className="flex justify-center">
                <ControlBar
                  role="viewer"
                  isMicEnabled={isMicEnabled}
                  isSpeakerEnabled={isSpeakerEnabled}
                  isScreenSharing={false}
                  isConnected={isConnected}
                  status={status}
                  onToggleMic={toggleMicrophone}
                  onToggleSpeaker={toggleSpeaker}
                  onDisconnect={disconnect}
                  onRestartAudio={restartAudio}
                  onRejoin={rejoin}
                />
              </div>
            </div>

            <div className="space-y-4">
              <ParticipantList localParticipant={localParticipant} participants={participants} isPresenter={false} />
            </div>
          </div>
        )}

        {/* Ended state */}
        {status === 'ended' && (
          <div className="flex justify-center py-12">
            <div className="text-center space-y-3">
              <p className="text-muted-foreground">The meeting has ended.</p>
              <button
                onClick={connect}
                className="text-primary hover:underline text-sm"
              >
                Reconnect
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Chat Panel - available in lobby and active meeting */}
      {isConnected && (
        <LiveKitChatPanel
          messages={messages}
          onSendMessage={sendMessage}
          localIdentity={localIdentity}
        />
      )}
    </div>
  );
}
