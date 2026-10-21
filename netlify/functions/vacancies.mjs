// Reads the public web preview of the Work Space Telegram channel and returns the latest vacancies as JSON.
// Served at /api/vacancies. The CDN caches the answer for 10 minutes, so Telegram is asked at most a few times an hour.

const CHANNEL = 'WorkSpace_1';
const LIMIT = 8;
const OWN_HANDLES = ['workspace_1', 'workspace_emilia'];

const VERTICALS = [
  ['Sweepstakes', /sweepstake/i],
  ['iGaming', /igaming/i],
  ['Gambling', /gambl|гемблинг|гэмблинг|казино|casino/i],
  ['Betting', /betting|беттинг/i],
  ['Crypto / FX', /crypto\s*[\/|&]\s*fx|crypto\s*fx/i],
  ['Crypto', /crypto|крипт/i],
  ['FX', /\bfx\b|forex|форекс/i],
  ['Nutra', /nutra|нутра/i],
  ['Dating', /dating|дейтинг/i],
  ['FinTech', /fintech|финтех/i],
  ['E-commerce', /e-?commerce|ecom/i]
];
const VERTICAL_WORDS = /\b(i?gaming|gambling|sweepstakes?(\s+casino)?|casino|betting|crypto|fx|forex|nutra|dating|fintech|e-?commerce|ecom)\b/gi;

const DIRECTIONS = [
  ['devops', /devops|dev\s*ops/i],
  ['design', /design|дизайн|motion|креатив|creative|video\s*edit|монтаж/i],
  ['buy', /media[\s_-]*buy|buyer|баер|байер|медиабаинг/i],
  ['aff', /affiliate|аффилейт|афіліейт|\bam\b/i],
  ['sales', /sales|\bbdm\b|business\s*develop|продаж/i],
  ['tech', /tech|farm|фарм|developer|разработ|розробн|qa\b|техн/i]
];

const PLATFORMS = [['Facebook', /facebook|\bfb\b/i], ['TikTok', /tik\s*tok/i], ['Google', /google|\buac\b/i], ['X', /\btwitter\b|\bx\s*\(twitter\)|\bx ads\b/i], ['Snapchat', /snapchat/i], ['In-app', /in-?app/i], ['ASO', /\baso\b/i], ['SEO', /\bseo\b/i]];

const ACRONYMS = new Set(['VIP', 'FX', 'IT', 'HR', 'SEO', 'SMM', 'PPC', 'UAC', 'CPA', 'TL', 'PM', 'QA', 'UI', 'UX', 'ASO', 'CEO', 'CTO', 'CMO', 'BDM', 'PWA', 'USDT', 'FB', 'AM', 'SMS', 'API', 'SQL', 'CRM', 'B2B', 'B2C', 'KPI', 'GEO', 'iOS']);

function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function htmlToText(html) {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function smartCase(title) {
  return title.split(/(\s+|\/|\|)/).map((w) => {
    const core = w.replace(/[^A-Za-zА-Яа-яЁёІіЇїЄє0-9-]/g, '');
    if (!core) return w;
    if (/^igaming$/i.test(core)) return w.replace(core, 'iGaming');
    if (ACRONYMS.has(core.toUpperCase()) && core.length <= 4) return w.replace(core, core.toUpperCase() === 'IOS' ? 'iOS' : core.toUpperCase());
    if (core === core.toUpperCase() && core.length > 1) return w.replace(core, core.charAt(0) + core.slice(1).toLowerCase());
    return w;
  }).join('');
}

function cleanTitle(line, vertical) {
  let t = line.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[\p{Extended_Pictographic}☀-➿️‍]/gu, '').replace(/^[\s\-–—•*·:|]+|[\s\-–—•*·:|]+$/g, '');
  let parts = t.split('|').map((p) => p.trim()).filter(Boolean);
  // drop parts that only name a vertical (it is shown as its own label)
  if (parts.length > 1) parts = parts.filter((p, i) => i === 0 || p.replace(VERTICAL_WORDS, '').replace(/[\s\/&,()+-]/g, '') !== '');
  t = parts.join(' | ');
  if (vertical) {
    const stripped = t.replace(VERTICAL_WORDS, '').replace(/\(\s*\)/g, '').replace(/\s*[\/|&,]\s*(?=$|[\/|&,])/g, '').replace(/\s{2,}/g, ' ').replace(/[\s\/|&,(-]+$/g, '').trim();
    if (stripped.length >= 3) t = stripped;
  }
  t = smartCase(t).replace(/\s{2,}/g, ' ').trim();
  return t.length > 70 ? t.slice(0, 67).trim() + '…' : t;
}

function findSalary(text) {
  const money = text.match(/(?:\d[\d\s.,]*\d\s?k?\s?[-–—]\s?\d[\d\s.,]*\d?\s?k?\s?(?:\$|usd|usdt)|\$\s?\d[\d\s.,]*\d?k?(?:\s?[-–—]\s?\$?\s?\d[\d\s.,]*\d?k?)?|\d[\d\s.,]*\d?\s?k?\s?(?:\$|usd|usdt|долл)(?:\s?[-–—]\s?\d[\d\s.,]*\d?\s?k?\s?(?:\$|usd|usdt)?)?|(?:від|от|from)\s\d[\d\s.,]*\d?\s?(?:\$|usd|usdt))/i);
  const percent = text.match(/(?:до\s|up to\s)?\d{1,2}\s?[-–—]\s?\d{1,2}\s?%|(?:до\s|up to\s)?\d{1,2}\s?%/i);
  const hasPercentWord = /%|процент|відсот|профит|профіт|profit|revshare|бонус/i.test(text);
  const fix = /\bfix\b|фикс|фікс|ставк|оклад|salary\s*\+/i.test(text);
  if (money) {
    let m = money[0].replace(/\s+/g, ' ').replace(/usdt|usd|долл\.?/i, '$').trim();
    if (!/\$/.test(m)) m = '$' + m;
    return (m + (hasPercentWord && percent ? ' + ' + percent[0].replace(/\s/g, '') : hasPercentWord ? ' + %' : '')).slice(0, 40);
  }
  if (percent) return (fix ? 'Фикс + ' : '') + percent[0].replace(/\s/g, '').replace(/^(до|up to)/i, 'до ') + (/профит|профіт|profit/i.test(text) && !fix ? ' от профита' : '');
  if (fix && hasPercentWord) return 'Фикс + %';
  return null;
}

function findFormat(text) {
  const t = text.toLowerCase();
  return {
    remote: /remote|удал[её]н|віддален|дистанц|онлайн|full[\s-]?remote/.test(t),
    office: /офис|офіс|office|on-?site/.test(t),
    hybrid: /гибрид|гібрид|hybrid/.test(t),
    pl: /польш|польщ|poland|warsaw|варшав|krak|краков|wroc/.test(t),
    ua: /украин|україн|ukraine|киев|київ|kyiv|днепр|дніпр|dnipro|львів|львов|lviv|одес|odesa|харк/.test(t)
  };
}

export function parse(html) {
  const blocks = html.split(/(?=<div class="tgme_widget_message_wrap)/).slice(1);
  const items = [];
  for (const block of blocks) {
    const idm = block.match(/data-post="([^"\/]+)\/(\d+)"/);
    const txtm = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!idm || !txtm) continue;
    const text = htmlToText(txtm[1]);
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const tags = (text.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.slice(1).toLowerCase());
    const headLine = lines.find((l) => l.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[\p{Extended_Pictographic}\s️|•*-]/gu, '').length > 2) || '';
    const roleRe = /manager|buyer|developer|designer|lead|head|specialist|engineer|analyst|recruiter|marketer|editor|tester|farmer|owner|assistant|support|operator|менеджер|баер|байер|разработ|розробн|дизайнер|специалист|спеціаліст|аналитик|рекрутер|фармер|тимлид|тімлід|ассистент|асистент|оператор|копирайтер|smm|seo|devops|qa/i;
    const isAd = tags.some((t) => /^(реклама|ad|ads|promo|партнерский|партнерськ)/.test(t));
    if (isAd || !roleRe.test(headLine + ' ' + tags.join(' '))) continue;
    const headSrc = headLine + ' ' + tags.join(' ');
    let found = VERTICALS.filter(([, re]) => re.test(headSrc)).sort((a, b) => headSrc.search(a[1]) - headSrc.search(b[1])).map(([n]) => n);
    if (found.includes('Crypto / FX')) found = found.filter((n) => n !== 'Crypto' && n !== 'FX');
    if (found.includes('Sweepstakes')) found = found.filter((n) => n !== 'Gambling');
    if (!found.length) { const t = VERTICALS.find(([, re]) => re.test(text)); if (t) found = [t[0]]; }
    const vertical = found.slice(0, 2).join(' / ');
    let dir = '';
    for (const [key, re] of DIRECTIONS) if (re.test(tags.join(' '))) { dir = key; break; }
    if (!dir) for (const [key, re] of DIRECTIONS) if (re.test(headLine)) { dir = key; break; }
    dir = dir || 'other';
    const handles = (text.match(/@[A-Za-z0-9_]{4,}/g) || []).map((h) => h.slice(1)).filter((h) => !OWN_HANDLES.includes(h.toLowerCase()));
    const fmt = findFormat(text);
    const platforms = PLATFORMS.filter(([, re]) => re.test(headLine + '\n' + text)).map(([n]) => n).slice(0, 3);
    const dm = block.match(/<time[^>]*datetime="([^"]+)"/);
    items.push({
      id: +idm[2],
      post: 'https://t.me/' + idm[1] + '/' + idm[2],
      title: cleanTitle(headLine, vertical) || 'Вакансия',
      vertical,
      dir,
      country: fmt.pl ? 'pl' : fmt.ua && !fmt.remote ? 'ua' : 'remote',
      format: fmt.hybrid ? 'hybrid' : fmt.office && !fmt.remote ? 'office' : 'remote',
      salary: findSalary(text),
      note: platforms.filter((pl) => !new RegExp(pl, 'i').test(headLine)).join(', ') || null,
      contact: handles[0] || '',
      hotTag: tags.some((t) => /^(hot|горяч|гаряч|топ|top)/.test(t)),
      date: dm ? dm[1] : null
    });
  }
  items.sort((a, b) => b.id - a.id);
  const latest = items.slice(0, LIMIT);
  const anyTagged = latest.some((i) => i.hotTag);
  latest.forEach((it, i) => { it.hot = anyTagged ? it.hotTag : i < 2; delete it.hotTag; });
  return latest;
}

export default async () => {
  try {
    const res = await fetch('https://t.me/s/' + CHANNEL, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; WorkSpaceSite/1.0)', 'accept-language': 'ru,uk;q=0.9,en;q=0.8' }
    });
    if (!res.ok) throw new Error('telegram ' + res.status);
    const items = parse(await res.text());
    return new Response(JSON.stringify({ ok: true, updated: new Date().toISOString(), items }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=0, must-revalidate',
        'netlify-cdn-cache-control': 'public, durable, s-maxage=600, stale-while-revalidate=86400'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e), items: [] }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
};

export const config = { path: '/api/vacancies' };
