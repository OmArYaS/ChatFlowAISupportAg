/**
 * ChatFlow widget loader.
 *
 * Usage (pasted by the site owner before </body>):
 * <script>
 *   (function(){var d=document,s=d.createElement('script');
 *   s.src='https://<host>/widget-loader.js';
 *   s.async;s.dataset.site='<site_key>';
 *   (d.body||d.head).appendChild(s)})();
 * </script>
 *
 * The widget is served from an iframe so customer CSS can never break it
 * (and vice versa). Chat messages post to the parent ChatFlow origin,
 * so customer sites get the widget with a single script tag, no install.
 */
(function () {
  "use strict";

  var me = document.currentScript;
  if (!me || me.dataset.initialized) return;
  me.dataset.initialized = "1";

  var HOST = new URL(me.src).origin;
  var SITE_KEY = me.dataset.site;
  if (!SITE_KEY) {
    console.error("[ChatFlow] missing data-site attribute");
    return;
  }

  var COLORS = {
    accent: me.dataset.accent || "#00c692",
    position: me.dataset.position === "left" ? "left" : "right",
  };

  var button = document.createElement("button");
  button.setAttribute("aria-label", "Open support chat");
  button.style.cssText =
    "position:fixed;bottom:24px;" + COLORS.position + ":24px;width:56px;height:56px;" +
    "border-radius:50%;border:none;background:" + COLORS.accent + ";color:#04231a;" +
    "font-size:24px;box-shadow:0 6px 20px rgba(0,0,0,.28);cursor:pointer;z-index:2147483000;";
  button.textContent = "\uD83D\uDCAC";

  var frame = document.createElement("iframe");
  frame.src = HOST + "/widget?k=" + encodeURIComponent(SITE_KEY);
  frame.title = "Support chat";
  frame.style.cssText =
    "position:fixed;bottom:92px;" + COLORS.position + ":24px;width:360px;height:520px;" +
    "max-height:calc(100vh - 110px);border:1px solid rgba(0,0,0,.12);border-radius:16px;" +
    "box-shadow:0 16px 48px rgba(0,0,0,.30);display:none;background:#fff;z-index:2147483000;";
  frame.allow = "microphone *; clipboard-write";

  function toggle() {
    var open = frame.style.display === "none";
    frame.style.display = open ? "block" : "none";
    button.textContent = open ? "\u2715" : "\uD83D\uDCAC";
    if (open) frame.focus();
  }

  button.addEventListener("click", toggle);

  document.body.appendChild(frame);
  document.body.appendChild(button);
})();
