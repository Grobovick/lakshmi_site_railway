# Структура главной страницы

Главная страница теперь хранится не одним огромным HTML-файлом, а в виде понятных частей:

- `src/layouts/base.html` — общий каркас страницы;
- `src/partials/header.html` — шапка;
- `src/partials/footer.html` — подвал;
- `src/pages/home.html` — состав главной страницы;
- `src/components/*.html` — отдельные блоки главной: первый экран, ситуации, услуги, этапы, FAQ, контакты;
- `public/assets/css/lakshmi-main.css` — стили главной;
- `public/assets/js/lakshmi-main.js` — анимации и отправка быстрой заявки;
- `public/assets/img/` — логотипы и иллюстрации.

Для Railway сайт всё равно отдаёт готовый файл `public/lakshmi_landing_restyled.html`, поэтому серверная логика и заявки не меняются. Если редактировать исходники в `src/`, нужно выполнить:

```bash
npm run build
```

После этого обновится файл `public/lakshmi_landing_restyled.html`.


## Обновление от текущей версии

Теперь сборщик формирует две публичные страницы:

- `public/lakshmi_landing_restyled.html` — главная страница;
- `public/lakshmi_gamified_application_restyled.html` — пошаговая заявка.

Для страницы заявки добавлены отдельные файлы:

```text
src/layouts/application.html
src/pages/application.html
src/partials/header-application.html
src/partials/footer-application.html
public/assets/css/lakshmi-application.css
public/assets/js/lakshmi-application.js
```

После правок в `src/` нужно выполнить `npm run build`.
