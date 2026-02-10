import { useEffect, useRef, useState, useCallback } from 'react';
import { RemoteParticipant, LocalParticipant } from 'livekit-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Mic, MicOff, Users, Crown, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RosterEntry {
  identity: string;
  name: string;
  role: 'presenter' | 'viewer';
  status: 'connected' | 'reconnecting';
  isLocal: boolean;
  isMuted: boolean;
}

interface ParticipantListProps {
  localParticipant: LocalParticipant | null;
  participants: RemoteParticipant[];
  isPresenter: boolean;
  onMuteParticipant?: (identity: string, muted: boolean) => void;
}

const GRACE_PERIOD_MS = 8000;

export function ParticipantList({ 
  localParticipant, 
  participants, 
  isPresenter,
  onMuteParticipant 
}: ParticipantListProps) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const knownIdentitiesRef = useRef<Set<string>>(new Set());
  const [newIdentities, setNewIdentities] = useState<Set<string>>(new Set());
  const [departingIdentities, setDepartingIdentities] = useState<Set<string>>(new Set());
  const graceTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const inferRole = (identity: string): 'presenter' | 'viewer' => {
    return identity.toLowerCase().includes('presenter') ? 'presenter' : 'viewer';
  };

  const getInitials = (name: string) => {
    const parts = name.split(/[\s-_]+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  // Build roster from live participants + grace-period ghosts
  const buildRoster = useCallback(() => {
    const liveEntries: RosterEntry[] = [];

    if (localParticipant) {
      liveEntries.push({
        identity: localParticipant.identity,
        name: localParticipant.name || 'You',
        role: inferRole(localParticipant.identity),
        status: 'connected',
        isLocal: true,
        isMuted: !localParticipant.isMicrophoneEnabled,
      });
    }

    for (const p of participants) {
      liveEntries.push({
        identity: p.identity,
        name: p.name || p.identity,
        role: inferRole(p.identity),
        status: 'connected',
        isLocal: false,
        isMuted: !p.isMicrophoneEnabled,
      });
    }

    setRoster(prev => {
      // Merge: keep grace-period entries that aren't in live list
      const liveIds = new Set(liveEntries.map(e => e.identity));
      const ghosts = prev.filter(e => e.status === 'reconnecting' && !liveIds.has(e.identity));
      
      const merged = [...liveEntries, ...ghosts];

      // Sort: presenter first, then alphabetical
      merged.sort((a, b) => {
        if (a.isLocal && !b.isLocal) return -1;
        if (!a.isLocal && b.isLocal) return 1;
        if (a.role === 'presenter' && b.role !== 'presenter') return -1;
        if (a.role !== 'presenter' && b.role === 'presenter') return 1;
        return a.name.localeCompare(b.name);
      });

      return merged;
    });

    return liveEntries;
  }, [localParticipant, participants]);

  // Handle participant changes with grace period
  useEffect(() => {
    const liveEntries = buildRoster();
    const currentIds = new Set(liveEntries.map(e => e.identity));

    // Detect new arrivals
    const arrivals = new Set<string>();
    currentIds.forEach(id => {
      if (!knownIdentitiesRef.current.has(id)) {
        arrivals.add(id);
        // Cancel grace timer if they came back
        const timer = graceTimersRef.current.get(id);
        if (timer) {
          clearTimeout(timer);
          graceTimersRef.current.delete(id);
          setDepartingIdentities(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      }
    });

    if (arrivals.size > 0) {
      setNewIdentities(arrivals);
      const timeout = setTimeout(() => setNewIdentities(new Set()), 700);
      // cleanup handled by effect
      setTimeout(() => clearTimeout(timeout), 800);
    }

    // Detect departures — start grace period
    knownIdentitiesRef.current.forEach(id => {
      if (!currentIds.has(id) && !graceTimersRef.current.has(id)) {
        // Mark as reconnecting
        setRoster(prev => prev.map(e => 
          e.identity === id ? { ...e, status: 'reconnecting' as const } : e
        ));
        setDepartingIdentities(prev => new Set(prev).add(id));

        // Start grace timer
        const timer = setTimeout(() => {
          // Remove after grace period
          setDepartingIdentities(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          setRoster(prev => prev.filter(e => e.identity !== id));
          graceTimersRef.current.delete(id);
        }, GRACE_PERIOD_MS);

        graceTimersRef.current.set(id, timer);
      }
    });

    knownIdentitiesRef.current = currentIds;
  }, [buildRoster]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      graceTimersRef.current.forEach(timer => clearTimeout(timer));
      graceTimersRef.current.clear();
    };
  }, []);

  if (roster.length === 0) {
    return null;
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="w-4 h-4" />
          Participants ({roster.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {roster.map((entry) => {
          const isNew = newIdentities.has(entry.identity);
          const isDeparting = departingIdentities.has(entry.identity);
          const isReconnecting = entry.status === 'reconnecting';
          const isPresenterRole = entry.role === 'presenter';

          return (
            <div 
              key={entry.identity}
              className={cn(
                'flex items-center justify-between p-2 rounded-lg transition-all duration-500',
                entry.isLocal ? 'bg-primary/10' : 'bg-muted/50',
                isNew && 'animate-slide-in ring-1 ring-primary/30',
                isReconnecting && 'opacity-50',
                isDeparting && 'animate-fade-out'
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Avatar className={cn(
                  'w-8 h-8 shrink-0',
                  isPresenterRole && 'ring-2 ring-primary/50'
                )}>
                  <AvatarFallback className={cn(
                    'text-xs font-medium',
                    isPresenterRole ? 'bg-primary text-primary-foreground' : 'bg-secondary'
                  )}>
                    {isPresenterRole ? (
                      <Crown className="w-4 h-4" />
                    ) : (
                      getInitials(entry.name)
                    )}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-medium truncate">
                      {entry.name}
                    </p>
                    {entry.isLocal && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                        You
                      </Badge>
                    )}
                    {isPresenterRole && (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                        Host
                      </Badge>
                    )}
                  </div>
                  {isReconnecting && (
                    <p className="text-[10px] text-status-waiting flex items-center gap-1">
                      <WifiOff className="w-3 h-3" />
                      Reconnecting…
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {!isReconnecting && (
                  <div className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center',
                    entry.isMuted ? 'bg-destructive/20 text-destructive' : 'bg-status-live/20 text-status-live'
                  )}>
                    {entry.isMuted ? (
                      <MicOff className="w-3 h-3" />
                    ) : (
                      <Mic className="w-3 h-3" />
                    )}
                  </div>
                )}

                {isReconnecting && (
                  <div className="w-6 h-6 rounded-full flex items-center justify-center bg-status-waiting/20 text-status-waiting">
                    <Wifi className="w-3 h-3 animate-pulse" />
                  </div>
                )}

                {isPresenter && !entry.isLocal && !isReconnecting && onMuteParticipant && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => onMuteParticipant(entry.identity, !entry.isMuted)}
                  >
                    {entry.isMuted ? 'Unmute' : 'Mute'}
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
