import { useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import { Maximize, Minimize, Loader2, Monitor, MonitorOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ConnectionStatus } from '@/hooks/useLiveKitRoom';

interface VideoDisplayProps {
  track: Track | null;
  status: ConnectionStatus;
  className?: string;
}

export function VideoDisplay({ track, status, className }: VideoDisplayProps) {
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

  const statusConfig = {
    idle: { label: 'Ready', color: 'text-muted-foreground', bg: 'bg-muted' },
    connecting: { label: 'Connecting...', color: 'text-status-connecting', bg: 'bg-status-connecting/10' },
    connected: { label: 'Connected', color: 'text-status-connecting', bg: 'bg-status-connecting/10' },
    waiting: { label: 'Waiting for stream...', color: 'text-status-waiting', bg: 'bg-status-waiting/10' },
    live: { label: 'Live', color: 'text-status-live', bg: 'bg-status-live/10' },
    ended: { label: 'Stream Ended', color: 'text-muted-foreground', bg: 'bg-muted' },
    error: { label: 'Error', color: 'text-status-error', bg: 'bg-status-error/10' },
  };

  const currentStatus = statusConfig[status];

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
          {status === 'connecting' ? (
            <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
          ) : status === 'waiting' ? (
            <Monitor className="w-16 h-16 text-muted-foreground/50 mb-4" />
          ) : status === 'ended' ? (
            <MonitorOff className="w-16 h-16 text-muted-foreground/50 mb-4" />
          ) : (
            <Monitor className="w-16 h-16 text-muted-foreground/50 mb-4" />
          )}
          <p className="text-muted-foreground text-lg">{currentStatus.label}</p>
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
          {status === 'connecting' && (
            <Loader2 className="w-3 h-3 animate-spin" />
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
