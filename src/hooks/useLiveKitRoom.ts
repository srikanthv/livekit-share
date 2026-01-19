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
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const attachedTracksRef = useRef<Map<string, HTMLMediaElement>>(new Map());

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

  const updateParticipants = useCallback(() => {
    if (roomRef.current) {
      const remotes = Array.from(roomRef.current.remoteParticipants.values());
      setParticipants([...remotes]); // Create new array to trigger re-render
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

  // Attach audio track manually for proper playback
  const attachAudioTrack = useCallback((track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
    if (track.kind !== Track.Kind.Audio) return;
    
    const trackId = `${participant.identity}-${publication.trackSid}`;
    
    // Don't attach if already attached
    if (attachedTracksRef.current.has(trackId)) {
      console.log('Audio track already attached:', trackId);
      return;
    }
    
    console.log('Attaching audio track:', trackId, 'from', participant.identity);
    
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
    
    // Try to play (may fail if no user interaction yet)
    audioElement.play().catch(err => {
      console.warn('Audio autoplay blocked:', err);
    });
  }, [isSpeakerEnabled]);

  // Detach audio track
  const detachAudioTrack = useCallback((track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
    const trackId = `${participant.identity}-${publication.trackSid}`;
    
    const element = attachedTracksRef.current.get(trackId);
    if (element) {
      console.log('Detaching audio track:', trackId);
      track.detach(element);
      element.remove();
      attachedTracksRef.current.delete(trackId);
    }
  }, []);

  // Update speaker mute state on all attached audio elements
  const updateSpeakerMuteState = useCallback((muted: boolean) => {
    attachedTracksRef.current.forEach((element) => {
      if (element instanceof HTMLAudioElement) {
        element.muted = muted;
      }
    });
  }, []);

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

      // Set up event handlers BEFORE connecting
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

      newRoom.on(RoomEvent.ParticipantConnected, (participant) => {
        console.log('Participant connected:', participant.identity);
        updateParticipants();
      });

      newRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
        console.log('Participant disconnected:', participant.identity);
        updateParticipants();
        updateScreenTrack();
      });

      // CRITICAL: Manually attach audio tracks for reliable playback
      newRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.log('Track subscribed:', track.kind, track.source, 'from', participant.identity);
        
        if (track.kind === Track.Kind.Audio) {
          attachAudioTrack(track as RemoteTrack, publication as RemoteTrackPublication, participant as RemoteParticipant);
        }
        
        updateScreenTrack();
        updateParticipants();
      });

      newRoom.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        console.log('Track unsubscribed:', track.kind, 'from', participant.identity);
        
        if (track.kind === Track.Kind.Audio) {
          detachAudioTrack(track as RemoteTrack, publication as RemoteTrackPublication, participant as RemoteParticipant);
        }
        
        updateScreenTrack();
        updateParticipants();
      });

      newRoom.on(RoomEvent.TrackPublished, (publication, participant) => {
        console.log('Track published:', publication.kind, 'by', participant.identity);
        updateScreenTrack();
      });

      newRoom.on(RoomEvent.TrackUnpublished, (publication, participant) => {
        console.log('Track unpublished:', publication.kind, 'by', participant.identity);
        updateScreenTrack();
      });

      newRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
        console.log('Local track published:', publication.kind);
        updateScreenTrack();
        updateParticipants();
      });

      newRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        console.log('Local track unpublished:', publication.kind);
        updateScreenTrack();
        updateParticipants();
      });

      // Track mute state changes
      newRoom.on(RoomEvent.TrackMuted, (publication, participant) => {
        console.log('Track muted:', publication.kind, 'by', participant.identity);
        updateParticipants();
      });

      newRoom.on(RoomEvent.TrackUnmuted, (publication, participant) => {
        console.log('Track unmuted:', publication.kind, 'by', participant.identity);
        updateParticipants();
      });

      // Connect to room
      await newRoom.connect(livekitUrl, tokenData.token);
      console.log('Connected to room:', roomId);

      // CRITICAL: Enable microphone immediately after connecting
      // This ensures audio publishing works from the start
      try {
        await newRoom.localParticipant.setMicrophoneEnabled(true);
        setIsMicEnabled(true);
        console.log('Microphone enabled after connect');
      } catch (micErr) {
        console.warn('Could not enable microphone:', micErr);
        // Don't fail the connection if mic fails
      }

      updateParticipants();

    } catch (err) {
      console.error('Connection error:', err);
      setError(err instanceof Error ? err.message : 'Connection failed');
      setStatus('error');
    }
  }, [roomId, role, livekitUrl, updateParticipants, updateScreenTrack, attachAudioTrack, detachAudioTrack]);

  const disconnect = useCallback(async () => {
    if (roomRef.current) {
      // Clean up all attached audio elements
      attachedTracksRef.current.forEach((element, trackId) => {
        console.log('Cleaning up audio element:', trackId);
        element.remove();
      });
      attachedTracksRef.current.clear();
      
      await roomRef.current.disconnect();
      roomRef.current = null;
      setRoom(null);
      setStatus('ended');
      setIsMicEnabled(false);
      setIsScreenSharing(false);
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
      console.log('Microphone toggled:', newState);
      updateParticipants();
    } catch (err) {
      console.error('Mic toggle error:', err);
      setError(err instanceof Error ? err.message : 'Failed to toggle microphone');
    }
  }, [isMicEnabled, updateParticipants]);

  const toggleSpeaker = useCallback(() => {
    const newState = !isSpeakerEnabled;
    setIsSpeakerEnabled(newState);
    
    // Mute/unmute all audio elements (not tracks)
    updateSpeakerMuteState(!newState);
    console.log('Speaker toggled:', newState);
  }, [isSpeakerEnabled, updateSpeakerMuteState]);

  // Presenter can mute/unmute remote participants
  // Note: This mutes locally. To actually disable their mic, you'd need server-side control
  const muteParticipant = useCallback((participantIdentity: string, muted: boolean) => {
    if (!roomRef.current) return;
    
    // Find and mute/unmute audio elements for this participant
    attachedTracksRef.current.forEach((element, trackId) => {
      if (trackId.startsWith(participantIdentity) && element instanceof HTMLAudioElement) {
        element.muted = muted;
        console.log('Muted participant audio:', participantIdentity, muted);
      }
    });
    
    updateParticipants();
  }, [updateParticipants]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clean up audio elements
      attachedTracksRef.current.forEach((element) => {
        element.remove();
      });
      attachedTracksRef.current.clear();
      
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
