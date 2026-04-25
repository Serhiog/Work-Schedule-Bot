// Vercel Cron: daily 6:00 UTC (= 10:00 Dubai). Reads /api/operational for each
// project listed in env CRON_PROJECTS (comma-separated slugs, default: orange-1801),
// sends Telegram message to TG_ADMIN_CHAT_ID if there are risky materials.

const TG_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_ADMIN_CHAT = process.env.TG_ADMIN_CHAT_ID || '584268213';
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
  // Vercel sends header 'authorization: Bearer <CRON_SECRET>' for cron
  if (CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const slugs = (process.env.CRON_PROJECTS || 'orange-1801')
    .split(',').map(s => s.trim()).filter(Boolean);

  const results = [];
  for (const slug of slugs) {
    try {
      const r = await fetch(`https://cyfr-schedule-app.vercel.app/api/operational?slug=${encodeURIComponent(slug)}`);
      const data = await r.json();
      if (!data.ok) { results.push({ slug, error: data.error }); continue; }
      if (!data.riskyMaterials?.length) { results.push({ slug, sent: false, reason: 'no risk' }); continue; }

      const lines = [];
      lines.push(`<b>📦 Материалы — пора заказывать</b>`);
      lines.push(`<i>${data.project.name}</i>`);
      lines.push('');
      for (const r of data.riskyMaterials) {
        const tag = r.overdueDays > 0 ? `🔴 заказывать СЕГОДНЯ` : `⚠️ до ${r.orderBy}`;
        lines.push(`• <b>${r.taskName}</b> — ${tag}`);
        lines.push(`  ${r.risky.map(m => m.name + ' (' + m.leadTime + 'д)').join(', ')}`);
        lines.push(`  старт работы: ${r.planStart} (через ${r.daysToStart} дн.)`);
        lines.push('');
      }
      lines.push(`<a href="https://cyfr-schedule-app.vercel.app/p/${slug}">Открыть график →</a>`);
      const tgRes = await tgSend(TG_ADMIN_CHAT, lines.join('\n'));
      results.push({ slug, sent: !!tgRes.ok, riskyCount: data.riskyMaterials.length });
    } catch (e) {
      results.push({ slug, error: e.message });
    }
  }
  res.status(200).json({ ok: true, results });
};
