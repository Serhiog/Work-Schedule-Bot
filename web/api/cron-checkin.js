// Vercel Cron: daily 4:00 UTC (= 8:00 Dubai). Sends "good-morning"
// check-in to admin/foreman chat with list of active tasks for today.

const TG_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_FOREMAN_CHAT = process.env.TG_FOREMAN_CHAT_ID || process.env.TG_ADMIN_CHAT_ID || '584268213';
const CRON_SECRET   = process.env.CRON_SECRET || '';

async function tgSend(chatId, html) {
  if (!TG_BOT_TOKEN) return { skipped: 'no TELEGRAM_BOT_TOKEN' };
  const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });
  return r.json().catch(() => ({}));
}

module.exports = async function handler(req, res) {
  if (CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: 'unauthorized' });
  }

  const slugs = (process.env.CRON_PROJECTS || 'orange-1801')
    .split(',').map(s => s.trim()).filter(Boolean);

  const results = [];
  for (const slug of slugs) {
    try {
      const r = await fetch(`https://cyfr-schedule-app.vercel.app/api/operational?slug=${encodeURIComponent(slug)}`);
      const data = await r.json();
      if (!data.ok) { results.push({ slug, error: data.error }); continue; }

      const lines = [];
      lines.push(`<b>🌅 Доброе утро!</b>`);
      lines.push(`<i>${data.project.name}</i>`);
      lines.push('');
      if (data.activeTasks?.length) {
        lines.push(`<b>Сегодня в работе (${data.activeTasks.length}):</b>`);
        for (const t of data.activeTasks.slice(0, 10)) {
          const tag = t.daysLeft <= 0 ? '🔴 просрочка' : t.daysLeft === 1 ? '⏰ дедлайн завтра' : `${t.daysLeft} дн. до конца`;
          lines.push(`• <b>${t.taskName}</b> · ${tag}`);
        }
      } else {
        lines.push(`<i>Активных задач сегодня нет.</i>`);
      }
      lines.push('');
      lines.push(`👥 По плану на объекте: <b>${data.resourcePeak?.todayPeople || 0} чел.</b>`);
      if (data.riskyMaterials?.length) {
        lines.push(`📦 Материалов в риске: <b>${data.riskyMaterials.length}</b>`);
      }
      lines.push('');
      lines.push(`<i>Проблемы? Что не так? Скажи голосом или текстом — я разберусь и обновлю график.</i>`);
      lines.push('');
      lines.push(`<a href="https://cyfr-schedule-app.vercel.app/p/${slug}">График →</a>`);
      const tgRes = await tgSend(TG_FOREMAN_CHAT, lines.join('\n'));
      results.push({ slug, sent: !!tgRes.ok, activeCount: data.activeTasks?.length || 0 });
    } catch (e) {
      results.push({ slug, error: e.message });
    }
  }
  res.status(200).json({ ok: true, results });
};
