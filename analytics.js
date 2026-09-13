const ANALYTICS_URL =
  "https://dupt8l46y1.execute-api.eu-north-1.amazonaws.com/events";

function getSessionId() {
  let sessionId = sessionStorage.getItem("kanata_session_id");

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem("kanata_session_id", sessionId);
  }

  return sessionId;
}

function getSource() {
  const params = new URLSearchParams(window.location.search);

  if (params.has("q")) {
    return "qr";
  }

  return "direct";
}

let pageViewSent = false;

async function sendAnalyticsEvent(eventName, extraData = {}) {
  // Защита от двойной отправки page_view
  if (eventName === "page_view") {
    if (pageViewSent) return;
    pageViewSent = true;
  }

  const payload = {
    session_id: getSessionId(),
    event: eventName,
    source: getSource(),
    ...extraData
  };

  try {
    const response = await fetch(ANALYTICS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      keepalive: true
    });

    if (!response.ok) {
      console.error("Analytics request failed:", response.status);
    }
  } catch (error) {
    console.error("Analytics error:", error);
  }
}

function trackPageView() {
  // Отправляем просмотр, только если вкладка реально видна пользователю
  if (document.visibilityState === "visible") {
    sendAnalyticsEvent("page_view");
  }
}

// 1. Ждем 1.5 секунды, чтобы отсеять глупых ботов-парсеров
setTimeout(() => {
  trackPageView();
  
  // 2. Если через 1.5 секунды вкладка была скрыта (например, открыта в фоне),
  // ждем, когда пользователь реально на нее переключится.
  if (!pageViewSent) {
    document.addEventListener("visibilitychange", trackPageView);
  }
}, 1500);

document.querySelectorAll("[data-platform]").forEach((link) => {
  link.addEventListener("click", () => {
    // 3. Если человек кликнул быстрее, чем прошли 1.5 секунды,
    // принудительно отправляем page_view перед отправкой клика.
    if (!pageViewSent) {
      sendAnalyticsEvent("page_view");
    }

    sendAnalyticsEvent("social_click", {
      platform: link.dataset.platform
    });
  });
});