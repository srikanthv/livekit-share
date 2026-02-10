import { Loader2, Users, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface ViewerLobbyProps {
  participantCount: number;
  onDisconnect: () => void;
}

/**
 * Lobby screen shown to viewers while waiting for the presenter to join.
 * The viewer is connected to LiveKit but media subscriptions are gated
 * behind the presenter-ready signal.
 */
export function ViewerLobby({ participantCount, onDisconnect }: ViewerLobbyProps) {
  return (
    <div className="flex justify-center py-12">
      <Card className="max-w-md w-full border-border/50 bg-card/50">
        <CardContent className="flex flex-col items-center py-10 space-y-6">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <Monitor className="w-10 h-10 text-primary/60" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-card border-2 border-border flex items-center justify-center">
              <Loader2 className="w-3.5 h-3.5 text-status-waiting animate-spin" />
            </div>
          </div>
          
          <div className="text-center space-y-2">
            <h2 className="text-xl font-semibold">Waiting for presenter…</h2>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
              You're in the meeting. The screen will appear automatically when the presenter starts sharing.
            </p>
          </div>

          {participantCount > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm bg-muted/30 px-3 py-1.5 rounded-full">
              <Users className="w-4 h-4" />
              <span>{participantCount + 1} people in this meeting</span>
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={onDisconnect} className="text-muted-foreground">
            Leave
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
