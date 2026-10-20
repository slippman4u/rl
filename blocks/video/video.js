const ALLOWED_HOSTS = ['dtcralphlauren.scene7.com'];

export default function decorate(block) {
  const link = block.querySelector('a');
  const href = link ? link.href : block.textContent.trim();
  block.textContent = '';

  let url;
  try {
    url = new URL(href);
  } catch (e) {
    return;
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) return;

  const video = document.createElement('video');
  video.controls = true;
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = url.href;
  block.append(video);
}
