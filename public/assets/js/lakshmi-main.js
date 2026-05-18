const revealElements = document.querySelectorAll('.reveal');

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.16 });

      revealElements.forEach(el => observer.observe(el));
    } else {
      revealElements.forEach(el => el.classList.add('in-view'));
    }

    const form = document.getElementById('leadForm');
    const formStatus = document.getElementById('formStatus');
    const submitButton = document.getElementById('leadSubmit');

    const setStatus = (message, state = '') => {
      formStatus.textContent = message;
      formStatus.classList.remove('is-loading', 'is-success', 'is-error');
      if (state) formStatus.classList.add(state);
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());

      submitButton.disabled = true;
      setStatus('Отправляем заявку…', 'is-loading');

      try {
        const response = await fetch('/api/leads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.ok) {
          throw new Error(result.message || 'Не удалось отправить заявку. Проверьте настройки сервера и попробуйте снова.');
        }

        form.reset();
        setStatus(result.message || 'Заявка отправлена. Компания получила уведомление.', 'is-success');
      } catch (error) {
        setStatus(error.message || 'Ошибка отправки. Попробуйте позже.', 'is-error');
      } finally {
        submitButton.disabled = false;
      }
    });
  


(function () {
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.querySelector('.mobile-menu');
  if (!toggle || !menu) return;

  const links = menu.querySelectorAll('a');
  const closeMenu = () => {
    document.body.classList.remove('menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-hidden', 'true');
  };
  const openMenu = () => {
    document.body.classList.add('menu-open');
    toggle.setAttribute('aria-expanded', 'true');
    menu.setAttribute('aria-hidden', 'false');
  };

  closeMenu();

  toggle.addEventListener('click', function () {
    if (document.body.classList.contains('menu-open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  links.forEach((link) => link.addEventListener('click', closeMenu));

  document.addEventListener('click', function (event) {
    if (!document.body.classList.contains('menu-open')) return;
    if (menu.contains(event.target) || toggle.contains(event.target)) return;
    closeMenu();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeMenu();
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 900) closeMenu();
  });
})();