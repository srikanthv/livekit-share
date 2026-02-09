import { useState, useEffect, useCallback, useRef } from 'react';
import { Room, RoomEvent, RemoteParticipant } from 'livekit-client';

export interface PresenterReadyMessage {
  type: 'presenter-ready';
  ts: number;
}

interface UsePresenterSignalProps {
  room: Room | null;
  role: 'presenter' | 'viewer';
  isConnected: boolean;
}

/**
 * Hook to manage the presenter-ready DataChannel protocol.
 * 
 * Presenter: broadcasts { type: 'presenter-ready', ts } on join, reconnect, and every 5s.
 * Viewer: listens for the signal and transitions from lobby → active meeting.
 */
export function usePresenterSignal({ room, role, isConnected }: UsePresenterSignalProps) {
  const [presenterReady, setPresenterReady] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const encoderRef = useRef(new TextEncoder());
  const decoderRef = useRef(new TextDecoder());

  // Broadcast the presenter-ready signal
  const broadcastPresenterReady = useCallback(() => {
    if (!room || !room.localParticipant) return;

    const message: PresenterReadyMessage = {
      type: 'presenter-ready',
      ts: Date.now(),
    };

    try {
      const payload = encoderRef.current.encode(JSON.stringify(message));
      room.localParticipant.publishData(payload, { reliable: true });
    } catch (err) {
      console.warn('[PresenterSignal] Failed to broadcast:', err);
    }
  }, [room]);

  // Presenter: start broadcasting on connect, repeat every 5s
  useEffect(() => {
    if (role !== 'presenter' || !isConnected || !room) return;

    // Send immediately on connect
    const initialDelay = setTimeout(() => {
      broadcastPresenterReady();
    }, 300);

    // Repeat every 5 seconds
    intervalRef.current = setInterval(() => {
      broadcastPresenterReady();
    }, 5000);

    return () => {
      clearTimeout(initialDelay);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [role, isConnected, room, broadcastPresenterReady]);

  // Viewer: listen for the presenter-ready signal
  useEffect(() => {
    if (role !== 'viewer' || !room) return;

    const handleData = (payload: Uint8Array, _participant?: RemoteParticipant) => {
      try {
        const decoded = decoderRef.current.decode(payload);
        const message = JSON.parse(decoded);

        if (message.type === 'presenter-ready') {
          if (!presenterReady) {
            console.log('[PresenterSignal] Presenter is ready — transitioning to active meeting');
          }
          setPresenterReady(true);
        }
      } catch {
        // Not a presenter-ready message — ignore silently
      }
    };

    room.on(RoomEvent.DataReceived, handleData);

    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [role, room, presenterReady]);

  // Reset when disconnected
  useEffect(() => {
    if (!isConnected) {
      setPresenterReady(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [isConnected]);

  return {
    /** True once a presenter-ready signal has been received (viewer only) */
    presenterReady,
    /** Manually trigger a broadcast (e.g., on reconnect) */
    broadcastPresenterReady,
  };
}
