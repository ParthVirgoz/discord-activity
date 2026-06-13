import { isValidVideoId } from "../utils/validation";

export function buildYouTubePlayerPage(
  videoId: string,
  options: { startSec: number; autoplay: boolean; origin: string }
): string {
  const params = new URLSearchParams({
    start: String(Math.max(0, Math.floor(options.startSec))),
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    enablejsapi: "1",
    origin: options.origin,
  });
  if (options.autoplay) params.set("autoplay", "1");

  const innerSrc = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`;
  const iframeId = `yt-embed-${videoId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#yt{width:100%;height:100%;border:0}</style>
</head>
<body>
<iframe id="yt" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
<script>
(function(){
  var yt=document.getElementById("yt");
  var id=${JSON.stringify(iframeId)};
  yt.src=${JSON.stringify(innerSrc)};
  yt.addEventListener("load",function(){
    parent.postMessage(JSON.stringify({event:"listening",id:id,channel:"widget"}),"*");
  });
  window.addEventListener("message",function(e){
    if(e.source===parent&&yt.contentWindow){
      yt.contentWindow.postMessage(e.data,"*");
    }else if(e.source===yt.contentWindow){
      parent.postMessage(e.data,"*");
    }
  });
})();
</script>
</body>
</html>`;
}

export function parsePlayerQuery(query: Record<string, unknown>): {
  startSec: number;
  autoplay: boolean;
  origin: string;
} {
  const startRaw = typeof query.start === "string" ? Number(query.start) : 0;
  const startSec = Number.isFinite(startRaw) ? Math.max(0, Math.min(startRaw, 86400)) : 0;
  const autoplay = query.autoplay === "1" || query.autoplay === "true";
  const origin =
    typeof query.origin === "string" && query.origin.length > 0 && query.origin.length <= 256
      ? query.origin
      : "https://discord.com";
  return { startSec, autoplay, origin };
}
