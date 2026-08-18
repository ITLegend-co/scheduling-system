(() => {
  const installButton = document.querySelector("#installAppButton");
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMobile = isIOS || /android/i.test(navigator.userAgent);
  let installPrompt = null;

  if (installButton && isMobile && !isStandalone) installButton.hidden = false;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    if (installButton && !isStandalone) installButton.hidden = false;
  });

  installButton?.addEventListener("click", async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === "accepted") installButton.hidden = true;
      installPrompt = null;
      return;
    }

    showInstallGuide(isIOS ? "ios" : "manual");
  });

  window.addEventListener("appinstalled", () => {
    if (installButton) installButton.hidden = true;
    showPwaToast("Smart Schedule was installed successfully.");
  });

  window.addEventListener("offline", () => showPwaToast("You are offline. Showing the last saved schedule."));
  window.addEventListener("online", () => showPwaToast("Back online. Schedule updates are available again."));

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register("./service-worker.js", {
          scope: "./",
          updateViaCache: "none",
        });

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              showPwaToast("Smart Schedule was updated. New pages load automatically.");
            }
          });
        });
      } catch (error) {
        console.error("Unable to register the Smart Schedule service worker.", error);
      }
    });
  }

  function showInstallGuide(platform) {
    let dialog = document.querySelector("#installGuideDialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "installGuideDialog";
      dialog.className = "install-dialog";
      dialog.innerHTML = `
        <article>
          <button class="icon-button install-dialog__close" type="button" aria-label="Close installation instructions">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <span class="install-dialog__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 3v11M7 10l5 5 5-5M7 21h10a2 2 0 0 0 2-2v-2M5 17v2a2 2 0 0 0 2 2" /></svg>
          </span>
          <p class="eyebrow">INSTALL SMART SCHEDULE</p>
          <h2></h2>
          <ol></ol>
          <button class="button button--primary install-dialog__done" type="button">Got it</button>
        </article>`;
      document.body.append(dialog);
      dialog.querySelectorAll(".install-dialog__close, .install-dialog__done").forEach((button) => {
        button.addEventListener("click", () => dialog.close());
      });
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    }

    const title = dialog.querySelector("h2");
    const steps = dialog.querySelector("ol");
    if (platform === "ios") {
      title.textContent = "Add it from Safari";
      steps.replaceChildren(
        instruction("Tap the Share button in Safari."),
        instruction("Scroll down and choose “Add to Home Screen”."),
        instruction("Tap “Add” to install the app icon."),
      );
    } else {
      title.textContent = "Install from your browser";
      steps.replaceChildren(
        instruction("Open your browser menu."),
        instruction("Choose “Install app” or “Add to Home screen”."),
        instruction("Confirm the installation."),
      );
    }
    dialog.showModal();
  }

  function instruction(text) {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }

  function showPwaToast(message) {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.style.background = "var(--mint)";
    toast.classList.add("toast--visible");
    window.setTimeout(() => toast.classList.remove("toast--visible"), 3200);
  }
})();
