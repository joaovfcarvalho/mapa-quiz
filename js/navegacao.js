"use strict";
document.querySelectorAll('.outros-modos').forEach(function (menu) {
  menu.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { menu.open = false; menu.querySelector('summary').focus(); }
  });
  document.addEventListener('click', function (e) { if (!menu.contains(e.target)) menu.open = false; });
  menu.addEventListener('focusout', function (e) { if (!menu.contains(e.relatedTarget)) menu.open = false; });
  menu.querySelectorAll('a').forEach(function (a) {
    if (a.pathname === location.pathname) a.setAttribute('aria-current', 'page');
  });
});
