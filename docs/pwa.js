// Service workern ger den installerade appen ett fungerande skal även när
// nätet tillfälligt saknas. Fel här får aldrig hindra själva spelet.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js")
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        if (!window.ChartleGame) return;
        const day = ChartleGame.stockholmDayIndex();
        const urls = Array.from({ length: ChartleGame.ROUNDS }, (_, round) =>
          // Samma URL-byggare som app.js — annars kunde förhämtningen och
          // själva laddningen peka på olika pusselsetversioner.
          ChartleGame.puzzleUrl(day * ChartleGame.ROUNDS + round));
        registration.active?.postMessage({ type: "CACHE_PUZZLES", urls });
      })
      .catch((error) => console.warn("Kunde inte aktivera offline-stöd:", error));
  });
}
