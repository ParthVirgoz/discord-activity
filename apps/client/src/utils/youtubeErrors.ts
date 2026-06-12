const YOUTUBE_ERROR_MESSAGES: Record<number, string> = {
  2: "Invalid video request. Try a different URL.",
  5: "Playback failed in the HTML5 player. Try again or pick another video.",
  100: "Video not found or is private.",
  101: "The video owner does not allow embedding on external sites.",
  150: "This video cannot be played here due to copyright or embedding restrictions.",
};

export function getYouTubeErrorMessage(code: number): string {
  return (
    YOUTUBE_ERROR_MESSAGES[code] ??
    `This video cannot be played (error ${code}). Try another link.`
  );
}
