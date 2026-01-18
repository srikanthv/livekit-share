import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  Participant,
  RemoteParticipant,
  LocalParticipant,
  RemoteTrackPublication,
  LocalTrackPublication,
  ConnectionState,
  TrackPublication,
} from 'livekit-client';
import { supabase } from '@/integrations/supabase/client';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'waiting' | 'live' | 'ended' | 'error';

interface UseLiveKitRoomProps {
  roomId: string;
  role: 'presenter' | 'viewer';
  livekitUrl: string;
}

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
  
  const roomRef = useRef<Room | null>(null);

  const updateParticipants = useCallback(() => {
    if (roomRef.current) {
      const remotes = Array.from(roomRef.current.remoteParticipants.values());
      setParticipants(remotes);
      setLocalParticipant(roomRef.current.localParticipant);
    }
  }, []);

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
      setStatus('live');
    } else if (roomRef.current?.state === ConnectionState.Connected) {
      setStatus('waiting');
    }
  }, [findScreenTrack]);

  const connect = useCallback(async () => {
    try {
      setStatus('connecting');
      setError(null);

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
      });

      roomRef.current = newRoom;
      setRoom(newRoom);

      // Set up event handlers
      newRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
        console.log('Connection state:', state);
        if (state === ConnectionState.Connected) {
          setStatus('waiting');
          updateParticipants();
          updateScreenTrack();
        } else if (state === ConnectionState.Disconnected) {
          setStatus('ended');
        }
      });

      newRoom.on(RoomEvent.ParticipantConnected, () => {
        updateParticipants();
      });

      newRoom.on(RoomEvent.ParticipantDisconnected, () => {
        updateParticipants();
        updateScreenTrack();
      });

      newRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.log('Track subscribed:', track.source);
        updateScreenTrack();
        updateParticipants();
      });

      newRoom.on(RoomEvent.TrackUnsubscribed, () => {
        updateScreenTrack();
        updateParticipants();
      });

      newRoom.on(RoomEvent.TrackPublished, () => {
        updateScreenTrack();
      });

      newRoom.on(RoomEvent.TrackUnpublished, () => {
        updateScreenTrack();
      });

      newRoom.on(RoomEvent.LocalTrackPublished, () => {
        updateScreenTrack();
        updateParticipants();
      });

      newRoom.on(RoomEvent.LocalTrackUnpublished, () => {
        updateScreenTrack();
        updateParticipants();
      });

      // Connect to room
      await newRoom.connect(livekitUrl, tokenData.token);
      console.log('Connected to room:', roomId);

    } catch (err) {
      console.error('Connection error:', err);
      setError(err instanceof Error ? err.message : 'Connection failed');
      setStatus('error');
    }
  }, [roomId, role, livekitUrl, updateParticipants, updateScreenTrack]);

  const disconnect = useCallback(async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
      setRoom(null);
      setStatus('ended');
    }
  }, []);

  const startScreenShare = useCallback(async () => {
    if (!roomRef.current) return;
    
    try {
      await roomRef.current.localParticipant.setScreenShareEnabled(true, {
        audio: true, // Include system audio
        resolution: { width: 1920, height: 1080 },
        contentHint: 'detail',
      });
      setIsScreenSharing(true);
      updateScreenTrack();
    } catch (err) {
      console.error('Screen share error:', err);
      setError(err instanceof Error ? err.message : 'Failed to start screen share');
    }
  }, [updateScreenTrack]);

  const stopScreenShare = useCallback(async () => {
    if (!roomRef.current) return;
    
    try {
      await roomRef.current.localParticipant.setScreenShareEnabled(false);
      setIsScreenSharing(false);
      updateScreenTrack();
    } catch (err) {
      console.error('Stop screen share error:', err);
    }
  }, [updateScreenTrack]);

  const toggleMicrophone = useCallback(async () => {
    if (!roomRef.current) return;
    
    try {
      const newState = !isMicEnabled;
      await roomRef.current.localParticipant.setMicrophoneEnabled(newState);
      setIsMicEnabled(newState);
    } catch (err) {
      console.error('Mic toggle error:', err);
      setError(err instanceof Error ? err.message : 'Failed to toggle microphone');
    }
  }, [isMicEnabled]);

  const toggleSpeaker = useCallback(() => {
    setIsSpeakerEnabled(prev => !prev);
    
    // Mute/unmute all audio tracks from remote participants
    if (roomRef.current) {
      for (const participant of roomRef.current.remoteParticipants.values()) {
        for (const pub of participant.audioTrackPublications.values()) {
          if (pub.track) {
            pub.track.setMuted(!isSpeakerEnabled);
          }
        }
      }
    }
  }, [isSpeakerEnabled]);

  const muteParticipant = useCallback(async (participantIdentity: string, muted: boolean) => {
    if (!roomRef.current) return;
    
    const participant = roomRef.current.remoteParticipants.get(participantIdentity);
    if (participant) {
      for (const pub of participant.audioTrackPublications.values()) {
        if (pub.track) {
          pub.track.setMuted(muted);
        }
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
    };
  }, []);

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
    connect,
    disconnect,
    startScreenShare,
    stopScreenShare,
    toggleMicrophone,
    toggleSpeaker,
    muteParticipant,
  };
}
