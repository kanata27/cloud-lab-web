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

async function sendAnalyticsEvent(eventName, extraData = {}) {
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

sendAnalyticsEvent("page_view");

document.querySelectorAll("[data-platform]").forEach((link) => {
  link.addEventListener("click", () => {
    sendAnalyticsEvent("social_click", {
      platform: link.dataset.platform
    });
  });
});