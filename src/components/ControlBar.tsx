import { Button } from '@/components/ui/button';
import { 
  Mic, 
  MicOff, 
  Monitor, 
  MonitorOff, 
  Volume2, 
  VolumeX,
  PhoneOff,
  Settings
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ControlBarProps {
  role: 'presenter' | 'viewer';
  isMicEnabled: boolean;
  isSpeakerEnabled: boolean;
  isScreenSharing: boolean;
  isConnected: boolean;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
  onStartScreenShare?: () => void;
  onStopScreenShare?: () => void;
  onDisconnect: () => void;
  onOpenSettings?: () => void;
  isAdmin?: boolean;
}

export function ControlBar({
  role,
  isMicEnabled,
  isSpeakerEnabled,
  isScreenSharing,
  isConnected,
  onToggleMic,
  onToggleSpeaker,
  onStartScreenShare,
  onStopScreenShare,
  onDisconnect,
  onOpenSettings,
  isAdmin,
}: ControlBarProps) {
  return (
    <div className="flex items-center justify-center gap-3 p-4 bg-card/80 backdrop-blur-sm rounded-2xl border border-border/50">
      {/* Microphone */}
      <Button
        variant={isMicEnabled ? 'default' : 'secondary'}
        size="lg"
        className={cn(
          'rounded-full w-14 h-14',
          isMicEnabled && 'glow-primary'
        )}
        onClick={onToggleMic}
        disabled={!isConnected}
      >
        {isMicEnabled ? (
          <Mic className="w-6 h-6" />
        ) : (
          <MicOff className="w-6 h-6" />
        )}
      </Button>

      {/* Speaker */}
      <Button
        variant={isSpeakerEnabled ? 'default' : 'secondary'}
        size="lg"
        className="rounded-full w-14 h-14"
        onClick={onToggleSpeaker}
        disabled={!isConnected}
      >
        {isSpeakerEnabled ? (
          <Volume2 className="w-6 h-6" />
        ) : (
          <VolumeX className="w-6 h-6" />
        )}
      </Button>

      {/* Screen Share (Presenter only) */}
      {role === 'presenter' && (
        <Button
          variant={isScreenSharing ? 'destructive' : 'default'}
          size="lg"
          className={cn(
            'rounded-full w-14 h-14',
            isScreenSharing && 'animate-pulse'
          )}
          onClick={isScreenSharing ? onStopScreenShare : onStartScreenShare}
          disabled={!isConnected}
        >
          {isScreenSharing ? (
            <MonitorOff className="w-6 h-6" />
          ) : (
            <Monitor className="w-6 h-6" />
          )}
        </Button>
      )}

      {/* Disconnect */}
      <Button
        variant="destructive"
        size="lg"
        className="rounded-full w-14 h-14"
        onClick={onDisconnect}
        disabled={!isConnected}
      >
        <PhoneOff className="w-6 h-6" />
      </Button>

      {/* Settings (Admin only) */}
      {isAdmin && onOpenSettings && (
        <Button
          variant="ghost"
          size="lg"
          className="rounded-full w-14 h-14"
          onClick={onOpenSettings}
        >
          <Settings className="w-6 h-6" />
        </Button>
      )}
    </div>
  );
}
