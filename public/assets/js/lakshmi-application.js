
    const form = document.getElementById('gamifiedLeadForm');
    const docsCountText = document.getElementById('docsCountText');
    const docsBar = document.getElementById('docsBar');
    const docsPercent = document.getElementById('docsPercent');
    const heroPercent = document.getElementById('heroPercent');
    const heroBar = document.getElementById('heroBar');
    const heroMeta = document.getElementById('heroMeta');
    const heroTopCount = document.getElementById('heroTopCount');
    const achievementText = document.getElementById('achievementText');
    const objectScore = document.getElementById('objectScore');
    const objectTitle = document.getElementById('objectTitle');
    const houseFill = document.getElementById('houseFill');
    const rewards = Array.from(document.querySelectorAll('.reward'));
    const statusChip = document.getElementById('field-status');
    const submitButton = document.getElementById('gamifiedSubmit');
    const formStatus = document.getElementById('gamifiedFormStatus');

    const fieldMap = {
      rightDocs: ['field-address', 'cell-address'],
      params: ['field-params', 'cell-params'],
      photos: ['field-photos', 'cell-photos'],
      purpose: ['field-purpose', 'cell-purpose'],
      contacts: ['field-contacts']
    };

    const fileInputs = {
      rightDocs: document.getElementById('rightDocsInput'),
      techDocs: document.getElementById('techDocsInput'),
      photos: document.getElementById('photosInput'),
      additionalFiles: document.getElementById('additionalFilesInput')
    };

    const summaries = {
      rightDocs: document.getElementById('rightDocsSummary'),
      techDocs: document.getElementById('techDocsSummary'),
      photos: document.getElementById('photosSummary'),
      additionalFiles: document.getElementById('additionalFilesSummary')
    };

    const lists = {
      rightDocs: document.getElementById('rightDocsList'),
      techDocs: document.getElementById('techDocsList'),
      photos: document.getElementById('photosList'),
      additionalFiles: document.getElementById('additionalFilesList')
    };

    const stateBadges = {
      rightDocs: document.getElementById('state-rightDocs'),
      params: document.getElementById('state-params'),
      photos: document.getElementById('state-photos'),
      purpose: document.getElementById('state-purpose'),
      contacts: document.getElementById('state-contacts')
    };

    function formatBytes(bytes) {
      const value = Number(bytes || 0);
      if (!value) return '0 Б';
      if (value < 1024) return `${value} Б`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
      return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
    }

    function filesCount(input) {
      return input?.files ? input.files.length : 0;
    }

    function updateFileList(key, emptyText) {
      const input = fileInputs[key];
      const files = Array.from(input?.files || []);
      summaries[key].textContent = files.length
        ? `Загружено файлов: ${files.length}`
        : emptyText;
      lists[key].innerHTML = files.map(file => `
        <span class="file-pill">
          <span>${file.name}</span>
          <small>${formatBytes(file.size)}</small>
        </span>
      `).join('');
    }

    function getStepState() {
      const objectType = form.objectType.value.trim();
      const objectAddress = form.objectAddress.value.trim();
      const objectArea = form.objectArea.value.trim();
      const purpose = form.purpose.value.trim();
      const contactName = form.contactName.value.trim();
      const contactPhone = form.contactPhone.value.trim();
      const consent = form.consent.checked;

      return {
        rightDocs: filesCount(fileInputs.rightDocs) > 0,
        params: Boolean(objectType && objectAddress && objectArea),
        photos: filesCount(fileInputs.photos) > 0,
        purpose: Boolean(purpose),
        contacts: Boolean(contactName && contactPhone && consent)
      };
    }

    function setStatus(message, type = '') {
      formStatus.textContent = message;
      formStatus.classList.remove('is-error', 'is-success');
      if (type) formStatus.classList.add(type);
    }

    function updateProgress() {
      updateFileList('rightDocs', 'Файлы пока не выбраны');
      updateFileList('techDocs', 'Этот блок можно оставить без файлов — он не обязателен');
      updateFileList('photos', 'Нужно хотя бы одно фото');
      updateFileList('additionalFiles', 'Необязательный блок');

      const state = getStepState();
      const steps = Object.entries(state);
      const checked = steps.filter(([, done]) => done).length;
      const total = steps.length;
      const percent = Math.round((checked / total) * 100);

      docsCountText.textContent = checked;
      docsBar.style.width = percent + '%';
      docsPercent.textContent = percent + '%';
      heroPercent.textContent = percent + '%';
      heroBar.style.width = percent + '%';
      heroMeta.textContent = checked + '/' + total;
      heroTopCount.textContent = checked + ' из ' + total;
      objectScore.textContent = 'Заполнено на ' + percent + '%';
      houseFill.style.height = percent + '%';
      submitButton.disabled = checked !== total;

      if (checked === 0) {
        achievementText.textContent = 'Заполните первый шаг, и страница начнёт показывать прогресс, первое достижение и заполнение карточки объекта.';
      } else if (checked === 1) {
        achievementText.textContent = 'Старт выполнен. Появилось первое достижение, и заявка начала собираться по сценарию.';
      } else if (checked === 2) {
        achievementText.textContent = 'Хорошее начало: карточка объекта уже оживает, а до финала осталось 3 шага.';
      } else if (checked === 3) {
        achievementText.textContent = 'Уже 3 из 5 шагов: прогресс заметен сразу, а форма становится всё понятнее.';
      } else if (checked === 4) {
        achievementText.textContent = 'Почти готово. Остался последний шаг, и сценарий приведёт заявку к финальной отправке.';
      } else {
        achievementText.textContent = 'Отлично: заявка полностью собрана, все шаги закрыты, и пакет готов к передаче оценщику.';
      }

      rewards.forEach((reward, index) => {
        const thresholds = [1, 2, 4, 5];
        reward.classList.toggle('is-on', checked >= thresholds[index]);
      });

      Object.entries(state).forEach(([key, done]) => {
        const card = document.querySelector(`.check-item[data-step="${key}"]`);
        const badge = stateBadges[key];
        card.classList.toggle('is-checked', done);
        badge.textContent = done ? 'Готово' : 'Не заполнено';
        const targets = fieldMap[key] || [];
        targets.forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          el.classList.toggle('is-on', done);
        });
      });

      const selectedType = form.objectType.value.trim() || 'Объект ещё не выбран';
      objectTitle.textContent = selectedType;

      const rightDocsCount = filesCount(fileInputs.rightDocs);
      const photosCount = filesCount(fileInputs.photos);
      const techDocsCount = filesCount(fileInputs.techDocs);
      const additionalFilesCount = filesCount(fileInputs.additionalFiles);
      const purposeLabel = form.purpose.value.trim() || 'нужно добавить';
      const contactName = form.contactName.value.trim();
      const objectArea = form.objectArea.value.trim();

      document.querySelector('#field-address span').textContent = rightDocsCount ? `${rightDocsCount} файл(ов)` : 'нужно добавить';
      document.querySelector('#field-params span').textContent = state.params ? (objectArea || 'есть') : 'нужно добавить';
      document.querySelector('#field-photos span').textContent = photosCount ? `${photosCount} фото` : 'нужно добавить';
      document.querySelector('#field-purpose span').textContent = state.purpose ? purposeLabel : 'нужно добавить';
      document.querySelector('#field-contacts span').textContent = state.contacts ? contactName : 'нужно добавить';

      if (checked === total) {
        statusChip.classList.add('is-on');
        statusChip.querySelector('span').textContent = 'готово к отправке';
      } else if (checked >= 3) {
        statusChip.classList.add('is-on');
        statusChip.querySelector('span').textContent = 'в процессе';
      } else {
        statusChip.classList.remove('is-on');
        statusChip.querySelector('span').textContent = 'черновик';
      }

      summaries.techDocs.textContent = techDocsCount
        ? `Загружено файлов: ${techDocsCount}`
        : 'Этот блок можно оставить без файлов — он не обязателен';
      summaries.additionalFiles.textContent = additionalFilesCount
        ? `Загружено файлов: ${additionalFilesCount}`
        : 'Необязательный блок';
    }

    form.addEventListener('input', updateProgress);
    form.addEventListener('change', updateProgress);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const state = getStepState();
      const complete = Object.values(state).every(Boolean);
      if (!complete) {
        setStatus('Заполните все 5 шагов, чтобы отправить заявку.', 'is-error');
        return;
      }

      submitButton.disabled = true;
      setStatus('Отправляем заявку и сохраняем файлы на сервере…');

      try {
        const payload = new FormData(form);
        const response = await fetch('/api/gamified-leads', {
          method: 'POST',
          body: payload
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
          throw new Error(result.message || 'Не удалось отправить заявку.');
        }
        setStatus(result.message || 'Заявка отправлена.', 'is-success');
      } catch (error) {
        setStatus(error.message || 'Ошибка отправки заявки.', 'is-error');
      } finally {
        updateProgress();
      }
    });

    const revealElements = document.querySelectorAll('.reveal');

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.16 });

      revealElements.forEach(el => observer.observe(el));
    } else {
      revealElements.forEach(el => el.classList.add('is-visible'));
    }

    updateProgress();
  


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
