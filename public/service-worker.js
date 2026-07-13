// Echo background service worker (Manifest V3).
//
// A service worker is event-driven and short-lived: Chrome spins it up to
// handle an event, then may kill it to save memory. So we don't keep state
// here — we just register behavior.
//
// The one job for now: make clicking the toolbar icon open the side panel.
// `setPanelBehavior` is a persistent setting, so registering it once on
// install is enough; Chrome remembers it across restarts.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set panel behavior:', error));
});
