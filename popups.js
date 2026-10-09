// Inline terms that open a short explainer. Native <dialog> handles focus and Escape.
(function () {
  document.querySelectorAll("[data-dialog]").forEach(function (btn) {
    var dlg = document.getElementById(btn.getAttribute("data-dialog"));
    if (!dlg || !dlg.showModal) return;
    btn.addEventListener("click", function () { dlg.showModal(); });
  });
  document.querySelectorAll("dialog.popup").forEach(function (dlg) {
    dlg.querySelector(".popup-close").addEventListener("click", function () { dlg.close(); });
    // Clicking the backdrop (outside the panel) closes it
    dlg.addEventListener("click", function (e) {
      var r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    });
  });
})();
