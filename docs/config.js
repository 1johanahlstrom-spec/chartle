// Leaderboard-konfiguration (Supabase). Tomma värden = leaderboarden är avstängd.
// Fyll i från Supabase-projektet: Settings → API. Anon-nyckeln är publik per design —
// säkerheten ligger i Row Level Security-policyerna (se leaderboard.sql).
window.CHARTLE_CONFIG = {
  SUPABASE_URL: "https://alovomuwkckgagyfbsxp.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable__05oC5qWO-uU-umOCKHL8g_deLlRrOR",
};
