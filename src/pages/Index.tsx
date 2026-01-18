import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveKitConfig } from '@/hooks/useLiveKitConfig';
import { ConfigSetup } from '@/components/ConfigSetup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Monitor, Eye, Loader2, Zap, Users, Shield } from 'lucide-react';

export default function Index() {
  const navigate = useNavigate();
  const { config, loading, error, saveConfig } = useLiveKitConfig();
  const [roomId, setRoomId] = useState('');

  const generateRoomId = () => {
    return `room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  };

  const startAsPresenter = () => {
    const id = roomId.trim() || generateRoomId();
    navigate(`/presenter?roomId=${id}`);
  };

  const joinAsViewer = () => {
    if (roomId.trim()) {
      navigate(`/viewer/${roomId.trim()}`);
    }
  };

  // Show loading
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // Show setup if not configured
  if (!config?.configured) {
    return <ConfigSetup onSave={saveConfig} loading={loading} error={error} />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full space-y-12">
          {/* Header */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
              <Zap className="w-4 h-4" />
              Powered by LiveKit
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
              Screen Sharing
              <span className="text-primary"> Made Simple</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Share your screen with crystal-clear quality and real-time audio. 
              No downloads required, works directly in your browser.
            </p>
          </div>

          {/* Room Input */}
          <div className="max-w-md mx-auto">
            <div className="flex gap-2">
              <Input
                placeholder="Enter room ID (optional)"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="h-12 bg-card/50"
              />
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Leave empty to generate a new room
            </p>
          </div>

          {/* Action Cards */}
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/50 transition-colors group cursor-pointer" onClick={startAsPresenter}>
              <CardHeader>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Monitor className="w-6 h-6 text-primary" />
                </div>
                <CardTitle>Start Presenting</CardTitle>
                <CardDescription>
                  Share your screen and audio with viewers. Control the session and manage participants.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full glow-primary" size="lg">
                  Start as Presenter
                </Button>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/50 transition-colors group cursor-pointer" onClick={joinAsViewer}>
              <CardHeader>
                <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-4 group-hover:bg-secondary/80 transition-colors">
                  <Eye className="w-6 h-6 text-secondary-foreground" />
                </div>
                <CardTitle>Join as Viewer</CardTitle>
                <CardDescription>
                  Watch the presenter's screen and participate with two-way audio communication.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  variant="secondary" 
                  className="w-full" 
                  size="lg"
                  disabled={!roomId.trim()}
                >
                  {roomId.trim() ? 'Join Room' : 'Enter Room ID'}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Features */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6 pt-8">
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-status-live/10 flex items-center justify-center mx-auto mb-3">
                <Zap className="w-5 h-5 text-status-live" />
              </div>
              <h3 className="font-medium mb-1">Low Latency</h3>
              <p className="text-sm text-muted-foreground">Real-time streaming</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-medium mb-1">Two-Way Audio</h3>
              <p className="text-sm text-muted-foreground">Everyone can speak</p>
            </div>
            <div className="text-center col-span-2 md:col-span-1">
              <div className="w-10 h-10 rounded-full bg-status-waiting/10 flex items-center justify-center mx-auto mb-3">
                <Shield className="w-5 h-5 text-status-waiting" />
              </div>
              <h3 className="font-medium mb-1">Secure</h3>
              <p className="text-sm text-muted-foreground">End-to-end encrypted</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-4 text-center text-sm text-muted-foreground">
        <p>LiveKit Screen Share PoC</p>
      </footer>
    </div>
  );
}
