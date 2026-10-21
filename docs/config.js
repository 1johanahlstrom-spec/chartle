// Egenhostad leaderboard. API_BASE är tom eftersom API och webb normalt körs
// på samma adress. Sätt LEADERBOARD_ENABLED till false vid helt statisk drift.
//
// SHARE_URL är adressen som hamnar i delade resultat. Lämna den tom för att
// använda sidans egen adress — sätt den bara om spelet nås på ett annat namn
// än det spelarna ska få. Byter du adress dör alla tidigare delade länkar.
window.CHARTLE_CONFIG = {
  LEADERBOARD_ENABLED: true,
  API_BASE: "",
  SHARE_URL: "",
};
