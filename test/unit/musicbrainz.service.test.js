describe('musicbrainz service', () => {
  const loadService = () => {
    jest.resetModules();
    return require('../../src/services/musicbrainz.service');
  };

  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  test('searches recordings in JSON mode with a user agent and caches matches', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        recordings: [{
          title: 'Harder, Better, Faster, Stronger',
          score: 100,
          length: 224000,
          'artist-credit': [{ artist: { name: 'Daft Punk' } }],
        }],
      }),
    });

    const service = loadService();
    const first = await service.findRecordingMatch(
      'harder better faster stronger',
      'daft punk',
      224,
    );
    const second = await service.findRecordingMatch(
      'harder better faster stronger',
      'daft punk',
      224,
    );

    expect(first).toEqual({
      source: 'musicbrainz',
      recordingId: null,
      releaseId: null,
      title: 'Harder, Better, Faster, Stronger',
      artist: 'Daft Punk',
      coverUrl: null,
      duration: 224,
      score: expect.any(Number),
      matchedOn: 'title_artist',
    });
    expect(first.duration).toBe(224);
    expect(second).toEqual(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url.searchParams.get('fmt')).toBe('json');
    expect(url.pathname).toBe('/ws/2/recording');
    expect(options.headers.Accept).toBe('application/json');
    expect(options.headers['User-Agent']).toContain('Syncrequest');
    expect(options.headers['User-Agent']).toContain('github.com/hpedadaits/hernanpedraza-pi-back');
  });

  test('spaces uncached requests by at least 1.5 seconds', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ recordings: [] }) });

    const service = loadService();
    const first = service.findRecordingMatch('Song A', 'Artist A', 180);
    await Promise.resolve();
    await first;

    const second = service.findRecordingMatch('Song B', 'Artist B', 180);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1499);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await second;
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('returns null when MusicBrainz is unavailable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    await expect(loadService().findRecordingMatch('Song', 'Artist', 180)).resolves.toBeNull();
  });
});
