// sidepanel.ts
const out = document.getElementById("out")!;

async function pollOnce() {
  try {
    const reply = await chrome.runtime.sendMessage({ type: "GET_WS_STATE" });
    out.textContent = reply?.state ?? "unknown";
  } catch (e) {
    // No receiving end = SW mid-restart; the message itself wakes it.
    // Treat as transient, let the next tick resolve it.
    out.textContent = "connecting";
  }
}

pollOnce();
const timer = setInterval(pollOnce, 2000);

// Stop polling when the panel is closed/hidden so we don't keep
// waking the SW for a panel nobody's looking at.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearInterval(timer);
});
