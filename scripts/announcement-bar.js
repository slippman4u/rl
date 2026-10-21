const ANNOUNCEMENT_PATH = '/announcement';

async function loadAnnouncement() {
  const header = document.querySelector('header');
  if (!header || document.querySelector('.announcement-bar')) return;

  try {
    const resp = await fetch(`${ANNOUNCEMENT_PATH}.plain.html`);
    if (!resp.ok) return;

    const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
    const source = doc.querySelector('p');
    if (!source) return;

    const p = document.createElement('p');
    source.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        p.append(node.textContent);
      } else if (node.nodeName === 'A') {
        const a = document.createElement('a');
        a.textContent = node.textContent;
        try {
          const url = new URL(node.getAttribute('href'), window.location.origin);
          if (url.protocol === 'https:') a.href = url.href;
        } catch (e) {
          // ignore invalid links
        }
        p.append(a);
      }
    });

    const bar = document.createElement('div');
    bar.className = 'announcement-bar';
    bar.append(p);
    header.prepend(bar);
  } catch (e) {
    // the site works without the bar
  }
}

loadAnnouncement();
