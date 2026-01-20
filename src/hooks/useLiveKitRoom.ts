import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  RemoteParticipant,
  LocalParticipant,
  ConnectionState,
  RemoteTrack,
  RemoteTrackPublication,
} from 'livekit-client';
import { supabase } from '@/integrations/supabase/client';

// Extended state machine for enterprise-grade connection handling
export type ConnectionStatus = 
  | 'idle' 
  | 'connecting' 
  | 'connected' 
  | 'publishing'
  | 'waiting' 
  | 'live' 
  | 'reconnecting'
  | 'failed'
  | 'ended' 
  | 'error';

interface UseLiveKitRoomProps {
  roomId: string;
  role: 'presenter' | 'viewer';
  livekitUrl: string;
}

// Session logging helper
const createLogger = (sessionId: string) => {
  const log = (group: string, message: string, data?: unknown) => {
    console.group(`[LiveKit:${sessionId}] ${group}`);
    console.log(message, data ?? '');
    console.groupEnd();
  };
  return log;
};

export function useLiveKitRoom({ roomId, role, livekitUrl }: UseLiveKitRoomProps) {
  const [room, setRoom] = useState<Room | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null);
  const [screenTrack, setScreenTrack] = useState<Track | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isSpeakerEnabled, setIsSpeakerEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  
  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const attachedTracksRef = useRef<Map<string, HTMLMediaElement>>(new Map());
  const wasScreenSharingRef = useRef(false);
  const wasMicEnabledRef = useRef(false);
  const mediaTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sessionIdRef = useRef(`${Date.now()}`);
  const log = createLogger(sessionIdRef.current);

  // Create a hidden container for audio elements
  useEffect(() => {
    if (!audioContainerRef.current) {
      const container = document.createElement('div');
      container.id = 'livekit-audio-container';
      container.style.display = 'none';
      document.body.appendChild(container);
      audioContainerRef.current = container;
    }
    
    return () => {
      if (audioContainerRef.current) {
        audioContainerRef.current.remove();
        audioContainerRef.current = null;
      }
    };
  }, []);

  // Clear media timeout
  const clearMediaTimeout = useCallback(() => {
    if (mediaTimeoutRef.current) {
      clearTimeout(mediaTimeoutRef.current);
      mediaTimeoutRef.current = null;
    }
  }, []);

  // Self-healing: Start media timeout for viewers
  const startMediaTimeout = useCallback((timeout = 8000) => {
    clearMediaTimeout();
    
    if (role === 'viewer') {
      mediaTimeoutRef.current = setTimeout(() => {
        log('MediaTimeout', 'No media received within timeout, attempting reconnect');
        setError('Waiting for media... retrying connection');
        // Trigger auto-reconnect
        if (roomRef.current) {
          roomRef.current.disconnect().then(() => {
            setStatus('idle');
          });
        }
      }, timeout);
    }
  }, [role, clearMediaTimeout, log]);

  const updateParticipants = useCallback(() => {
    if (roomRef.current) {
      const remotes = Array.from(roomRef.current.remoteParticipants.values());
      setParticipants([...remotes]);
      setLocalParticipant(roomRef.current.localParticipant);
      log('Participants', `Updated: ${remotes.length + 1} total`);
    }
  }, [log]);

  const findScreenTrack = useCallback(() => {
    if (!roomRef.current) return null;
    
    // Check local participant first (for presenter)
    for (const pub of roomRef.current.localParticipant.trackPublications.values()) {
      if (pub.track && pub.source === Track.Source.ScreenShare) {
        return pub.track;
      }
    }
    
    // Check remote participants (for viewer)
    for (const participant of roomRef.current.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) {
        if (pub.track && pub.source === Track.Source.ScreenShare) {
          return pub.track;
        }
      }
    }
    
    return null;
  }, []);

  const updateScreenTrack = useCallback(() => {
    const track = findScreenTrack();
    setScreenTrack(track);
    
    if (track) {
      clearMediaTimeout(); // Cancel timeout since we got media
      setStatus('live');
      log('ScreenTrack', 'Stream is live');
    } else if (roomRef.current?.state === ConnectionState.Connected) {
      setStatus('waiting');
    }
  }, [findScreenTrack, clearMediaTimeout, log]);

  // Attach audio track manually for proper playback
  const attachAudioTrack = useCallback((track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
    if (track.kind !== Track.Kind.Audio) return;
    
    const trackId = `${participant.identity}-${publication.trackSid}`;
    
    // Don't attach if already attached
    if (attachedTracksRef.current.has(trackId)) {
      log('AudioTrack', `Already attached: ${trackId}`);
      return;
    }
    
    log('AudioTrack', `Attaching: ${trackId} from ${participant.identity}`);
    
    const audioElement = track.attach() as HTMLAudioElement;
    audioElement.autoplay = true;
    audioElement.setAttribute('playsinline', 'true');
    audioElement.muted = false;
    audioElement.id = trackId;
    
    // Apply current speaker state
    audioElement.muted = !isSpeakerEnabled;
    
    if (audioContainerRef.current) {
      audioContainerRef.current.appendChild(audioElement);
    } else {
      document.body.appendChild(audioElement);
    }
    
    attachedTracksRef.current.set(trackId, audioElement);
    
    // Clear media timeout - we got audio
    clearMediaTimeout();
    
    // Try to play (may fail if no user interaction yet)
    audioElement.play().catch(err => {
      log('AudioTrack', `Autoplay blocked: ${err.message}`);
    });
  }, [isSpeakerEnabled, clearMediaTimeout, log]);

  // Detach audio track
  const detachAudioTrack = useCallback((track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
    const trackId = `${participant.identity}-${publication.trackSid}`;
    
    const element = attachedTracksRef.current.get(trackId);
    if (element) {
      log('AudioTrack', `Detaching: ${trackId}`);
      track.detach(element);
      element.remove();
      attachedTracksRef.current.delete(trackId);
    }
  }, [log]);

  // Update speaker mute state on all attached audio elements
  const updateSpeakerMuteState = useCallback((muted: boolean) => {
    attachedTracksRef.current.forEach((element) => {
      if (element instanceof HTMLAudioElement) {
        element.muted = muted;
      }
    });
  }, []);

  // Rehydrate media after reconnect
  const rehydrateMedia = useCallback(async () => {
    if (!roomRef.current) return;
    
    log('Rehydrate', 'Restoring media state after reconnect');
    
    try {
      // Always restore microphone
      if (wasMicEnabledRef.current) {
        await roomRef.current.localParticipant.setMicrophoneEnabled(true);
        setIsMicEnabled(true);
        log('Rehydrate', 'Microphone restored');
      }
      
      // Restore screen share for presenter
      if (role === 'presenter' && wasScreenSharingRef.current) {
        await roomRef.current.localParticipant.setScreenShareEnabled(true, {
          audio: true,
          resolution: { width: 1920, height: 1080 },
          contentHint: 'detail',
        });
        setIsScreenSharing(true);
        log('Rehydrate', 'Screen share restored');
      }
      
      updateScreenTrack();
    } catch (err) {
      log('Rehydrate', `Failed to restore media: ${err}`);
    }
  }, [role, updateScreenTrack, log]);

  // Reattach all existing audio tracks
  const reattachAllAudioTracks = useCallback(() => {
    if (!roomRef.current) return;
    
    log('Reattach', 'Reattaching all audio tracks');
    
    for (const participant of roomRef.current.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) {
        if (pub.track && pub.track.kind === Track.Kind.Audio) {
          attachAudioTrack(
            pub.track as RemoteTrack, 
            pub as RemoteTrackPublication, 
            participant
          );
        }
      }
    }
  }, [attachAudioTrack, log]);

  const connect = useCallback(async () => {
    try {
      setStatus('connecting');
      setError(null);
      setReconnectAttempts(0);
      
      log('Connection', `Starting connection to room: ${roomId}, role: ${role}`);

      // Generate token server-side
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke('generate-token', {
        body: { roomId, role },
      });

      if (tokenError || tokenData.error) {
        throw new Error(tokenError?.message || tokenData.error || 'Failed to generate token');
      }

      const newRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          screenShareEncoding: {
            maxBitrate: 3_000_000,
            maxFramerate: 30,
          },
        },
        reconnectPolicy: {
          // Custom reconnect policy for resilience
          nextRetryDelayInMs: (context) => {
            // Exponential backoff: 500ms, 1s, 2s, 4s, max 8s
            const delay = Math.min(500 * Math.pow(2, context.retryCount), 8000);
            log('Reconnect', `Retry ${context.retryCount + 1}, delay: ${delay}ms`);
            return delay;
          },
        },
      });

      roomRef.current = newRoom;
      setRoom(newRoom);

      // === STATE MACHINE EVENT HANDLERS ===
      
      // Connection state changes
      newRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
        log('State', `Connection state: ${state}`);
        
        switch (state) {
          case ConnectionState.Connected:
            setStatus('connected');
            updateParticipants();
            updateScreenTrack();
            break;
          case ConnectionState.Disconnected:
            setStatus('ended');
            clearMediaTimeout();
            break;
          case ConnectionState.Reconnecting:
            setStatus('reconnecting');
            setReconnectAttempts(prev => prev + 1);
            break;
        }
      });

      // Reconnected - restore media
      newRoom.on(RoomEvent.Reconnected, () => {
        log('State', 'Reconnected successfully');
        setStatus('connected');
        rehydrateMedia();
        reattachAllAudioTracks();
      });

      // Disconnected with reason
      newRoom.on(RoomEvent.Disconnected, (reason) => {
        log('State', `Disconnected: ${reason}`);
        setStatus('ended');
        clearMediaTimeout();
      });

      // Connection quality
      newRoom.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        log('Quality', `${participant.identity}: ${quality}`);
      });

      // Participant events
      newRoom.on(RoomEvent.ParticipantConnected, (participant) => {
        log('Participant', `Connected: ${participant.identity}`);
        updateParticipants();
      });

      newRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
        log('Participant', `Disconnected: ${participant.identity}`);
        updateParticipants();
        updateScreenTrack();
      });

      // CRITICAL: Manually attach audio tracks for reliable playback
      newRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        log('Track', `Subscribed: ${track.kind}/${track.source} from ${participant.identity}`);
        
        if (track.kind === Track.Kind.Audio) {
          attachAudioTrack(track as RemoteTrack, publication as RemoteTrackPublication, participant as RemoteParticipant);
        }
        
        updateScreenTrack();
        updateParticipants();
      });

      newRoom.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        log('Track', `Unsubscribed: ${track.kind} from ${participant.identity}`);
        
        if (track.kind === Track.Kind.Audio) {
          detachAudioTrack(track as RemoteTrack, publication as RemoteTrackPublication, participant as RemoteParticipant);
        }
        
        updateScreenTrack();
        updateParticipants();
      });

      newRoom.on(RoomEvent.TrackPublished, (publication, participant) => {
        log('Track', `Published: ${publication.kind} by ${participant.identity}`);
        updateScreenTrack();
      });

      newRoom.on(RoomEvent.TrackUnpublished, (publication, participant) => {
        log('Track', `Unpublished: ${publication.kind} by ${participant.identity}`);
        updateScreenTrack();
      });

      newRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
        log('Track', `Local published: ${publication.kind}`);
        setStatus('publishing');
        updateScreenTrack();
        updateParticipants();
      });

      newRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        log('Track', `Local unpublished: ${publication.kind}`);
        updateScreenTrack();
        updateParticipants();
      });

      // Track mute state changes
      newRoom.on(RoomEvent.TrackMuted, (publication, participant) => {
        log('Track', `Muted: ${publication.kind} by ${participant.identity}`);
        updateParticipants();
      });

      newRoom.on(RoomEvent.TrackUnmuted, (publication, participant) => {
        log('Track', `Unmuted: ${publication.kind} by ${participant.identity}`);
        updateParticipants();
      });

      // Media device errors
      newRoom.on(RoomEvent.MediaDevicesError, (error: Error) => {
        log('Error', `Media device error: ${error.message}`);
        setError(`Media error: ${error.message}`);
      });

      // Connect to room
      await newRoom.connect(livekitUrl, tokenData.token);
      log('Connection', `Connected to room: ${roomId}`);

      // CRITICAL: Enable microphone immediately after connecting
      setStatus('publishing');
      try {
        await newRoom.localParticipant.setMicrophoneEnabled(true);
        setIsMicEnabled(true);
        wasMicEnabledRef.current = true;
        log('Mic', 'Microphone enabled after connect');
      } catch (micErr) {
        log('Mic', `Could not enable microphone: ${micErr}`);
        // Don't fail the connection if mic fails
      }

      // Start media timeout for viewers
      startMediaTimeout();
      
      updateParticipants();
      setStatus('waiting');

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Connection failed';
      log('Error', `Connection failed: ${errorMessage}`);
      setError(errorMessage);
      setStatus('failed');
    }
  }, [roomId, role, livekitUrl, updateParticipants, updateScreenTrack, attachAudioTrack, detachAudioTrack, rehydrateMedia, reattachAllAudioTracks, clearMediaTimeout, startMediaTimeout, log]);

  const disconnect = useCallback(async () => {
    if (roomRef.current) {
      log('Connection', 'Disconnecting');
      
      // Clean up all attached audio elements
      attachedTracksRef.current.forEach((element, trackId) => {
        log('Cleanup', `Removing audio element: ${trackId}`);
        element.remove();
      });
      attachedTracksRef.current.clear();
      clearMediaTimeout();
      
      await roomRef.current.disconnect();
      roomRef.current = null;
      setRoom(null);
      setStatus('ended');
      setIsMicEnabled(false);
      setIsScreenSharing(false);
      wasScreenSharingRef.current = false;
      wasMicEnabledRef.current = false;
    }
  }, [clearMediaTimeout, log]);

  // Manual recovery: Rejoin
  const rejoin = useCallback(async () => {
    log('Recovery', 'Manual rejoin triggered');
    await disconnect();
    // Small delay to ensure clean state
    await new Promise(resolve => setTimeout(resolve, 500));
    await connect();
  }, [disconnect, connect, log]);

  // Manual recovery: Restart audio only
  const restartAudio = useCallback(async () => {
    log('Recovery', 'Restarting audio');
    
    if (!roomRef.current) return;
    
    try {
      // Disable and re-enable microphone
      await roomRef.current.localParticipant.setMicrophoneEnabled(false);
      await new Promise(resolve => setTimeout(resolve, 200));
      await roomRef.current.localParticipant.setMicrophoneEnabled(true);
      setIsMicEnabled(true);
      wasMicEnabledRef.current = true;
      
      // Reattach all audio tracks
      reattachAllAudioTracks();
      
      // Force play all audio elements
      attachedTracksRef.current.forEach((element) => {
        if (element instanceof HTMLAudioElement) {
          element.play().catch(err => {
            log('Recovery', `Audio play failed: ${err.message}`);
          });
        }
      });
      
      log('Recovery', 'Audio restarted successfully');
    } catch (err) {
      log('Recovery', `Audio restart failed: ${err}`);
      setError('Failed to restart audio. Try rejoining.');
    }
  }, [reattachAllAudioTracks, log]);

  const startScreenShare = useCallback(async () => {
    if (!roomRef.current) return;
    
    try {
      log('ScreenShare', 'Starting screen share');
      await roomRef.current.localParticipant.setScreenShareEnabled(true, {
        audio: true, // Include system audio
        resolution: { width: 1920, height: 1080 },
        contentHint: 'detail',
      });
      setIsScreenSharing(true);
      wasScreenSharingRef.current = true;
      updateScreenTrack();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start screen share';
      log('ScreenShare', `Error: ${errorMessage}`);
      setError(errorMessage);
    }
  }, [updateScreenTrack, log]);

  const stopScreenShare = useCallback(async () => {
    if (!roomRef.current) return;
    
    try {
      log('ScreenShare', 'Stopping screen share');
      await roomRef.current.localParticipant.setScreenShareEnabled(false);
      setIsScreenSharing(false);
      wasScreenSharingRef.current = false;
      updateScreenTrack();
    } catch (err) {
      log('ScreenShare', `Stop error: ${err}`);
    }
  }, [updateScreenTrack, log]);

  const toggleMicrophone = useCallback(async () => {
    if (!roomRef.current) return;
    
    try {
      const newState = !isMicEnabled;
      await roomRef.current.localParticipant.setMicrophoneEnabled(newState);
      setIsMicEnabled(newState);
      wasMicEnabledRef.current = newState;
      log('Mic', `Toggled: ${newState}`);
      updateParticipants();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to toggle microphone';
      log('Mic', `Toggle error: ${errorMessage}`);
      setError(errorMessage);
    }
  }, [isMicEnabled, updateParticipants, log]);

  const toggleSpeaker = useCallback(() => {
    const newState = !isSpeakerEnabled;
    setIsSpeakerEnabled(newState);
    
    // Mute/unmute all audio elements (not tracks)
    updateSpeakerMuteState(!newState);
    log('Speaker', `Toggled: ${newState}`);
  }, [isSpeakerEnabled, updateSpeakerMuteState, log]);

  // Presenter can mute/unmute remote participants locally
  const muteParticipant = useCallback((participantIdentity: string, muted: boolean) => {
    if (!roomRef.current) return;
    
    // Find and mute/unmute audio elements for this participant
    attachedTracksRef.current.forEach((element, trackId) => {
      if (trackId.startsWith(participantIdentity) && element instanceof HTMLAudioElement) {
        element.muted = muted;
        log('Mute', `Participant ${participantIdentity}: ${muted}`);
      }
    });
    
    updateParticipants();
  }, [updateParticipants, log]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearMediaTimeout();
      
      // Clean up audio elements
      attachedTracksRef.current.forEach((element) => {
        element.remove();
      });
      attachedTracksRef.current.clear();
      
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
    };
  }, [clearMediaTimeout]);

  return {
    room,
    status,
    error,
    participants,
    localParticipant,
    screenTrack,
    isMicEnabled,
    isSpeakerEnabled,
    isScreenSharing,
    reconnectAttempts,
    connect,
    disconnect,
    rejoin,
    restartAudio,
    startScreenShare,
    stopScreenShare,
    toggleMicrophone,
    toggleSpeaker,
    muteParticipant,
  };
}
