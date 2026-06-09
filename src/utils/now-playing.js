function getNowPlayingStartedAt(song) {
  return song?.playingStartedAt || song?.startedPlayingAt || song?.startedAt || null;
}

function getNowPlayingTotalDuration(song) {
  const total = Number(song?.totalDuration ?? song?.duration);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function getNowPlayingElapsedTime(song, startedAt = getNowPlayingStartedAt(song)) {
  if (Number.isFinite(Number(song?.elapsedTime))) {
    return Math.max(0, Math.floor(Number(song.elapsedTime)));
  }
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
}

function buildNowPlayingPayload(song) {
  const startedAt = getNowPlayingStartedAt(song);
  const totalDuration = getNowPlayingTotalDuration(song);
  const elapsedTime = getNowPlayingElapsedTime(song, startedAt);

  return {
    songId: song?._id || song?.id,
    title: song?.title,
    artist: song?.artist,
    recognitionMatch: song?.recognitionMatch || null,
    albumArt: song?.recognitionMatch?.coverUrl || null,
    totalDuration,
    duration: totalDuration,
    startedAt,
    playingStartedAt: startedAt,
    startedPlayingAt: startedAt,
    elapsedTime,
    remainingTime: totalDuration ? Math.max(0, totalDuration - elapsedTime) : null,
  };
}

module.exports = {
  buildNowPlayingPayload,
  getNowPlayingElapsedTime,
  getNowPlayingStartedAt,
  getNowPlayingTotalDuration,
};
