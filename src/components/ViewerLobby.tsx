import { Loader2, Users } from 'lucide-react';
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
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
          </div>
          
          <div className="text-center space-y-2">
            <h2 className="text-xl font-semibold">Waiting for presenter…</h2>
            <p className="text-muted-foreground text-sm">
              The meeting will start as soon as the presenter joins. You'll be connected automatically.
            </p>
          </div>

          {participantCount > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Users className="w-4 h-4" />
              <span>{participantCount} other{participantCount !== 1 ? 's' : ''} waiting</span>
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
