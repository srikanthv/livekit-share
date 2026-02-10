import { useEffect, useRef, useState } from 'react';
import { RemoteParticipant, LocalParticipant } from 'livekit-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mic, MicOff, User, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ParticipantListProps {
  localParticipant: LocalParticipant | null;
  participants: RemoteParticipant[];
  isPresenter: boolean;
  onMuteParticipant?: (identity: string, muted: boolean) => void;
}

export function ParticipantList({ 
  localParticipant, 
  participants, 
  isPresenter,
  onMuteParticipant 
}: ParticipantListProps) {
  // Track known identities to animate new arrivals
  const knownIdentitiesRef = useRef<Set<string>>(new Set());
  const [newIdentities, setNewIdentities] = useState<Set<string>>(new Set());

  const allParticipants = [
    localParticipant ? { 
      identity: localParticipant.identity, 
      name: localParticipant.name || 'You',
      isLocal: true,
      isMuted: !localParticipant.isMicrophoneEnabled,
    } : null,
    ...participants.map(p => ({
      identity: p.identity,
      name: p.name || p.identity,
      isLocal: false,
      isMuted: !p.isMicrophoneEnabled,
    }))
  ].filter(Boolean);

  // Detect new arrivals for animation
  useEffect(() => {
    const currentIds = new Set(allParticipants.map(p => p!.identity));
    const arrivals = new Set<string>();
    
    currentIds.forEach(id => {
      if (!knownIdentitiesRef.current.has(id)) {
        arrivals.add(id);
      }
    });

    if (arrivals.size > 0) {
      setNewIdentities(arrivals);
      // Clear animation class after transition
      const timeout = setTimeout(() => setNewIdentities(new Set()), 700);
      knownIdentitiesRef.current = currentIds;
      return () => clearTimeout(timeout);
    }

    knownIdentitiesRef.current = currentIds;
  }, [allParticipants.length]);

  if (allParticipants.length === 0) {
    return null;
  }

  const getInitials = (name: string) => {
    const parts = name.split(/[\s-_]+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <User className="w-4 h-4" />
          Participants ({allParticipants.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {allParticipants.map((participant) => {
          const isNew = newIdentities.has(participant!.identity);
          const isPresenterRole = participant!.identity.includes('presenter');

          return (
            <div 
              key={participant!.identity}
              className={cn(
                'flex items-center justify-between p-2 rounded-lg transition-all duration-500',
                participant!.isLocal ? 'bg-primary/10' : 'bg-muted/50',
                isNew && 'animate-slide-in ring-1 ring-primary/30'
              )}
            >
              <div className="flex items-center gap-2">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium',
                  isPresenterRole ? 'bg-primary text-primary-foreground' : 'bg-secondary'
                )}>
                  {isPresenterRole ? (
                    <Crown className="w-4 h-4" />
                  ) : (
                    getInitials(participant!.name)
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {participant!.name}
                    {participant!.isLocal && (
                      <span className="text-muted-foreground ml-1">(You)</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center',
                  participant!.isMuted ? 'bg-destructive/20 text-destructive' : 'bg-status-live/20 text-status-live'
                )}>
                  {participant!.isMuted ? (
                    <MicOff className="w-3 h-3" />
                  ) : (
                    <Mic className="w-3 h-3" />
                  )}
                </div>

                {isPresenter && !participant!.isLocal && onMuteParticipant && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => onMuteParticipant(participant!.identity, !participant!.isMuted)}
                  >
                    {participant!.isMuted ? 'Unmute' : 'Mute'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
