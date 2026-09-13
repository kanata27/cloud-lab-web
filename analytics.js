(() => {
  "use strict";
  const config = window.KANATA_CONFIG;
  // Keep preview/local visits out of real statistics. This is not an API
  // access control: the ingestion Lambda must validate input independently.
  if (!config?.analyticsOrigins.includes(window.location.origin)) return;
  const analyticsUrl = `${config.apiBase}/events`;
  const source = new URLSearchParams(window.location.search).has("q") ? "qr" : "direct";
  let sessionId;
  function getSessionId() {
    if (sessionId) return sessionId;
    try { sessionId = sessionStorage.getItem("kanata_session_id"); } catch { /* Storage may be blocked. */ }
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      try { sessionStorage.setItem("kanata_session_id", sessionId); } catch { /* Keep an in-memory session. */ }
    }
    return sessionId;
  }
  let pageViewSent = false;
  async function sendEvent(event, extra = {}) {
    if (event === "page_view") {
      if (pageViewSent) return;
      pageViewSent = true;
    }
    try {
      await fetch(analyticsUrl, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: getSessionId(), event, source, ...extra }),
        keepalive: true,
        signal: AbortSignal.timeout?.(8000),
      });
    } catch { /* Never prevent navigation; no retries that could inflate counts. */ }
  }
  function trackVisibleView() {
    if (document.visibilityState === "visible") {
      void sendEvent("page_view");
      document.removeEventListener("visibilitychange", trackVisibleView);
    }
  }
  // Preserve the site's 1.5-second visible-view policy. It is not bot protection.
  setTimeout(() => {
    trackVisibleView();
    if (!pageViewSent) document.addEventListener("visibilitychange", trackVisibleView);
  }, 1500);
  document.querySelectorAll("[data-platform]").forEach(link => {
    link.addEventListener("click", () => {
      if (!["youtube", "instagram"].includes(link.dataset.platform)) return;
      void sendEvent("page_view");
      void sendEvent("social_click", { platform: link.dataset.platform });
    });
  });
})();
