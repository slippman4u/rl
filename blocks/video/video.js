const ALLOWED_HOSTS = ['dtcralphlauren.scene7.com'];

function buildVideo(href) {
  let url;
  try {
    url = new URL(href);
  } catch (e) {
    return null;
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) return null;

  const video = document.createElement('video');
  video.controls = true;
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = url.href;
  return video;
}

/**
 * Video block.
 * - One cell: the video link only (centered, as before).
 * - Two cells in the first row (or extra rows below): the video sits on the left
 *   and the other content (headings, paragraphs, lists) sits on the right.
 */
export default function decorate(block) {
  const rows = [...block.children];
  const firstCells = rows[0] ? [...rows[0].children] : [];
  const mediaCell = firstCells[0] || block;
  const link = mediaCell.querySelector('a');
  const href = link ? link.href : mediaCell.textContent.trim();

  // Collect the text content before clearing the block.
  const detailNodes = [];
  firstCells.slice(1).forEach((cell) => detailNodes.push(...cell.childNodes));
  rows.slice(1).forEach((row) => {
    [...row.children].forEach((cell) => detailNodes.push(...cell.childNodes));
  });

  block.textContent = '';
  const video = buildVideo(href);

  if (!detailNodes.length) {
    if (video) block.append(video);
    return;
  }

  block.classList.add('video-split');

  const media = document.createElement('div');
  media.className = 'video-media';
  if (video) media.append(video);

  const details = document.createElement('div');
  details.className = 'video-details';
  details.append(...detailNodes);

  // A paragraph that is only bold text is treated as a section heading.
  details.querySelectorAll('p').forEach((p) => {
    const only = p.children.length === 1 ? p.firstElementChild : null;
    if (only && only.tagName === 'STRONG' && p.textContent.trim() === only.textContent.trim()) {
      p.classList.add('video-details-heading');
    }
  });

  if (video) block.append(media);
  block.append(details);
  if (!video) block.classList.add('video-split-text-only');
}
