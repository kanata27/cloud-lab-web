-- Existing earnings tables and rows are preserved.
-- Legacy counters and new counters are separate: repeated imports cannot
-- double-count old history or overwrite visits received after cutover.
CREATE TABLE IF NOT EXISTS analytics_sessions (
 session_id TEXT PRIMARY KEY,
 started_at TEXT, last_seen TEXT, source TEXT CHECK(source IN ('qr','direct')),
 page_views INTEGER NOT NULL DEFAULT 0 CHECK(page_views >= 0),
 youtube_clicks INTEGER NOT NULL DEFAULT 0 CHECK(youtube_clicks >= 0),
 instagram_clicks INTEGER NOT NULL DEFAULT 0 CHECK(instagram_clicks >= 0),
 social_clicked INTEGER NOT NULL DEFAULT 0 CHECK(social_clicked IN (0,1)),
 base_page_views INTEGER NOT NULL DEFAULT 0 CHECK(base_page_views >= 0),
 base_youtube_clicks INTEGER NOT NULL DEFAULT 0 CHECK(base_youtube_clicks >= 0),
 base_instagram_clicks INTEGER NOT NULL DEFAULT 0 CHECK(base_instagram_clicks >= 0),
 base_social_clicked INTEGER NOT NULL DEFAULT 0 CHECK(base_social_clicked IN (0,1))
);
CREATE INDEX IF NOT EXISTS analytics_started_source ON analytics_sessions(started_at,source);
CREATE TABLE IF NOT EXISTS analytics_events (
 event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
 event TEXT NOT NULL CHECK(event IN ('page_view','social_click')),
 source TEXT NOT NULL CHECK(source IN ('qr','direct')),
 platform TEXT CHECK(platform IN ('youtube','instagram')),
 received_at TEXT NOT NULL,
 CHECK((event='page_view' AND platform IS NULL) OR (event='social_click' AND platform IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS analytics_event_received ON analytics_events(received_at);
CREATE TRIGGER IF NOT EXISTS analytics_accept_event AFTER INSERT ON analytics_events
BEGIN
 INSERT INTO analytics_sessions(session_id,started_at,last_seen,source,page_views,youtube_clicks,instagram_clicks,social_clicked)
 VALUES(NEW.session_id,CASE WHEN NEW.event='page_view' THEN NEW.received_at END,NEW.received_at,
 CASE WHEN NEW.event='page_view' THEN NEW.source END,
 NEW.event='page_view',COALESCE(NEW.platform='youtube',0),COALESCE(NEW.platform='instagram',0),NEW.event='social_click')
 ON CONFLICT(session_id) DO UPDATE SET
 started_at=COALESCE(analytics_sessions.started_at,excluded.started_at),
 last_seen=MAX(COALESCE(analytics_sessions.last_seen,''),excluded.last_seen),
 source=COALESCE(analytics_sessions.source,excluded.source),
 page_views=analytics_sessions.page_views+excluded.page_views,
 youtube_clicks=analytics_sessions.youtube_clicks+COALESCE(excluded.youtube_clicks,0),
 instagram_clicks=analytics_sessions.instagram_clicks+COALESCE(excluded.instagram_clicks,0),
 social_clicked=MAX(analytics_sessions.social_clicked,excluded.social_clicked);
END;
CREATE TABLE IF NOT EXISTS analytics_imports (
 digest TEXT PRIMARY KEY, session_count INTEGER NOT NULL, imported_at TEXT NOT NULL
);
