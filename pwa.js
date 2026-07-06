const isStandaloneApp = window.matchMedia("(display-mode: standalone)").matches
  || window.navigator.standalone === true;

if (isStandaloneApp) {
  document.title = "情報宣伝部 部員認証・管理システム";
}

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
