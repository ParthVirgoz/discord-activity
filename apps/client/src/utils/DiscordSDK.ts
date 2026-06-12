import { DiscordSDK, DiscordSDKMock } from '@discord/embedded-app-sdk';

export const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

const queryParams = new URLSearchParams(window.location.search);
const isEmbedded = queryParams.get('frame_id') != null;

let discordSDK: DiscordSDK | DiscordSDKMock;

if (isEmbedded) {
  // Discord Client ID for the embedded app
  discordSDK = new DiscordSDK(DISCORD_CLIENT_ID);

} else {
  enum SessionStorageQueryParam { user_id = 'user_id', guild_id = 'guild_id', channel_id = 'channel_id', }

  function getOverrideOrRandomSessionValue(queryParam: `${SessionStorageQueryParam}`) {
    const overrideValue = queryParams.get(queryParam);
    if (overrideValue != null) { return overrideValue; }

    const currentStoredValue = sessionStorage.getItem(queryParam);
    if (currentStoredValue != null) { return currentStoredValue; }

    // Discord snowflakes are numeric — use random 18-digit IDs for local testing
    const randomSnowflake = String(Math.floor(1e17 + Math.random() * 9e17));
    sessionStorage.setItem(queryParam, randomSnowflake);

    return randomSnowflake;
  }

  // We're using session storage for "user_id" and "guild_id"
  // This way the user/guild/channel will be maintained until the tab is closed, even if you refresh
  // Session storage will generate new unique mocks for each tab you open
  // Any of these values can be overridden via query parameters
  // i.e. if you set https://my-tunnel-url.com/?user_id=test_user_id
  // this will override this will override the session user_id value
  const mockUserId = getOverrideOrRandomSessionValue('user_id');
  const mockGuildId = getOverrideOrRandomSessionValue('guild_id');
  const mockChannelId = getOverrideOrRandomSessionValue('channel_id');

  discordSDK = new DiscordSDKMock(DISCORD_CLIENT_ID, mockGuildId, mockChannelId, 'en');
  const discriminator = String(mockUserId.charCodeAt(0) % 5);

  discordSDK._updateCommandMocks({
    authenticate: async () => {
      return await {
        access_token: 'mock_token',
        user: { username: mockUserId, discriminator, id: mockUserId, avatar: null, public_flags: 1, },
        scopes: [],
        expires: new Date(2112, 1, 1).toString(),
        application: {
          description: 'mock_app_description',
          icon: 'mock_app_icon',
          id: 'mock_app_id',
          name: 'mock_app_name',
        },
      };
    },
  });
}

export { discordSDK, isEmbedded };