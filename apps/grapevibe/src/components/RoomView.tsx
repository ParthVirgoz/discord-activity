"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { VideoPicker } from "@/components/VideoPicker";
import { QueueList } from "@/components/QueueList";
import { PlaylistHeader } from "@/components/PlaylistHeader";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { MiniPlayerBar } from "@/components/room/MiniPlayerBar";
import { PlaybackControls, PlayerSurface } from "@/components/room/PlayerSection";
import { RoomHeader } from "@/components/room/RoomHeader";
import {
  RoomTabBar,
  normalizeTabForMode,
  type RoomTab,
} from "@/components/room/RoomTabBar";
import {
  MovieSidePanelTabs,
  type MovieSideTab,
} from "@/components/room/MovieSidePanelTabs";
import { useRoomConnection } from "@/hooks/useRoomConnection";
import { useDiscordRoomLifecycle } from "@/hooks/useDiscordRoomLifecycle";
import { useRoomLayoutMode } from "@/hooks/useRoomLayoutMode";
import { usePlaybackKeyboard } from "@/hooks/usePlaybackKeyboard";
import { useVideoPlayer } from "@/hooks/useVideoPlayer";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { useRoomStore } from "@/stores/roomStore";
import { useUserStore } from "@/stores/userStore";
import { cn } from "@/lib/utils";

interface RoomViewProps {
  roomId: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  authToken: string;
}

export function RoomView({ roomId, userId, username, authToken }: RoomViewProps) {
  const layoutMode = useRoomLayoutMode();
  const { emit, reconnect, disconnectFromRoom } = useRoomConnection(roomId, userId, authToken);
  useDiscordRoomLifecycle(roomId, userId, disconnectFromRoom);
  const room = useRoomStore((s) => s.room);
  const joined = useRoomStore((s) => s.joined);
  const isHost = useRoomStore((s) => s.isHost);
  const canAddToPlaylist = useRoomStore((s) => s.canAddToPlaylist);
  const canReorderPlaylist = useRoomStore((s) => s.canReorderPlaylist);
  const canPlayFromQueue = useRoomStore((s) => s.canPlayFromQueue);
  const canControlPlayback = useRoomStore((s) => s.canControlPlayback);
  const members = useRoomStore((s) => s.members);
  const queue = useRoomStore((s) => s.queue);
  const playback = useRoomStore((s) => s.playback);
  const connectionStatus = useRoomStore((s) => s.connectionStatus);
  const toast = useRoomStore((s) => s.toast);
  const syncing = useRoomStore((s) => s.syncing);
  const settings = useRoomStore((s) => s.settings);
  const setToast = useRoomStore((s) => s.setToast);
  const volume = useUserStore((s) => s.volume);
  const muted = useUserStore((s) => s.muted);
  const setVolume = useUserStore((s) => s.setVolume);
  const setMuted = useUserStore((s) => s.setMuted);

  const [tab, setTab] = useState<RoomTab>("watch");
  const [movieSideTab, setMovieSideTab] = useState<MovieSideTab>("discover");

  const isMusicWatch = settings.watchMode === "music";
  const isMovieDesktop = layoutMode === "desktop" && !isMusicWatch;

  useEffect(() => {
    setTab((current) => {
      if (layoutMode === "desktop") return current;
      const mode = layoutMode === "phone" ? "phone" : "tablet";
      return normalizeTabForMode(current, mode);
    });
  }, [layoutMode]);

  const isYouTube = playback?.currentVideo?.source === "youtube";
  const isDirect = playback?.currentVideo?.source === "direct";
  const displaySpeed = playback?.speed ?? 1;

  const showPlayerFull =
    layoutMode === "desktop" ||
    (layoutMode === "phone" && tab === "watch") ||
    (layoutMode === "tablet" && isMusicWatch && tab === "room") ||
    (layoutMode === "tablet" && !isMusicWatch && tab === "watch");

  const showControls = showPlayerFull;
  const showPlaylist =
    (layoutMode === "desktop" && isMusicWatch) ||
    (layoutMode === "phone" && tab === "playlist") ||
    (layoutMode === "tablet" && !isMusicWatch && tab === "playlist");
  const showDiscover =
    (layoutMode === "desktop" && isMusicWatch) ||
    (layoutMode !== "desktop" && tab === "discover");

  const showMiniPlayer =
    Boolean(playback?.currentVideo) &&
    layoutMode !== "desktop" &&
    !showPlayerFull;

  const playerMode = showPlayerFull ? "full" : "hidden";

  const onEnded = () => {
    if (canControlPlayback) emit("video_ended");
  };

  const ytPlayer = useYouTubePlayer({
    enabled: isYouTube,
    canControlPlayback,
    emit,
    onEnded,
  });
  const htmlPlayer = useVideoPlayer({
    enabled: isDirect,
    canControlPlayback,
    emit,
    onEnded,
  });
  const player = isYouTube ? ytPlayer : htmlPlayer;

  usePlaybackKeyboard({
    enabled: joined && Boolean(playback?.currentVideo),
    canControlPlayback,
    hasVideo: Boolean(playback?.currentVideo),
    currentTime: player.currentTime,
    duration: player.duration,
    togglePlay: player.togglePlay,
    seek: player.seek,
    volume,
    muted,
    setVolume,
    setMuted,
  });

  const goToPlayer = () => {
    setTab(layoutMode === "tablet" && isMusicWatch ? "room" : "watch");
  };

  const playlistPanel = (
    <div className="min-w-0">
      <PlaylistHeader
        settings={settings}
        count={queue.length}
        compact={isMusicWatch && layoutMode === "desktop"}
      />
      <QueueList
        items={queue}
        nowPlayingId={playback?.currentVideo?.id}
        compact={isMusicWatch && layoutMode === "desktop"}
        canReorder={canReorderPlaylist}
        canPlay={canPlayFromQueue}
        onPlay={(id) => emit("video_changed", { itemId: id })}
        onPlayNext={(id) => emit("queue_play_next", { itemId: id })}
        onRemove={(id) => emit("video_removed", { itemId: id })}
        onMoveUp={(id) => emit("queue_reorder", { itemId: id, direction: "up" })}
        onMoveDown={(id) => emit("queue_reorder", { itemId: id, direction: "down" })}
        onClear={() => emit("queue_clear")}
      />
    </div>
  );

  const discoverPanel = (
    <VideoPicker
      embedded={isMovieDesktop}
      canAdd={canAddToPlaylist}
      canPlayNow={canControlPlayback}
      playingVideoId={
        playback?.currentVideo?.source === "youtube" ? playback.currentVideo.videoId : null
      }
      playingVideoTitle={playback?.currentVideo?.title ?? null}
      playingVideoChannel={playback?.currentVideo?.channel ?? null}
      onQueue={(p) => emit("video_added", p)}
      onPlayNow={(p) => emit("video_load", p)}
    />
  );

  const playerFill = showPlayerFull && !(isMusicWatch && layoutMode === "desktop");
  const playerSize = layoutMode === "phone" ? "default" : isMusicWatch ? "compact" : "large";
  const controlsDense = layoutMode !== "phone" && isMusicWatch;

  return (
    <div className="app-bg flex h-dvh flex-col overflow-hidden text-foreground">
      {toast && (
        <div
          className={cn(
            "glass-strong fixed z-50 flex items-center gap-2.5 rounded-xl border border-[var(--border)] px-4 py-3 text-sm shadow-2xl",
            layoutMode === "desktop"
              ? "bottom-4 right-4 max-w-sm"
              : cn(
                  "left-3 right-3",
                  showMiniPlayer
                    ? "bottom-[calc(8.5rem+env(safe-area-inset-bottom))]"
                    : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]"
                )
          )}
        >
          <Icon icon="mdi:information" className="text-primary" />
          <span className="min-w-0 flex-1">{toast}</span>
          <button type="button" onClick={() => setToast(null)}>
            <Icon icon="mdi:close" />
          </button>
        </div>
      )}

      <RoomHeader
        userId={userId}
        isHost={isHost}
        joined={joined}
        members={members}
        hostId={room?.hostId}
        settings={settings}
        connectionStatus={connectionStatus}
        emit={emit}
      />

      <ConnectionBanner status={connectionStatus} roomId={roomId} onReconnect={reconnect} />

      <div
        className={cn(
          "relative z-0 flex min-h-0 flex-1 flex-col lg:flex-row",
          layoutMode === "tablet" && tab === "room" && isMusicWatch && "md:flex-row"
        )}
      >
        {/* Player mount — always in DOM; collapsed when off-screen */}
        <section
          className={cn(
            "flex min-h-0 min-w-0 flex-col overflow-y-hidden",
            layoutMode === "desktop" &&
              cn(
                "lg:relative lg:z-10 lg:min-h-0 lg:shrink-0 lg:border-r lg:border-[var(--border)]",
                isMusicWatch
                  ? "lg:grid lg:w-[min(520px,44vw)] lg:grid-rows-[auto_auto_1fr]"
                  : "lg:grid lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)_auto]"
              ),
            layoutMode === "tablet" &&
              isMusicWatch &&
              tab === "room" &&
              "hidden md:flex md:min-h-0 md:w-1/2 md:flex-col md:overflow-hidden md:border-r md:border-[var(--border)]",
            layoutMode === "tablet" &&
              !isMusicWatch &&
              tab === "watch" &&
              "hidden md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-hidden",
            layoutMode === "phone" &&
              tab === "watch" &&
              "flex min-h-0 flex-1 flex-col overflow-hidden md:hidden",
            !showPlayerFull && "h-0 min-h-0 overflow-hidden"
          )}
        >
          <div
            className={cn(
              isMusicWatch && layoutMode === "desktop"
                ? "shrink-0 px-2.5 pt-2.5"
                : cn(
                    "relative min-h-0",
                    playerFill ? "flex-1 overflow-hidden bg-black" : "shrink-0 py-3",
                    !isMusicWatch && layoutMode === "desktop" && "min-h-0"
                  )
            )}
          >
            <PlayerSurface
              mode={playerMode}
              size={playerSize}
              fill={playerFill}
              fixedHeight={isMusicWatch && layoutMode === "desktop"}
              isYouTube={isYouTube}
              isDirect={isDirect}
              ytContainerRef={ytPlayer.containerRef}
              htmlVideoRef={htmlPlayer.videoRef}
              playback={playback}
              syncing={syncing}
              canAddToPlaylist={canAddToPlaylist}
            />
          </div>
          {showControls && (
            <PlaybackControls
              playback={playback}
              canControlPlayback={canControlPlayback}
              player={player}
              displaySpeed={displaySpeed}
              volume={volume}
              muted={muted}
              setVolume={setVolume}
              setMuted={setMuted}
              onSkip={() => emit("skip")}
              compact={controlsDense}
              dense={controlsDense}
            />
          )}
          {layoutMode === "desktop" && isMusicWatch && (
            <div className="hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex">
              <div className="mx-2.5 mb-2.5 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-white/[0.02]">
                <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-2.5">{playlistPanel}</div>
              </div>
            </div>
          )}
        </section>

        {/* Tablet: playlist right column (music mode only) */}
        {layoutMode === "tablet" && tab === "room" && isMusicWatch && (
          <div className="hidden min-h-0 flex-1 flex-col overflow-hidden md:flex md:w-1/2">
            <div className="mx-4 my-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-white/[0.02]">
              <div className="flex-1 overflow-y-auto p-4">{playlistPanel}</div>
            </div>
          </div>
        )}

        {/* Phone + tablet movie: playlist tab */}
        {((layoutMode === "phone" && tab === "playlist") ||
          (layoutMode === "tablet" && !isMusicWatch && tab === "playlist")) && (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:flex lg:hidden">
            {playlistPanel}
          </div>
        )}

        {/* Discover (music desktop + mobile/tablet discover tab) */}
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            showDiscover ? "flex" : "hidden"
          )}
        >
          {discoverPanel}
        </div>

        {/* Movie desktop: tabbed search + playlist on the right */}
        {isMovieDesktop && (
          <aside className="hidden min-h-0 w-[min(420px,34vw)] shrink-0 flex-col border-l border-[var(--border)] bg-surface lg:flex">
            <MovieSidePanelTabs
              active={movieSideTab}
              onChange={setMovieSideTab}
              queueCount={queue.length}
            />
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <div className={cn("absolute inset-0", movieSideTab !== "discover" && "hidden")}>
                {discoverPanel}
              </div>
              <div
                className={cn(
                  "absolute inset-0 overflow-y-auto p-4",
                  movieSideTab !== "playlist" && "hidden"
                )}
              >
                {playlistPanel}
              </div>
            </div>
          </aside>
        )}
      </div>

      {showMiniPlayer && playback?.currentVideo && (
        <MiniPlayerBar
          video={playback.currentVideo}
          title={playback.currentVideo.title}
          currentTime={player.currentTime}
          duration={player.duration}
          playing={player.playing}
          canControlPlayback={canControlPlayback}
          onExpand={goToPlayer}
          onTogglePlay={player.togglePlay}
        />
      )}

      {layoutMode === "phone" && (
        <RoomTabBar mode="phone" active={tab} onChange={setTab} queueCount={queue.length} />
      )}
      {layoutMode === "tablet" && isMusicWatch && (
        <RoomTabBar mode="tablet" active={tab} onChange={setTab} queueCount={queue.length} />
      )}
      {layoutMode === "tablet" && !isMusicWatch && (
        <RoomTabBar mode="mobile" active={tab} onChange={setTab} queueCount={queue.length} />
      )}
    </div>
  );
}
