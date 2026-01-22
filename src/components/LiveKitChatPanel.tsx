import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageCircle, X, Send, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChatMessage {
  id: string;
  type: 'chat' | 'system';
  from: string;
  role: 'presenter' | 'viewer';
  text: string;
  ts: number;
}

interface LiveKitChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  localIdentity: string;
  className?: string;
}

export function LiveKitChatPanel({ 
  messages, 
  onSendMessage, 
  localIdentity,
  className 
}: LiveKitChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastReadRef = useRef(0);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
    
    // Update unread count when panel is closed
    if (!isOpen && messages.length > lastReadRef.current) {
      setUnreadCount(messages.length - lastReadRef.current);
    }
  }, [messages, isOpen]);

  // Reset unread when opening panel
  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      lastReadRef.current = messages.length;
    }
  }, [isOpen, messages.length]);

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (trimmed) {
      onSendMessage(trimmed);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isOpen) {
    return (
      <Button
        variant="secondary"
        size="lg"
        className={cn(
          'fixed bottom-6 right-6 rounded-full w-14 h-14 shadow-lg z-50',
          unreadCount > 0 && 'glow-primary',
          className
        )}
        onClick={() => setIsOpen(true)}
      >
        <MessageCircle className="w-6 h-6" />
        {unreadCount > 0 && (
          <Badge 
            variant="destructive" 
            className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </Badge>
        )}
      </Button>
    );
  }

  return (
    <Card className={cn(
      'fixed bottom-6 right-6 w-80 md:w-96 h-[500px] max-h-[70vh] z-50 shadow-2xl flex flex-col',
      'border-border/50 bg-card/95 backdrop-blur-sm',
      className
    )}>
      <CardHeader className="flex flex-row items-center justify-between p-3 border-b border-border/50">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <MessageCircle className="w-4 h-4" />
          Chat
        </CardTitle>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8" 
          onClick={() => setIsOpen(false)}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        <ScrollArea className="flex-1 p-3" ref={scrollAreaRef}>
          <div className="space-y-3">
            {messages.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                No messages yet. Start the conversation!
              </p>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex flex-col gap-1',
                    msg.type === 'system' && 'items-center'
                  )}
                >
                  {msg.type === 'system' ? (
                    <div className="text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                      {msg.text}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'text-xs font-medium',
                          msg.from === localIdentity ? 'text-primary' : 'text-foreground'
                        )}>
                          {msg.from === localIdentity ? 'You' : msg.from}
                        </span>
                        <Badge 
                          variant={msg.role === 'presenter' ? 'default' : 'secondary'}
                          className="text-[10px] h-4 px-1.5"
                        >
                          {msg.role === 'presenter' ? 'Host' : 'Viewer'}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {formatTime(msg.ts)}
                        </span>
                      </div>
                      <div className={cn(
                        'text-sm px-3 py-2 rounded-lg max-w-[85%]',
                        msg.from === localIdentity 
                          ? 'bg-primary text-primary-foreground ml-auto' 
                          : msg.role === 'presenter'
                            ? 'bg-accent/20 border border-accent/30'
                            : 'bg-muted'
                      )}>
                        {msg.text}
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
        
        <div className="p-3 border-t border-border/50">
          <div className="flex gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="flex-1 bg-muted/50"
            />
            <Button 
              size="icon" 
              onClick={handleSend}
              disabled={!inputValue.trim()}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
