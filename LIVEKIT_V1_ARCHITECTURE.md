# Enterprise Screen Sharing & Collaboration App
## LiveKit v1 Architecture Reference

> **Stack:** React 17.0.2 | react-router-dom 5.3.0 | TypeScript 4.0.x | livekit-client ^1.6.0 | livekit-server-sdk ^1.2.7

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Core Concepts](#core-concepts)
3. [DataChannel Presence Layer](#datachannel-presence-layer)
4. [Room Connection & Lifecycle](#room-connection--lifecycle)
5. [Presenter Implementation](#presenter-implementation)
6. [Viewer Implementation](#viewer-implementation)
7. [Real-Time Chat System](#real-time-chat-system)
8. [Soft-Lock UX Behaviors](#soft-lock-ux-behaviors)
9. [Server-Side Implementation](#server-side-implementation)
10. [TypeScript Interfaces](#typescript-interfaces)

---

## Project Structure

```
src/
├── components/
│   ├── chat/
│   │   ├── ChatPanel.tsx
│   │   ├── ChatMessage.tsx
│   │   └── SystemMessage.tsx
│   ├── presence/
│   │   ├── ParticipantList.tsx
│   │   └── WaitingRoom.tsx
│   ├── room/
│   │   ├── PresenterRoom.tsx
│   │   ├── ViewerRoom.tsx
│   │   ├── ScreenPreview.tsx
│   │   └── AudioControls.tsx
│   ├── config/
│   │   └── ConfigForm.tsx
│   └── layout/
│       ├── Header.tsx
│       └── SoftLockOverlay.tsx
├── hooks/
│   ├── useLiveKitRoom.ts
│   ├── usePresence.ts
│   ├── useChat.ts
│   ├── useScreenShare.ts
│   └── useSoftLock.ts
├── lib/
│   ├── livekit.ts
│   ├── presence.ts
│   ├── constants.ts
│   └── types.ts
├── pages/
│   ├── Home.tsx
│   ├── Presenter.tsx
│   ├── Viewer.tsx
│   └── Config.tsx
├── context/
│   └── RoomContext.tsx
└── server/
    ├── index.ts
    ├── config.ts
    └── token.ts
```

---

## Core Concepts

### LiveKit v1 vs v2 Key Differences

| Feature | LiveKit v1 (^1.6.0) | LiveKit v2 |
|---------|---------------------|------------|
| Track Events | `TrackSubscribed`, `TrackUnsubscribed` | Same but more reliable |
| Participant Discovery | Limited - silent participants not surfaced | `ParticipantConnected` reliable |
| Data Channels | `room.localParticipant.publishData()` | Same API |
| Screen Share | `createLocalScreenTracks()` | `LocalParticipant.setScreenShareEnabled()` |
| Connection State | `ConnectionState` enum | Same |

### Why Custom Presence Layer?

LiveKit v1 does **not** reliably emit `ParticipantConnected` for participants who:
- Join but haven't published any tracks yet
- Are in "silent" mode (audio muted, no video)

**Solution:** Implement a DataChannel-based presence handshake that operates independently of track publication.

---

## DataChannel Presence Layer

### Types

```typescript
// src/lib/types.ts

export type ParticipantRole = 'presenter' | 'viewer';

export interface PresenceMessage {
  type: 'hello' | 'heartbeat' | 'goodbye';
  role: ParticipantRole;
  name: string;
  participantId: string;
  timestamp: number;
}

export interface ConnectedParticipant {
  id: string;
  name: string;
  role: ParticipantRole;
  lastSeen: number;
  isMuted: boolean;
}

export interface PresenceState {
  participants: Map<string, ConnectedParticipant>;
  presenter: ConnectedParticipant | null;
  viewers: ConnectedParticipant[];
}
```

### Presence Manager

```typescript
// src/lib/presence.ts

import { Room, DataPacket_Kind, RemoteParticipant } from 'livekit-client';
import { PresenceMessage, ConnectedParticipant, PresenceState } from './types';

const HEARTBEAT_INTERVAL = 10000; // 10 seconds
const TIMEOUT_THRESHOLD = 30000; // 30 seconds

export class PresenceManager {
  private room: Room;
  private participants: Map<string, ConnectedParticipant> = new Map();
  private heartbeatInterval: NodeJS.Timer | null = null;
  private cleanupInterval: NodeJS.Timer | null = null;
  private listeners: Set<(state: PresenceState) => void> = new Set();
  private localRole: 'presenter' | 'viewer';
  private localName: string;

  constructor(room: Room, role: 'presenter' | 'viewer', name: string) {
    this.room = room;
    this.localRole = role;
    this.localName = name;
    this.setupListeners();
  }

  private setupListeners(): void {
    // Listen for incoming data messages
    this.room.on('dataReceived', (
      payload: Uint8Array,
      participant?: RemoteParticipant
    ) => {
      try {
        const decoder = new TextDecoder();
        const message: PresenceMessage = JSON.parse(decoder.decode(payload));
        this.handlePresenceMessage(message, participant);
      } catch (error) {
        console.error('Failed to parse presence message:', error);
      }
    });

    // Handle LiveKit's native participant events as backup
    this.room.on('participantDisconnected', (participant: RemoteParticipant) => {
      this.removeParticipant(participant.identity);
    });
  }

  private handlePresenceMessage(
    message: PresenceMessage,
    participant?: RemoteParticipant
  ): void {
    const participantId = message.participantId;

    switch (message.type) {
      case 'hello':
      case 'heartbeat':
        this.participants.set(participantId, {
          id: participantId,
          name: message.name,
          role: message.role,
          lastSeen: Date.now(),
          isMuted: false,
        });
        this.notifyListeners();
        break;

      case 'goodbye':
        this.removeParticipant(participantId);
        break;
    }
  }

  private removeParticipant(participantId: string): void {
    if (this.participants.has(participantId)) {
      this.participants.delete(participantId);
      this.notifyListeners();
    }
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }

  async start(): Promise<void> {
    // Send initial hello
    await this.sendPresenceMessage('hello');

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.sendPresenceMessage('heartbeat');
    }, HEARTBEAT_INTERVAL);

    // Start cleanup of stale participants
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let hasChanges = false;

      this.participants.forEach((participant, id) => {
        if (now - participant.lastSeen > TIMEOUT_THRESHOLD) {
          this.participants.delete(id);
          hasChanges = true;
        }
      });

      if (hasChanges) {
        this.notifyListeners();
      }
    }, 5000);
  }

  async stop(): Promise<void> {
    // Send goodbye
    await this.sendPresenceMessage('goodbye');

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private async sendPresenceMessage(type: 'hello' | 'heartbeat' | 'goodbye'): Promise<void> {
    const message: PresenceMessage = {
      type,
      role: this.localRole,
      name: this.localName,
      participantId: this.room.localParticipant.identity,
      timestamp: Date.now(),
    };

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(message));

    try {
      await this.room.localParticipant.publishData(
        data,
        DataPacket_Kind.RELIABLE
      );
    } catch (error) {
      console.error('Failed to send presence message:', error);
    }
  }

  subscribe(listener: (state: PresenceState) => void): () => void {
    this.listeners.add(listener);
    // Immediately notify with current state
    listener(this.getState());
    
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): PresenceState {
    const allParticipants = Array.from(this.participants.values());
    const presenter = allParticipants.find(p => p.role === 'presenter') || null;
    const viewers = allParticipants.filter(p => p.role === 'viewer');

    return {
      participants: new Map(this.participants),
      presenter,
      viewers,
    };
  }
}
```

### usePresence Hook

```typescript
// src/hooks/usePresence.ts

import { useState, useEffect, useRef } from 'react';
import { Room } from 'livekit-client';
import { PresenceManager, PresenceState, ParticipantRole } from '../lib/presence';

interface UsePresenceOptions {
  room: Room | null;
  role: ParticipantRole;
  name: string;
  enabled?: boolean;
}

export function usePresence({
  room,
  role,
  name,
  enabled = true,
}: UsePresenceOptions): PresenceState {
  const [state, setState] = useState<PresenceState>({
    participants: new Map(),
    presenter: null,
    viewers: [],
  });

  const managerRef = useRef<PresenceManager | null>(null);

  useEffect(() => {
    if (!room || !enabled) return;

    const manager = new PresenceManager(room, role, name);
    managerRef.current = manager;

    const unsubscribe = manager.subscribe(setState);
    manager.start();

    return () => {
      unsubscribe();
      manager.stop();
      managerRef.current = null;
    };
  }, [room, role, name, enabled]);

  return state;
}
```

---

## Room Connection & Lifecycle

### LiveKit Room Hook

```typescript
// src/hooks/useLiveKitRoom.ts

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  ConnectionState,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  Track,
  LocalTrack,
} from 'livekit-client';

interface RoomState {
  room: Room | null;
  connectionState: ConnectionState;
  error: Error | null;
  screenTrack: RemoteTrack | null;
  audioTracks: RemoteTrack[];
  hasSeenScreen: boolean;
}

interface UseLiveKitRoomOptions {
  url: string;
  token: string;
  autoConnect?: boolean;
  onScreenShareStarted?: () => void;
  onScreenShareStopped?: () => void;
}

export function useLiveKitRoom({
  url,
  token,
  autoConnect = true,
  onScreenShareStarted,
  onScreenShareStopped,
}: UseLiveKitRoomOptions): RoomState & {
  connect: () => Promise<void>;
  disconnect: () => void;
} {
  const [state, setState] = useState<RoomState>({
    room: null,
    connectionState: ConnectionState.Disconnected,
    error: null,
    screenTrack: null,
    audioTracks: [],
    hasSeenScreen: false,
  });

  const roomRef = useRef<Room | null>(null);
  const hasSeenScreenRef = useRef(false);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  // CRITICAL: Track whether we should enable reconnect logic
  // Only enable AFTER first screen has been seen
  const shouldAutoReconnect = useCallback(() => {
    return hasSeenScreenRef.current;
  }, []);

  const handleTrackSubscribed = useCallback((
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => {
    if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
      hasSeenScreenRef.current = true;
      setState(prev => ({
        ...prev,
        screenTrack: track,
        hasSeenScreen: true,
      }));
      onScreenShareStarted?.();
    } else if (track.kind === Track.Kind.Audio) {
      setState(prev => ({
        ...prev,
        audioTracks: [...prev.audioTracks, track],
      }));
    }
  }, [onScreenShareStarted]);

  const handleTrackUnsubscribed = useCallback((
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => {
    if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
      setState(prev => ({
        ...prev,
        screenTrack: null,
      }));
      onScreenShareStopped?.();
    } else if (track.kind === Track.Kind.Audio) {
      setState(prev => ({
        ...prev,
        audioTracks: prev.audioTracks.filter(t => t.sid !== track.sid),
      }));
    }
  }, [onScreenShareStopped]);

  const handleConnectionStateChanged = useCallback((connectionState: ConnectionState) => {
    setState(prev => ({ ...prev, connectionState }));

    // CRITICAL: Only attempt reconnection if we've seen a screen before
    if (connectionState === ConnectionState.Disconnected && shouldAutoReconnect()) {
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        console.log(`Reconnecting... attempt ${reconnectAttempts.current}`);
        setTimeout(() => {
          connect();
        }, 1000 * reconnectAttempts.current); // Exponential backoff
      }
    }
  }, [shouldAutoReconnect]);

  const connect = useCallback(async () => {
    if (roomRef.current?.state === ConnectionState.Connected) {
      return;
    }

    try {
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // LiveKit v1 options
        publishDefaults: {
          simulcast: false,
        },
      });

      roomRef.current = room;

      // Set up event listeners BEFORE connecting
      room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);
      room.on(RoomEvent.Disconnected, () => {
        console.log('Room disconnected');
      });

      await room.connect(url, token);

      setState(prev => ({
        ...prev,
        room,
        connectionState: room.state,
        error: null,
      }));

      reconnectAttempts.current = 0;

      // Check for existing tracks (late join scenario)
      room.participants.forEach((participant) => {
        participant.tracks.forEach((publication) => {
          if (publication.track && publication.isSubscribed) {
            handleTrackSubscribed(
              publication.track as RemoteTrack,
              publication as RemoteTrackPublication,
              participant
            );
          }
        });
      });

    } catch (error) {
      console.error('Failed to connect to room:', error);
      setState(prev => ({
        ...prev,
        error: error as Error,
        connectionState: ConnectionState.Disconnected,
      }));
    }
  }, [url, token, handleTrackSubscribed, handleTrackUnsubscribed, handleConnectionStateChanged]);

  const disconnect = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
      setState({
        room: null,
        connectionState: ConnectionState.Disconnected,
        error: null,
        screenTrack: null,
        audioTracks: [],
        hasSeenScreen: hasSeenScreenRef.current,
      });
    }
  }, []);

  useEffect(() => {
    if (autoConnect && url && token) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, url, token]);

  return {
    ...state,
    connect,
    disconnect,
  };
}
```

---

## Presenter Implementation

### Screen Share Hook

```typescript
// src/hooks/useScreenShare.ts

import { useState, useCallback, useRef } from 'react';
import { Room, LocalTrack, createLocalScreenTracks, Track } from 'livekit-client';

interface ScreenShareState {
  isSharing: boolean;
  localScreenTrack: LocalTrack | null;
  error: Error | null;
}

interface UseScreenShareOptions {
  room: Room | null;
  withAudio?: boolean;
}

export function useScreenShare({ room, withAudio = true }: UseScreenShareOptions) {
  const [state, setState] = useState<ScreenShareState>({
    isSharing: false,
    localScreenTrack: null,
    error: null,
  });

  const tracksRef = useRef<LocalTrack[]>([]);

  const startScreenShare = useCallback(async () => {
    if (!room) {
      console.error('Room not connected');
      return;
    }

    try {
      // LiveKit v1: createLocalScreenTracks
      const tracks = await createLocalScreenTracks({
        audio: withAudio, // Capture system audio
        resolution: {
          width: 1920,
          height: 1080,
          frameRate: 30,
        },
      });

      tracksRef.current = tracks;

      // Publish all tracks
      for (const track of tracks) {
        await room.localParticipant.publishTrack(track, {
          source: track.kind === Track.Kind.Video 
            ? Track.Source.ScreenShare 
            : Track.Source.ScreenShareAudio,
        });
      }

      const videoTrack = tracks.find(t => t.kind === Track.Kind.Video);

      // Handle user stopping share via browser UI
      if (videoTrack) {
        const mediaStreamTrack = videoTrack.mediaStreamTrack;
        mediaStreamTrack?.addEventListener('ended', () => {
          stopScreenShare();
        });
      }

      setState({
        isSharing: true,
        localScreenTrack: videoTrack || null,
        error: null,
      });

    } catch (error) {
      console.error('Failed to start screen share:', error);
      setState(prev => ({
        ...prev,
        error: error as Error,
      }));
    }
  }, [room, withAudio]);

  const stopScreenShare = useCallback(async () => {
    if (!room) return;

    try {
      for (const track of tracksRef.current) {
        await room.localParticipant.unpublishTrack(track);
        track.stop();
      }
      tracksRef.current = [];

      setState({
        isSharing: false,
        localScreenTrack: null,
        error: null,
      });
    } catch (error) {
      console.error('Failed to stop screen share:', error);
    }
  }, [room]);

  return {
    ...state,
    startScreenShare,
    stopScreenShare,
  };
}
```

### Presenter Room Component

```typescript
// src/components/room/PresenterRoom.tsx

import React, { useEffect, useRef } from 'react';
import { useLiveKitRoom } from '../../hooks/useLiveKitRoom';
import { useScreenShare } from '../../hooks/useScreenShare';
import { usePresence } from '../../hooks/usePresence';
import { useChat } from '../../hooks/useChat';
import { useSoftLock } from '../../hooks/useSoftLock';
import { ParticipantList } from '../presence/ParticipantList';
import { ChatPanel } from '../chat/ChatPanel';
import { ScreenPreview } from './ScreenPreview';
import { AudioControls } from './AudioControls';

interface PresenterRoomProps {
  serverUrl: string;
  token: string;
  presenterName: string;
  roomName: string;
  onEndMeeting: () => void;
}

export const PresenterRoom: React.FC<PresenterRoomProps> = ({
  serverUrl,
  token,
  presenterName,
  roomName,
  onEndMeeting,
}) => {
  const previewRef = useRef<HTMLVideoElement>(null);

  // Room connection
  const {
    room,
    connectionState,
    error: connectionError,
  } = useLiveKitRoom({
    url: serverUrl,
    token,
    autoConnect: true,
  });

  // Screen sharing
  const {
    isSharing,
    localScreenTrack,
    startScreenShare,
    stopScreenShare,
    error: screenShareError,
  } = useScreenShare({ room, withAudio: true });

  // Presence layer - source of truth for participants
  const { presenter, viewers } = usePresence({
    room,
    role: 'presenter',
    name: presenterName,
    enabled: true,
  });

  // Chat
  const {
    messages,
    sendMessage,
    unreadCount,
  } = useChat({ room, senderName: presenterName, role: 'presenter' });

  // Soft lock behavior
  const { isWarningVisible, dismissWarning } = useSoftLock({
    enabled: isSharing,
    onAttemptExit: () => {
      // Show warning but don't stop the share
    },
  });

  // Attach local screen track to preview
  useEffect(() => {
    if (localScreenTrack && previewRef.current) {
      localScreenTrack.attach(previewRef.current);
    }
    return () => {
      if (localScreenTrack && previewRef.current) {
        localScreenTrack.detach(previewRef.current);
      }
    };
  }, [localScreenTrack]);

  // Enter fullscreen when sharing starts
  useEffect(() => {
    if (isSharing) {
      document.documentElement.requestFullscreen?.().catch(console.error);
    }
  }, [isSharing]);

  const handleEndMeeting = async () => {
    await stopScreenShare();
    onEndMeeting();
  };

  const handleMuteViewer = async (participantId: string) => {
    // Send mute command via data channel
    if (!room) return;
    
    const encoder = new TextEncoder();
    const message = JSON.stringify({
      type: 'mute_command',
      targetParticipantId: participantId,
    });
    
    await room.localParticipant.publishData(
      encoder.encode(message),
      { reliable: true }
    );
  };

  return (
    <div className="presenter-room">
      <header className="presenter-header">
        <h1>Presenting: {roomName}</h1>
        <div className="connection-status">
          Status: {connectionState}
        </div>
      </header>

      <main className="presenter-main">
        {/* Screen Preview - What viewers see */}
        <div className="screen-preview-container">
          {isSharing ? (
            <video
              ref={previewRef}
              autoPlay
              playsInline
              muted
              className="screen-preview"
            />
          ) : (
            <div className="no-share-placeholder">
              <p>Click "Start Sharing" to begin your presentation</p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="presenter-controls">
          {!isSharing ? (
            <button onClick={startScreenShare} className="btn-primary">
              Start Sharing
            </button>
          ) : (
            <button onClick={stopScreenShare} className="btn-danger">
              Stop Sharing
            </button>
          )}
          
          <AudioControls room={room} />
          
          <button onClick={handleEndMeeting} className="btn-secondary">
            End Meeting
          </button>
        </div>

        {/* Sidebar */}
        <aside className="presenter-sidebar">
          {/* Participant List - from presence layer */}
          <ParticipantList
            viewers={viewers}
            onMuteViewer={handleMuteViewer}
            isPresenter={true}
          />

          {/* Chat Panel */}
          <ChatPanel
            messages={messages}
            onSendMessage={sendMessage}
            unreadCount={unreadCount}
            isPresenter={true}
          />
        </aside>
      </main>

      {/* Soft Lock Warning Overlay */}
      {isWarningVisible && (
        <div className="soft-lock-overlay">
          <div className="soft-lock-modal">
            <h2>⚠️ You are still presenting</h2>
            <p>Your screen is being shared with viewers.</p>
            <button onClick={dismissWarning}>Continue Presenting</button>
            <button onClick={handleEndMeeting}>End Meeting</button>
          </div>
        </div>
      )}
    </div>
  );
};
```

---

## Viewer Implementation

### Viewer Room Component

```typescript
// src/components/room/ViewerRoom.tsx

import React, { useEffect, useRef, useState } from 'react';
import { useLiveKitRoom } from '../../hooks/useLiveKitRoom';
import { usePresence } from '../../hooks/usePresence';
import { useChat } from '../../hooks/useChat';
import { WaitingRoom } from '../presence/WaitingRoom';
import { ChatPanel } from '../chat/ChatPanel';
import { AudioControls } from './AudioControls';

interface ViewerRoomProps {
  serverUrl: string;
  token: string;
  viewerName: string;
  roomName: string;
  onLeave: () => void;
}

export const ViewerRoom: React.FC<ViewerRoomProps> = ({
  serverUrl,
  token,
  viewerName,
  roomName,
  onLeave,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isWaiting, setIsWaiting] = useState(true);

  // Room connection - CRITICAL: autoConnect but NO reconnect loops before first screen
  const {
    room,
    connectionState,
    screenTrack,
    hasSeenScreen,
    error: connectionError,
  } = useLiveKitRoom({
    url: serverUrl,
    token,
    autoConnect: true,
    onScreenShareStarted: () => {
      setIsWaiting(false);
      // Enter fullscreen when screen share starts
      document.documentElement.requestFullscreen?.().catch(console.error);
    },
    onScreenShareStopped: () => {
      // Screen stopped but we stay connected
    },
  });

  // Presence layer
  const { presenter, viewers } = usePresence({
    room,
    role: 'viewer',
    name: viewerName,
    enabled: true,
  });

  // Chat
  const {
    messages,
    sendMessage,
    unreadCount,
  } = useChat({ room, senderName: viewerName, role: 'viewer' });

  // Listen for mute commands from presenter
  useEffect(() => {
    if (!room) return;

    const handleData = (payload: Uint8Array) => {
      try {
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload));
        
        if (
          message.type === 'mute_command' &&
          message.targetParticipantId === room.localParticipant.identity
        ) {
          // Mute local audio
          room.localParticipant.audioTracks.forEach((publication) => {
            publication.track?.mute();
          });
        }
      } catch (error) {
        // Not a control message, ignore
      }
    };

    room.on('dataReceived', handleData);
    return () => {
      room.off('dataReceived', handleData);
    };
  }, [room]);

  // Attach screen track to video element
  useEffect(() => {
    if (screenTrack && videoRef.current) {
      screenTrack.attach(videoRef.current);
    }
    return () => {
      if (screenTrack && videoRef.current) {
        screenTrack.detach(videoRef.current);
      }
    };
  }, [screenTrack]);

  // Determine if we're waiting (connected but no screen track yet)
  const showWaitingState = connectionState === 'connected' && !screenTrack && !hasSeenScreen;

  // beforeunload guard
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You are in a meeting. Are you sure you want to leave?';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  if (showWaitingState) {
    return (
      <WaitingRoom
        roomName={roomName}
        presenterName={presenter?.name}
        connectionState={connectionState}
        onLeave={onLeave}
      />
    );
  }

  return (
    <div className="viewer-room">
      <main className="viewer-main">
        {/* Screen View */}
        <div className="screen-view-container">
          {screenTrack ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="screen-view"
            />
          ) : (
            <div className="screen-paused">
              <p>Presenter has paused screen sharing</p>
              <p>Waiting for them to resume...</p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="viewer-controls">
          <AudioControls room={room} />
          
          <button onClick={onLeave} className="btn-secondary">
            Leave Meeting
          </button>
        </div>

        {/* Chat Panel */}
        <ChatPanel
          messages={messages}
          onSendMessage={sendMessage}
          unreadCount={unreadCount}
          isPresenter={false}
        />
      </main>
    </div>
  );
};
```

### Waiting Room Component

```typescript
// src/components/presence/WaitingRoom.tsx

import React from 'react';
import { ConnectionState } from 'livekit-client';

interface WaitingRoomProps {
  roomName: string;
  presenterName?: string;
  connectionState: ConnectionState;
  onLeave: () => void;
}

export const WaitingRoom: React.FC<WaitingRoomProps> = ({
  roomName,
  presenterName,
  connectionState,
  onLeave,
}) => {
  return (
    <div className="waiting-room">
      <div className="waiting-content">
        <div className="spinner" />
        
        <h1>Waiting for Presenter</h1>
        
        <p className="room-name">Room: {roomName}</p>
        
        {presenterName && (
          <p className="presenter-info">
            {presenterName} will start sharing soon...
          </p>
        )}
        
        {!presenterName && (
          <p className="presenter-info">
            The presenter hasn't joined yet...
          </p>
        )}
        
        <div className="connection-status">
          Connection: {connectionState}
        </div>
        
        <button onClick={onLeave} className="btn-secondary">
          Leave Waiting Room
        </button>
      </div>
    </div>
  );
};
```

---

## Real-Time Chat System

### Chat Types

```typescript
// src/lib/types.ts (add to existing file)

export type ChatMessageType = 'user' | 'system';

export interface ChatMessage {
  id: string;
  type: ChatMessageType;
  content: string;
  senderName: string;
  senderRole: ParticipantRole;
  timestamp: number;
}

export interface SystemEvent {
  type: 'join' | 'leave' | 'screen_start' | 'screen_stop';
  participantName: string;
  timestamp: number;
}
```

### useChat Hook

```typescript
// src/hooks/useChat.ts

import { useState, useCallback, useEffect, useRef } from 'react';
import { Room, DataPacket_Kind } from 'livekit-client';
import { ChatMessage, ParticipantRole } from '../lib/types';

interface UseChatOptions {
  room: Room | null;
  senderName: string;
  role: ParticipantRole;
}

interface DataChannelChatMessage {
  type: 'chat';
  id: string;
  content: string;
  senderName: string;
  senderRole: ParticipantRole;
  timestamp: number;
}

interface DataChannelSystemMessage {
  type: 'system';
  event: 'join' | 'leave' | 'screen_start' | 'screen_stop';
  participantName: string;
  timestamp: number;
}

type DataChannelMessage = DataChannelChatMessage | DataChannelSystemMessage;

export function useChat({ room, senderName, role }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Generate unique message IDs
  const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Listen for incoming messages
  useEffect(() => {
    if (!room) return;

    const handleData = (payload: Uint8Array) => {
      try {
        const decoder = new TextDecoder();
        const data: DataChannelMessage = JSON.parse(decoder.decode(payload));

        if (data.type === 'chat') {
          const message: ChatMessage = {
            id: data.id,
            type: 'user',
            content: data.content,
            senderName: data.senderName,
            senderRole: data.senderRole,
            timestamp: data.timestamp,
          };

          setMessages(prev => [...prev, message]);

          if (!isPanelOpen) {
            setUnreadCount(prev => prev + 1);
          }
        } else if (data.type === 'system') {
          const systemMessage: ChatMessage = {
            id: generateId(),
            type: 'system',
            content: getSystemMessageContent(data.event, data.participantName),
            senderName: 'System',
            senderRole: 'viewer',
            timestamp: data.timestamp,
          };

          setMessages(prev => [...prev, systemMessage]);
        }
      } catch (error) {
        // Not a chat message, ignore
      }
    };

    room.on('dataReceived', handleData);
    return () => {
      room.off('dataReceived', handleData);
    };
  }, [room, isPanelOpen]);

  const sendMessage = useCallback(async (content: string) => {
    if (!room || !content.trim()) return;

    const message: DataChannelChatMessage = {
      type: 'chat',
      id: generateId(),
      content: content.trim(),
      senderName,
      senderRole: role,
      timestamp: Date.now(),
    };

    const encoder = new TextEncoder();
    await room.localParticipant.publishData(
      encoder.encode(JSON.stringify(message)),
      DataPacket_Kind.RELIABLE
    );

    // Add to local messages
    setMessages(prev => [...prev, {
      id: message.id,
      type: 'user',
      content: message.content,
      senderName: message.senderName,
      senderRole: message.senderRole,
      timestamp: message.timestamp,
    }]);
  }, [room, senderName, role]);

  const sendSystemMessage = useCallback(async (
    event: 'join' | 'leave' | 'screen_start' | 'screen_stop'
  ) => {
    if (!room) return;

    const message: DataChannelSystemMessage = {
      type: 'system',
      event,
      participantName: senderName,
      timestamp: Date.now(),
    };

    const encoder = new TextEncoder();
    await room.localParticipant.publishData(
      encoder.encode(JSON.stringify(message)),
      DataPacket_Kind.RELIABLE
    );
  }, [room, senderName]);

  const openPanel = useCallback(() => {
    setIsPanelOpen(true);
    setUnreadCount(0);
  }, []);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  return {
    messages,
    sendMessage,
    sendSystemMessage,
    unreadCount,
    isPanelOpen,
    openPanel,
    closePanel,
  };
}

function getSystemMessageContent(
  event: 'join' | 'leave' | 'screen_start' | 'screen_stop',
  participantName: string
): string {
  switch (event) {
    case 'join':
      return `${participantName} joined the meeting`;
    case 'leave':
      return `${participantName} left the meeting`;
    case 'screen_start':
      return `${participantName} started screen sharing`;
    case 'screen_stop':
      return `${participantName} stopped screen sharing`;
  }
}
```

### Chat Panel Component

```typescript
// src/components/chat/ChatPanel.tsx

import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../../lib/types';
import { ChatMessageComponent } from './ChatMessage';
import { SystemMessage } from './SystemMessage';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  unreadCount: number;
  isPresenter: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  unreadCount,
  isPresenter,
  isOpen = true,
  onToggle,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onSendMessage(inputValue);
      setInputValue('');
    }
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
    onToggle?.();
  };

  return (
    <div className={`chat-panel ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="chat-header" onClick={toggleCollapse}>
        <span>Chat</span>
        {unreadCount > 0 && isCollapsed && (
          <span className="unread-badge">{unreadCount}</span>
        )}
        <button className="collapse-btn">
          {isCollapsed ? '▲' : '▼'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          <div className="chat-messages">
            {messages.map((message) => (
              message.type === 'system' ? (
                <SystemMessage key={message.id} message={message} />
              ) : (
                <ChatMessageComponent
                  key={message.id}
                  message={message}
                  isPresenterMessage={message.senderRole === 'presenter'}
                />
              )
            ))}
            <div ref={messagesEndRef} />
          </div>

          <form className="chat-input-form" onSubmit={handleSubmit}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type a message..."
              className="chat-input"
            />
            <button type="submit" className="chat-send-btn">
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
};
```

---

## Soft-Lock UX Behaviors

### useSoftLock Hook

```typescript
// src/hooks/useSoftLock.ts

import { useState, useEffect, useCallback } from 'react';

interface UseSoftLockOptions {
  enabled: boolean;
  onAttemptExit?: () => void;
}

export function useSoftLock({ enabled, onAttemptExit }: UseSoftLockOptions) {
  const [isWarningVisible, setIsWarningVisible] = useState(false);

  // beforeunload handler
  useEffect(() => {
    if (!enabled) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You are currently sharing your screen. Are you sure you want to leave?';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [enabled]);

  // Visibility change handler (tab blur)
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsWarningVisible(true);
        onAttemptExit?.();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, onAttemptExit]);

  // Fullscreen exit handler
  useEffect(() => {
    if (!enabled) return;

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsWarningVisible(true);
        onAttemptExit?.();
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [enabled, onAttemptExit]);

  // Escape key handler
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Prevent default escape behavior
        e.preventDefault();
        setIsWarningVisible(true);
        onAttemptExit?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, onAttemptExit]);

  const dismissWarning = useCallback(() => {
    setIsWarningVisible(false);
    // Re-enter fullscreen
    document.documentElement.requestFullscreen?.().catch(console.error);
  }, []);

  const confirmExit = useCallback(() => {
    setIsWarningVisible(false);
    // Caller handles the actual exit
  }, []);

  return {
    isWarningVisible,
    dismissWarning,
    confirmExit,
  };
}
```

---

## Server-Side Implementation

### Server Entry Point

```typescript
// server/index.ts

import express from 'express';
import cors from 'cors';
import { configRouter } from './routes/config';
import { tokenRouter } from './routes/token';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/config', configRouter);
app.use('/api/token', tokenRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### File-Based Config Storage

```typescript
// server/config.ts

import fs from 'fs';
import path from 'path';

interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

const CONFIG_PATH = path.join(__dirname, 'livekit-config.json');

export function getConfig(): LiveKitConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return null;
    }
    const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to read config:', error);
    return null;
  }
}

export function saveConfig(config: LiveKitConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function hasConfig(): boolean {
  return fs.existsSync(CONFIG_PATH);
}
```

### Config Router

```typescript
// server/routes/config.ts

import { Router } from 'express';
import { getConfig, saveConfig, hasConfig } from '../config';

export const configRouter = Router();

// Check if config exists (no sensitive data exposed)
configRouter.get('/status', (req, res) => {
  res.json({ configured: hasConfig() });
});

// Save config (presenter only, on first setup)
configRouter.post('/', (req, res) => {
  const { url, apiKey, apiSecret } = req.body;

  if (!url || !apiKey || !apiSecret) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate URL format
  if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
    return res.status(400).json({ error: 'Invalid LiveKit URL format' });
  }

  saveConfig({ url, apiKey, apiSecret });
  res.json({ success: true });
});
```

### Token Generation

```typescript
// server/routes/token.ts

import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { getConfig } from '../config';

export const tokenRouter = Router();

interface TokenRequest {
  roomName: string;
  participantName: string;
  role: 'presenter' | 'viewer';
}

tokenRouter.post('/', async (req, res) => {
  const { roomName, participantName, role } = req.body as TokenRequest;

  if (!roomName || !participantName || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const config = getConfig();
  if (!config) {
    return res.status(500).json({ error: 'LiveKit not configured' });
  }

  try {
    // LiveKit v1 Server SDK: AccessToken
    const token = new AccessToken(config.apiKey, config.apiSecret, {
      identity: `${role}-${participantName}-${Date.now()}`,
      name: participantName,
    });

    // Grant permissions based on role
    token.addGrant({
      room: roomName,
      roomJoin: true,
      roomCreate: role === 'presenter', // Only presenter can create room
      canPublish: true, // Both can publish (presenter: screen, viewer: audio)
      canSubscribe: true,
      canPublishData: true, // Required for presence + chat
    });

    // LiveKit v1: toJwt()
    const jwt = token.toJwt();

    res.json({
      token: jwt,
      url: config.url,
    });
  } catch (error) {
    console.error('Token generation failed:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});
```

---

## TypeScript Interfaces

### Complete Types File

```typescript
// src/lib/types.ts

// === Roles ===
export type ParticipantRole = 'presenter' | 'viewer';

// === Presence ===
export interface PresenceMessage {
  type: 'hello' | 'heartbeat' | 'goodbye';
  role: ParticipantRole;
  name: string;
  participantId: string;
  timestamp: number;
}

export interface ConnectedParticipant {
  id: string;
  name: string;
  role: ParticipantRole;
  lastSeen: number;
  isMuted: boolean;
}

export interface PresenceState {
  participants: Map<string, ConnectedParticipant>;
  presenter: ConnectedParticipant | null;
  viewers: ConnectedParticipant[];
}

// === Chat ===
export type ChatMessageType = 'user' | 'system';

export interface ChatMessage {
  id: string;
  type: ChatMessageType;
  content: string;
  senderName: string;
  senderRole: ParticipantRole;
  timestamp: number;
}

export interface SystemEvent {
  type: 'join' | 'leave' | 'screen_start' | 'screen_stop';
  participantName: string;
  timestamp: number;
}

// === Control Messages ===
export interface MuteCommand {
  type: 'mute_command';
  targetParticipantId: string;
}

// === Room State ===
export interface RoomInfo {
  name: string;
  createdAt: number;
  presenterName: string;
}

// === API ===
export interface TokenRequest {
  roomName: string;
  participantName: string;
  role: ParticipantRole;
}

export interface TokenResponse {
  token: string;
  url: string;
}

export interface ConfigStatus {
  configured: boolean;
}

export interface ConfigPayload {
  url: string;
  apiKey: string;
  apiSecret: string;
}
```

---

## Package.json Dependencies

```json
{
  "name": "livekit-v1-screen-share",
  "version": "1.0.0",
  "dependencies": {
    "react": "17.0.2",
    "react-dom": "17.0.2",
    "react-router-dom": "5.3.0",
    "livekit-client": "^1.6.0"
  },
  "devDependencies": {
    "typescript": "~4.0.8",
    "@types/react": "^17.0.0",
    "@types/react-dom": "^17.0.0",
    "@types/react-router-dom": "^5.3.0"
  },
  "server": {
    "dependencies": {
      "express": "^4.18.0",
      "cors": "^2.8.5",
      "livekit-server-sdk": "^1.2.7"
    }
  }
}
```

---

## Critical Implementation Notes

### 1. Viewer Stability Before First Screen

```typescript
// In useLiveKitRoom.ts - CRITICAL logic

const shouldAutoReconnect = useCallback(() => {
  // ONLY reconnect if we've seen a screen before
  // This prevents infinite reconnect loops when waiting
  return hasSeenScreenRef.current;
}, []);

// In connection state handler:
if (connectionState === ConnectionState.Disconnected) {
  if (shouldAutoReconnect()) {
    // Safe to reconnect - we've seen content before
    attemptReconnect();
  } else {
    // DO NOT reconnect - viewer is waiting for first screen
    // Stay disconnected or show "connection lost" state
  }
}
```

### 2. Presence as Source of Truth

```typescript
// ALWAYS use presence layer for participant lists, NOT LiveKit's participants
const { viewers } = usePresence({ room, role, name });

// NOT this:
// room.participants.forEach(...) // Unreliable in v1 for silent participants
```

### 3. System Audio Capture

```typescript
// When calling createLocalScreenTracks, audio: true captures system audio
const tracks = await createLocalScreenTracks({
  audio: true, // This captures system/tab audio, not microphone
  // For microphone, use createLocalAudioTrack separately
});
```

### 4. Fullscreen + Navigation

```typescript
// Presenter navigation should NOT stop the share
// Use React Router's history API carefully
history.push('/other-page'); // This doesn't stop MediaStreamTracks
// The share continues because the tracks are attached to the room, not the component
```

---

## Testing Checklist

- [ ] Viewer joins before presenter - stays in waiting state without reconnect loops
- [ ] Presenter can see viewer list via presence layer before sharing
- [ ] Screen share includes system audio
- [ ] Chat messages persist during share start/stop
- [ ] System messages appear for join/leave/share events
- [ ] Presenter can mute individual viewers
- [ ] Soft-lock warning appears on blur/escape
- [ ] beforeunload guard prevents accidental close
- [ ] Config persists server-side between sessions
- [ ] Viewers never see config entry screen
