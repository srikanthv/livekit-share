import { useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import { Maximize, Minimize, Loader2, Monitor, MonitorOff, WifiOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ConnectionStatus } from '@/hooks/useLiveKitRoom';

interface VideoDisplayProps {
  track: Track | null;
  status: ConnectionStatus;
  className?: string;
  onRetry?: () => void;
  onRejoin?: () => void;
  reconnectAttempts?: number;
}

export function VideoDisplay({ 
  track, 
  status, 
  className,
  onRetry,
  onRejoin,
  reconnectAttempts = 0
}: VideoDisplayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (track && videoRef.current) {
      track.attach(videoRef.current);
      return () => {
        track.detach(videoRef.current!);
      };
    }
  }, [track]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await containerRef.current.requestFullscreen();
    }
  };

  const statusConfig: Record<ConnectionStatus, { label: string; color: string; bg: string }> = {
    idle: { label: 'Ready', color: 'text-muted-foreground', bg: 'bg-muted' },
    connecting: { label: 'Connecting...', color: 'text-status-connecting', bg: 'bg-status-connecting/10' },
    connected: { label: 'Connected', color: 'text-status-connecting', bg: 'bg-status-connecting/10' },
    publishing: { label: 'Setting up media...', color: 'text-status-connecting', bg: 'bg-status-connecting/10' },
    waiting: { label: 'Waiting for stream...', color: 'text-status-waiting', bg: 'bg-status-waiting/10' },
    live: { label: 'Live', color: 'text-status-live', bg: 'bg-status-live/10' },
    reconnecting: { label: `Reconnecting${reconnectAttempts > 0 ? ` (${reconnectAttempts})` : ''}...`, color: 'text-status-waiting', bg: 'bg-status-waiting/10' },
    failed: { label: 'Connection Failed', color: 'text-status-error', bg: 'bg-status-error/10' },
    ended: { label: 'Stream Ended', color: 'text-muted-foreground', bg: 'bg-muted' },
    error: { label: 'Error', color: 'text-status-error', bg: 'bg-status-error/10' },
  };

  const currentStatus = statusConfig[status];
  const showRecoveryOptions = status === 'failed' || status === 'error';
  const isReconnecting = status === 'reconnecting';

  return (
    <div 
      ref={containerRef}
      className={cn(
        'video-container aspect-video bg-black relative group',
        status === 'live' && 'glow-live',
        className
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
        className={cn(
          'w-full h-full object-contain',
          !track && 'hidden'
        )}
      />

      {/* Placeholder when no video */}
      {!track && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {status === 'connecting' || status === 'publishing' ? (
            <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
          ) : status === 'reconnecting' ? (
            <RefreshCw className="w-12 h-12 text-status-waiting animate-spin mb-4" />
          ) : status === 'waiting' ? (
            <Monitor className="w-16 h-16 text-muted-foreground/50 mb-4" />
          ) : status === 'ended' ? (
            <MonitorOff className="w-16 h-16 text-muted-foreground/50 mb-4" />
          ) : status === 'failed' || status === 'error' ? (
            <WifiOff className="w-16 h-16 text-status-error/50 mb-4" />
          ) : (
            <Monitor className="w-16 h-16 text-muted-foreground/50 mb-4" />
          )}
          <p className="text-muted-foreground text-lg mb-4">{currentStatus.label}</p>
          
          {/* Recovery buttons */}
          {showRecoveryOptions && (
            <div className="flex gap-3">
              {onRetry && (
                <Button variant="secondary" onClick={onRetry}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry Connection
                </Button>
              )}
              {onRejoin && (
                <Button variant="default" onClick={onRejoin} className="glow-primary">
                  Rejoin Meeting
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reconnecting banner */}
      {isReconnecting && (
        <div className="absolute top-0 left-0 right-0 bg-status-waiting/90 text-white py-2 px-4 flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Reconnecting... {reconnectAttempts > 0 && `(Attempt ${reconnectAttempts})`}</span>
        </div>
      )}

      {/* Status badge */}
      <div className="absolute top-4 left-4">
        <span className={cn(
          'status-badge inline-flex items-center gap-2',
          currentStatus.bg,
          currentStatus.color
        )}>
          {status === 'live' && (
            <span className="w-2 h-2 bg-status-live rounded-full animate-pulse" />
          )}
          {(status === 'connecting' || status === 'publishing') && (
            <Loader2 className="w-3 h-3 animate-spin" />
          )}
          {status === 'reconnecting' && (
            <RefreshCw className="w-3 h-3 animate-spin" />
          )}
          {currentStatus.label}
        </span>
      </div>

      {/* Fullscreen button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/70"
        onClick={toggleFullscreen}
      >
        {isFullscreen ? (
          <Minimize className="w-5 h-5" />
        ) : (
          <Maximize className="w-5 h-5" />
        )}
      </Button>
    </div>
  );
}
