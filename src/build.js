const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');

function read(relPath) {
  return fs.readFileSync(path.join(src, relPath), 'utf8');
}

function render(template) {
  return template.replace(/\{\{include:([^}]+)\}\}/g, (_, relPath) => {
    const file = path.join(src, relPath.trim());
    if (!fs.existsSync(file)) return '';
    return render(fs.readFileSync(file, 'utf8'));
  });
}

const pages = [
  { layout: 'layouts/base.html', output: 'lakshmi_landing_restyled.html' },
  { layout: 'layouts/application.html', output: 'lakshmi_gamified_application_restyled.html' },
  { layout: 'layouts/office.html', output: 'lakshmi_virtual_office.html' }
];

for (const page of pages) {
  const html = render(read(page.layout));
  fs.writeFileSync(path.join(root, 'public', page.output), html, 'utf8');
  console.log(`Built public/${page.output}`);
}
