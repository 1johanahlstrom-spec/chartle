// Service workern ger den installerade appen ett fungerande skal även när
// nätet tillfälligt saknas. Fel här får aldrig hindra själva spelet.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((error) => {
      console.warn("Kunde inte aktivera offline-stöd:", error);
    });
  });
}
