// Optional Steam Web API access. Only used when STEAM_API_KEY is set
// (in the environment or in .env.local); the paste-based import needs no key.

const API = 'https://api.steampowered.com';

export async function steamOwnedGames(profile: string, key: string | undefined) {
  if (!key) {
    throw new Error(
      'No Steam API key configured. Paste your library instead, or put STEAM_API_KEY=… in .env.local and restart the dev server.',
    );
  }
  const input = profile.trim();
  let steamId = input.match(/\b(7656\d{13})\b/)?.[1];
  if (!steamId) {
    const vanity = input.match(/steamcommunity\.com\/id\/([^/?#]+)/)?.[1] ?? input;
    const r = await fetch(`${API}/ISteamUser/ResolveVanityURL/v1/?key=${key}&vanityurl=${encodeURIComponent(vanity)}`);
    steamId = (await r.json())?.response?.steamid;
    if (!steamId) throw new Error(`Couldn't find a Steam profile called “${vanity}”`);
  }
  const r = await fetch(
    `${API}/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`,
  );
  if (!r.ok) throw new Error(`Steam responded ${r.status}`);
  const games = (await r.json())?.response?.games;
  if (!games?.length) {
    throw new Error('No games returned: set “Game details” to Public in your Steam privacy settings.');
  }
  return games.map((g: { appid: number; name: string; playtime_forever: number }) => ({
    appid: g.appid,
    name: g.name,
    playtime_forever: g.playtime_forever,
  }));
}
