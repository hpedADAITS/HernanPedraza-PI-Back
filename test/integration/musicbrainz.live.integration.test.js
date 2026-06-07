const runLive = process.env.MUSICBRAINZ_LIVE_TESTS === 'true';
const describeLive = runLive ? describe : describe.skip;

describeLive('musicbrainz live integration', () => {
  jest.setTimeout(15000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('queries live MusicBrainz once for attendee typo candidates', async () => {
    jest.resetModules();
    const originalFetch = global.fetch.bind(global);
    const requestedUrls = [];

    jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
      requestedUrls.push(url);
      return originalFetch(url, options);
    });

    const musicBrainzService = require('../../src/services/musicbrainz.service');
    const typoMatches = await musicBrainzService.findRecordingMatches('smells teen spirit', 'nirvana');

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls.every((url) => url.hostname === 'musicbrainz.org')).toBe(true);
    expect(typoMatches).toContainEqual(expect.objectContaining({
      source: 'musicbrainz',
      title: expect.stringMatching(/Smells Like Teen Spirit/i),
      artist: expect.stringMatching(/Nirvana/i),
    }));
  });
});
