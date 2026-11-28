// Darstellung vor dem ersten Bild setzen (kein Aufblitzen); Werte wie in app.js darstellungSetzen. Eigene Datei wegen der CSP.
(() => {
  let d = "auto";
  try { d = JSON.parse(localStorage.getItem("herbert-ansicht"))?.darstellung || "auto"; } catch (e) { /* Vorgabe */ }
  document.documentElement.dataset.thema = d === "dunkel" || (d === "auto" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dunkel" : "hell";
})();
