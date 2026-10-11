// Screenshot galleries: click a shot to open it full size in a native <dialog>.
(function () {
  var shots = document.querySelectorAll("a.shot");
  if (!shots.length) return;
  var dlg = document.createElement("dialog");
  dlg.className = "lightbox";
  dlg.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close">&times;</button><img alt=""><p class="lightbox-cap"></p>';
  document.body.appendChild(dlg);
  var img = dlg.querySelector("img"), cap = dlg.querySelector(".lightbox-cap");
  shots.forEach(function (a) {
    a.addEventListener("click", function (e) {
      if (!dlg.showModal) return;
      e.preventDefault();
      img.src = a.getAttribute("href");
      img.alt = a.querySelector("img") ? a.querySelector("img").alt : "";
      cap.textContent = a.getAttribute("data-caption") || (a.querySelector("figcaption") ? a.querySelector("figcaption").textContent : "");
      dlg.showModal();
    });
  });
  dlg.querySelector(".lightbox-close").addEventListener("click", function () { dlg.close(); });
  dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
})();
