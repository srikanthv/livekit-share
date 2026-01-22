import { useState, useCallback, useRef, useEffect } from 'react';
import { Room, RoomEvent, DataPacket_Kind, RemoteParticipant } from 'livekit-client';
import { ChatMessage } from '@/components/LiveKitChatPanel';

// Session logging helper
const createLogger = (sessionId: string) => {
  const log = (group: string, message: string, data?: unknown) => {
    console.group(`[Chat:${sessionId}] ${group}`);
    console.log(message, data ?? '');
    console.groupEnd();
  };
  return log;
};

interface UseLiveKitChatProps {
  room: Room | null;
  localIdentity: string;
  role: 'presenter' | 'viewer';
  sessionId?: string;
}

export function useLiveKitChat({ room, localIdentity, role, sessionId }: UseLiveKitChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const encoder = useRef(new TextEncoder());
  const decoder = useRef(new TextDecoder());
  const log = createLogger(sessionId || 'default');

  // Generate unique message ID
  const generateId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Send a chat message via DataChannel
  const sendMessage = useCallback((text: string) => {
    if (!room || !room.localParticipant) {
      log('Send', 'Cannot send - no room connection');
      return;
    }

    const message: ChatMessage = {
      id: generateId(),
      type: 'chat',
      from: localIdentity,
      role,
      text,
      ts: Date.now(),
    };

    try {
      const payload = encoder.current.encode(JSON.stringify(message));
      room.localParticipant.publishData(payload, { reliable: true });
      
      // Add to local messages
      setMessages(prev => [...prev, message]);
      log('Send', `Message sent: "${text}"`);
    } catch (err) {
      log('Send', `Failed to send message: ${err}`);
    }
  }, [room, localIdentity, role, generateId, log]);

  // Send a system message (join/leave/sharing events)
  const sendSystemMessage = useCallback((text: string) => {
    if (!room || !room.localParticipant) {
      log('System', 'Cannot send system message - no room connection');
      return;
    }

    const message: ChatMessage = {
      id: generateId(),
      type: 'system',
      from: 'system',
      role,
      text,
      ts: Date.now(),
    };

    try {
      const payload = encoder.current.encode(JSON.stringify(message));
      room.localParticipant.publishData(payload, { reliable: true });
      
      // Add to local messages
      setMessages(prev => [...prev, message]);
      log('System', `System message sent: "${text}"`);
    } catch (err) {
      log('System', `Failed to send system message: ${err}`);
    }
  }, [room, role, generateId, log]);

  // Add a local-only system message (for events triggered locally)
  const addLocalSystemMessage = useCallback((text: string) => {
    const message: ChatMessage = {
      id: generateId(),
      type: 'system',
      from: 'system',
      role: 'viewer',
      text,
      ts: Date.now(),
    };
    setMessages(prev => [...prev, message]);
    log('LocalSystem', text);
  }, [generateId, log]);

  // Handle incoming data
  const handleDataReceived = useCallback((
    payload: Uint8Array,
    participant?: RemoteParticipant
  ) => {
    try {
      const decoded = decoder.current.decode(payload);
      const message = JSON.parse(decoded) as ChatMessage;
      
      // Validate message structure
      if (!message.id || !message.type || !message.text || !message.ts) {
        log('Receive', 'Invalid message structure', message);
        return;
      }

      // Avoid duplicates
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) {
          return prev;
        }
        return [...prev, message];
      });

      log('Receive', `Message from ${message.from}: "${message.text}"`);
    } catch (err) {
      log('Receive', `Failed to parse message: ${err}`);
    }
  }, [log]);

  // Set up event listeners
  useEffect(() => {
    if (!room) return;

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, handleDataReceived]);

  // Clear messages when disconnected
  const clearMessages = useCallback(() => {
    setMessages([]);
    log('Clear', 'Messages cleared');
  }, [log]);

  return {
    messages,
    sendMessage,
    sendSystemMessage,
    addLocalSystemMessage,
    clearMessages,
  };
}
