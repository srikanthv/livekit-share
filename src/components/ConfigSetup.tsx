import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Settings, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface ConfigSetupProps {
  onSave: (url: string, apiKey: string, apiSecret: string) => Promise<boolean>;
  loading: boolean;
  error?: string | null;
}

export function ConfigSetup({ onSave, loading, error }: ConfigSetupProps) {
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await onSave(url, apiKey, apiSecret);
    if (result) {
      setSuccess(true);
    }
  };

  const isValid = url.trim() && apiKey.trim() && apiSecret.trim();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Settings className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">LiveKit Setup</CardTitle>
          <CardDescription>
            Enter your LiveKit credentials to get started. This only needs to be done once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="flex flex-col items-center py-8">
              <CheckCircle className="w-16 h-16 text-status-live mb-4" />
              <p className="text-lg font-medium">Configuration Saved!</p>
              <p className="text-muted-foreground text-center mt-2">
                You can now start sharing your screen or join as a viewer.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="url">LiveKit Server URL</Label>
                <Input
                  id="url"
                  type="url"
                  placeholder="wss://your-project.livekit.cloud"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="bg-input/50"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="text"
                  placeholder="APIxxxxxxxx"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="bg-input/50"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiSecret">API Secret</Label>
                <Input
                  id="apiSecret"
                  type="password"
                  placeholder="••••••••••••••••••••"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  className="bg-input/50"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  The API Secret is stored securely and never exposed to clients.
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4" />
                  <span>{error}</span>
                </div>
              )}

              <Button 
                type="submit" 
                className="w-full" 
                disabled={loading || !isValid}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Configuration'
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
