// Audio fingerprinting handlers (live phone-microphone path).
// Split from socket/events.js so the audio DSP, transport, and broadcast
// concerns are isolated from business logic.

const { logger } = require('../utils');
const { ackSuccess, ackError } = require('./ack');
const { audioTracksService, sharedRamMatcher } = require('../services');
const {
  TARGET_SAMPLE_RATE,
  resampleLinear,
} = require('../services/audio-recognition/wav');
const { StreamingFingerprinter } = require('../services/audio-recognition/streaming');
const { isValidId } = require('./shared-validators');

function assertAudioEventAccess(socket, eventId) {
  if (!isValidId(eventId)) throw new Error('Invalid event ID');
  if (
    socket.user?.type === 'phone-microphone' &&
    socket.user.eventId !== eventId
  ) {
    throw new Error('Invalid phone microphone token');
  }
  return audioTracksService.listTracks(eventId, socket.user);
}

function extractFloat32Pcm(payload) {
  if (payload instanceof Float32Array) return payload;
  if (payload instanceof ArrayBuffer) return new Float32Array(payload);
  if (Buffer.isBuffer(payload)) {
    if (payload.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error(`Invalid Float32 PCM byte length: ${payload.byteLength}`);
    }
    return new Float32Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  }
  if (ArrayBuffer.isView(payload)) {
    if (payload.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error(`Invalid typed PCM byte length: ${payload.byteLength}`);
    }
    return new Float32Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  }
  throw new Error(`Unsupported audio chunk payload: ${typeof payload}`);
}

const handleAudioMatchStart = async (socket, io, data, callback) => {
  try {
    const { eventId, sampleRate } = data || {};
    logger.info('Audio match start', { eventId, sampleRate: sampleRate ?? 'not provided' });
    await assertAudioEventAccess(socket, eventId);
    await sharedRamMatcher.loadEvent(eventId);
    socket.audioMatch = {
      eventId,
      fingerprinter: new StreamingFingerprinter(TARGET_SAMPLE_RATE),
      ramMatcher: sharedRamMatcher,
      inputSampleRate: sampleRate,
      lastEmitAt: 0,
    };
    ackSuccess(callback, { eventId });
  } catch (error) {
    logger.error('Error starting audio matcher:', error);
    ackError(callback, error);
  }
};

const handleAudioMatchChunk = async (socket, io, data, callback) => {
  try {
    if (!socket.audioMatch) {
      if (socket._audioMatchLoading) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!socket.audioMatch) throw new Error('Audio matcher failed to start');
      } else {
        socket._audioMatchLoading = true;
        try {
          const { eventId, sampleRate } = data || {};
          if (socket.user?.type === 'phone-microphone' && eventId) {
            logger.info('Auto-starting audio matcher for phone microphone', { eventId, sampleRate });
            await sharedRamMatcher.loadEvent(eventId);
            socket.audioMatch = {
              eventId,
              fingerprinter: new StreamingFingerprinter(TARGET_SAMPLE_RATE),
              ramMatcher: sharedRamMatcher,
              inputSampleRate: sampleRate,
              lastEmitAt: 0,
            };
          } else {
            throw new Error('Audio matcher has not started');
          }
        } finally {
          socket._audioMatchLoading = false;
        }
      }
    }

    const session = socket.audioMatch;
    const rawSamples = extractFloat32Pcm(data?.pcm ?? data);

    const chunkSampleRate = data?.sampleRate;
    const inputSampleRate = Number.isFinite(chunkSampleRate) && chunkSampleRate > 0
      ? chunkSampleRate
      : (session.inputSampleRate || TARGET_SAMPLE_RATE);

    if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
      throw new Error(
        `Invalid audio chunk sampleRate: ${data?.sampleRate ?? session.inputSampleRate}`,
      );
    }
    const samples = inputSampleRate === TARGET_SAMPLE_RATE
      ? rawSamples
      : resampleLinear(rawSamples, inputSampleRate, TARGET_SAMPLE_RATE);

    const hashes = session.fingerprinter.process(samples) ?? [];
    const now = Date.now();
    const AUDIO_MATCH_INTERVAL_MS = 700;

    if (!session._lastDebugLogAt || now - session._lastDebugLogAt > 60000) {
      session._lastDebugLogAt = now;
      logger.info('Audio match debug', {
        eventId: session.eventId,
        inputSampleRate,
        targetSampleRate: TARGET_SAMPLE_RATE,
        rawSamplesLength: rawSamples.length,
        resampledSamplesLength: samples.length,
        hashesGenerated: hashes.length,
      });
    }

    // Waveform emit throttled to 400 ms (50 KB/s/phone vs 128 KB/s at 100 ms).
    const WAVEFORM_EMIT_INTERVAL_MS = 400;
    if (now - (session.lastWaveformAt || 0) > WAVEFORM_EMIT_INTERVAL_MS) {
      session.lastWaveformAt = now;
      socket.to(`event:${session.eventId}`).emit('phone_audio_stream', {
        eventId: session.eventId,
        pcm: Array.from(rawSamples),
        sampleRate: inputSampleRate,
        timestamp: Date.now(),
      });
    }

    if (hashes.length && now - session.lastEmitAt > AUDIO_MATCH_INTERVAL_MS) {
      session.lastEmitAt = now;
      const matches = session.ramMatcher.match(session.eventId, hashes);
      logger.info('audio_match_update', {
        eventId: session.eventId,
        matchCount: matches?.length || 0,
        topMatch: matches?.[0] ? { title: matches[0].title, artist: matches[0].artist, score: matches[0].score } : null,
      });
      socket.emit('audio_match_update', {
        eventId: session.eventId,
        matches,
        timestamp: new Date().toISOString(),
      });
    }

    ackSuccess(callback, {
      hashes: hashes.length,
      inputSamples: rawSamples.length,
      normalizedSamples: samples.length,
      inputSampleRate,
      targetSampleRate: TARGET_SAMPLE_RATE,
    });
  } catch (error) {
    logger.error('Error matching audio chunk:', {
      message: error.message,
      dataType: data?.constructor?.name,
      pcmType: data?.pcm?.constructor?.name,
    });
    ackError(callback, error);
  }
};

const handleAudioMatchStop = async (socket, io, data, callback) => {
  try {
    logger.info('Audio match stop requested', { hadAudioMatch: Boolean(socket.audioMatch) });
    if (socket.audioMatch) {
      const { eventId, fingerprinter, ramMatcher } = socket.audioMatch;
      const hashes = fingerprinter.flush();
      const matches = ramMatcher.match(eventId, hashes);
      socket.emit('audio_match_update', {
        eventId,
        matches,
        timestamp: new Date().toISOString(),
      });
    }
    socket.audioMatch = null;
    ackSuccess(callback, { stopped: true });
  } catch (error) {
    logger.error('Error stopping audio matcher:', error);
    ackError(callback, error);
  }
};

module.exports = {
  handleAudioMatchStart,
  handleAudioMatchChunk,
  handleAudioMatchStop,
  assertAudioEventAccess,
  extractFloat32Pcm,
};
