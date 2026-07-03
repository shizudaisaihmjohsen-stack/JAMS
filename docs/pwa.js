if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", {
      scope: "./",
      updateViaCache: "none",
    }).then((registration) => registration.update()).catch((error) => {
      console.warn("JAMS service worker registration failed", error);
    });
  });
}
