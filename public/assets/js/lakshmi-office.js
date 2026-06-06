(function () {
  const revealElements = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14 });

    revealElements.forEach((el) => observer.observe(el));
  } else {
    revealElements.forEach((el) => el.classList.add('in-view'));
  }
})();

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
    if (document.body.classList.contains('menu-open')) closeMenu();
    else openMenu();
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

(function () {
  const viewer = document.getElementById('officeViewer');
  const zoneTitle = document.getElementById('zoneTitle');
  const zoneText = document.getElementById('zoneText');
  const zonePrimary = document.getElementById('zonePrimary');
  const zoneSecondary = document.getElementById('zoneSecondary');
  const zoneControls = Array.from(document.querySelectorAll('[data-zone]'));
  const hotspots = Array.from(document.querySelectorAll('.office-hotspot'));

  const zones = {
    overview: {
      title: 'Общий вид',
      text: 'Осмотрите офис, приблизьте модель и выберите интересующую точку. Этот раздел помогает быстро понять, куда перейти дальше.',
      orbit: '15deg 72deg 12m',
      target: '0.1m 1.2m -0.7m',
      primary: { text: 'Осмотреть модель', href: '#officeViewerBlock' },
      secondary: { text: 'Открыть заявку', href: 'lakshmi_gamified_application_restyled.html' }
    },
    entrance: {
      title: 'Входная зона',
      text: 'Входная зона помогает сориентироваться в пространстве офиса и выбрать нужный раздел: заявку, этапы работы или документы.',
      orbit: '118deg 74deg 8.2m',
      target: '2.0m 1.2m -3.5m',
      primary: { text: 'К заявке', href: 'lakshmi_gamified_application_restyled.html' },
      secondary: { text: 'Этапы работы', href: 'lakshmi_landing_restyled.html#process' }
    },
    clientArea: {
      title: 'Приём клиентов',
      text: 'Зона ожидания и первичной консультации: здесь можно спокойно обсудить задачу, цель оценки и дальнейшие шаги.',
      orbit: '-50deg 73deg 8m',
      target: '-2.5m 1.2m -1.9m',
      primary: { text: 'Оставить заявку', href: 'lakshmi_landing_restyled.html#contacts' },
      secondary: { text: 'Контакты', href: 'lakshmi_landing_restyled.html#contacts' }
    },
    appraiser: {
      title: 'Кабинет оценщика',
      text: 'Зона показывает, что происходит после обращения: специалист изучает объект, документы, цель оценки и исходные данные.',
      orbit: '55deg 74deg 7.4m',
      target: '2.2m 1.1m -0.2m',
      primary: { text: 'Этапы работы', href: 'lakshmi_landing_restyled.html#process' },
      secondary: { text: 'Услуги', href: 'lakshmi_landing_restyled.html#services' }
    },
    archive: {
      title: 'Архив',
      text: 'Зона документов и материалов: здесь показано, какие сведения, фотографии и файлы могут понадобиться для подготовки отчёта.',
      orbit: '8deg 74deg 7.8m',
      target: '-0.6m 1.15m 2.25m',
      primary: { text: 'Собрать документы', href: 'lakshmi_gamified_application_restyled.html#progress' },
      secondary: { text: 'FAQ', href: 'lakshmi_landing_restyled.html#faq' }
    },
  };

  function applyZone(zoneKey) {
    const zone = zones[zoneKey] || zones.overview;

    zoneTitle.textContent = zone.title;
    zoneText.textContent = zone.text;
    zonePrimary.textContent = zone.primary.text;
    zonePrimary.setAttribute('href', zone.primary.href);
    zoneSecondary.textContent = zone.secondary.text;
    zoneSecondary.setAttribute('href', zone.secondary.href);

    if (viewer) {
      viewer.cameraTarget = zone.target;
      viewer.cameraOrbit = zone.orbit;
      viewer.fieldOfView = '34deg';
    }

    zoneControls.forEach((control) => {
      control.classList.toggle('is-active', control.dataset.zone === zoneKey);
    });
    hotspots.forEach((hotspot) => {
      hotspot.classList.toggle('is-active', hotspot.dataset.zone === zoneKey);
    });
  }

  zoneControls.forEach((control) => {
    control.addEventListener('click', (event) => {
      if (!control.dataset.zone) return;
      event.preventDefault();
      applyZone(control.dataset.zone);
    });
  });

  applyZone('overview');
})();
