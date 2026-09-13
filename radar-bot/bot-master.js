import 'dotenv/config';
import http from 'http';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

// ------------------- خادم الويب للحفاظ على نشاط الخدمة على Render -------------------
const PORT = process.env.PORT || 10000;
const httpServer = http.createServer((req, res) => {
  // رد فوري 200 OK لأي طلب (فحوصات صحة Render / أي بينغ خارجي)
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🤖 رادار صفقات قطر يعمل بنجاح في السحابة!');
});
httpServer.on('error', (err) => {
  console.error('❌ [WEB SERVER] خطأ في خادم الويب:', err.message);
});
httpServer.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
  console.log('Available at your primary URL');
});

// ------------------- حماية العملية من الانهيار الصامت -------------------
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [UNHANDLED REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ [UNCAUGHT EXCEPTION]', err.stack || err.message);
});

// ------------------- إعداد البوت والملفات -------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ [FATAL] متغير البيئة BOT_TOKEN غير موجود. أضفه في Render → Environment، أو في ملف .env محلياً، ثم أعد التشغيل.');
  process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN);

const DB_FILE = './user_alerts.json';
const USERS_FILE = './users.json';
const seenAds = new Set();
const userState = {};

// قراءة وحفظ التنبيهات
function getAlerts() {
  if (!fs.existsSync(DB_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch { return []; }
}
function saveAlerts(alerts) {
  fs.writeFileSync(DB_FILE, JSON.stringify(alerts, null, 2));
}

// قراءة وحفظ إعدادات المستخدمين ولغاتهم
function getUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); } catch { return {}; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function getUserLang(chatId) {
  const users = getUsers();
  return users[chatId]?.lang || 'ar';
}

// ------------------- قواميس النصوص باللغتين -------------------
const i18n = {
  ar: {
    welcome: (name) => `مرحباً بك يا <b>${name}</b> في <b>رادار قطر الذكي 🇶🇦</b>\n\nراصد آلي يرصد أحدث الإعلانات في كل المنصات القطرية لحظة بلحظة.\n\nاضغط على أي زر للبدء 👇`,
    btn_add: '➕ تشغيل رادار جديد',
    btn_list: '📋 راداراتي النشطة',
    btn_clear: '🗑️ مسح الرادارات',
    btn_lang: '🌐 Change Language / تغيير اللغة',
    ask_keyword: '🔎 اكتب اسم السلعة التي تبحث عنها:\n(مثال: لاندكروزر، لوحة سيارة، رولكس، شقة، بلايستيشن)',
    ask_price: (kw) => `ممتاز! المطلوب: "${kw}".\n\n💰 اكتب الحد الأقصى للسعر بالريال (أو أرسل 0 لأي سعر):`,
    alert_created: (kw, price) => `✅ <b>تم تفعيل الرادار!</b>\n\n🎯 <b>السلعة:</b> ${kw}\n💰 <b>السعر الأقصى:</b> ${price === 0 ? 'أي سعر' : price.toLocaleString() + ' ر.ق'}\n\nسننبهك فور نزول أي إعلان مطابق! 🚀`,
    no_alerts: '⚠️ ليس لديك أي رادارات نشطة حالياً.',
    my_alerts_title: '📋 <b>راداراتك الشغالة حالياً:</b>\n\n',
    cleared: '🗑️ تم مسح جميع راداراتك بنجاح.',
    alert_msg: (platform, kw, text, price, link) => `🚨 <b>صيدة جديدة تطابق رادارك!</b>\n\n📍 <b>المنصة:</b> ${platform}\n🎯 <b>طلبك:</b> ${kw}\n📝 <b>الإعلان:</b> ${text}\n💰 <b>السعر:</b> ${price > 0 ? price.toLocaleString() + ' ر.ق' : 'راجع الإعلان'}\n\n🔗 <a href="${link}">اضغط هنا لفتح الإعلان فوراً</a>`,
    testscan_running: '🔍 جارٍ تشغيل فحص تشخيصي فوري...',
    testscan_report: (alertsCount, lines) => `🧪 <b>تقرير الفحص التشخيصي</b>\n\n📋 <b>عدد الرادارات النشطة:</b> ${alertsCount}\n\n${lines}`
  },
  en: {
    welcome: (name) => `Welcome <b>${name}</b> to <b>Qatar Smart Radar 🇶🇦</b>\n\nAutomated bot tracking the latest listings across all Qatari platforms in real time.\n\nChoose an option below 👇`,
    btn_add: '➕ Add New Radar',
    btn_list: '📋 My Active Radars',
    btn_clear: '🗑️ Clear All',
    btn_lang: '🌐 تغيير اللغة / Change Language',
    ask_keyword: '🔎 Enter the item/keyword you want to track:\n(e.g., Land Cruiser, Plate number, Rolex, Villa, iPhone)',
    ask_price: (kw) => `Great! Tracking: "${kw}".\n\n💰 Enter max price in QAR (or send 0 for any price):`,
    alert_created: (kw, price) => `✅ <b>Radar Activated!</b>\n\n🎯 <b>Item:</b> ${kw}\n💰 <b>Max Price:</b> ${price === 0 ? 'Any price' : price.toLocaleString() + ' QAR'}\n\nYou will be notified instantly when a match is found! 🚀`,
    no_alerts: '⚠️ You have no active radars currently.',
    my_alerts_title: '📋 <b>Your Active Radars:</b>\n\n',
    cleared: '🗑️ All your radars have been cleared.',
    alert_msg: (platform, kw, text, price, link) => `🚨 <b>New Deal Found!</b>\n\n📍 <b>Platform:</b> ${platform}\n🎯 <b>Keyword:</b> ${kw}\n📝 <b>Title:</b> ${text}\n💰 <b>Price:</b> ${price > 0 ? price.toLocaleString() + ' QAR' : 'Check Listing'}\n\n🔗 <a href="${link}">Click here to view deal</a>`,
    testscan_running: '🔍 Running immediate diagnostic scan...',
    testscan_report: (alertsCount, lines) => `🧪 <b>Diagnostic Scan Report</b>\n\n📋 <b>Active radars:</b> ${alertsCount}\n\n${lines}`
  }
};

// توليد لوحة التحكم حسب لغة المستخدم
function getMenuKeyboard(lang) {
  const t = i18n[lang];
  return Markup.inlineKeyboard([
    [Markup.button.callback(t.btn_add, 'ACTION_ADD')],
    [Markup.button.callback(t.btn_list, 'ACTION_LIST'), Markup.button.callback(t.btn_clear, 'ACTION_CLEAR')],
    [Markup.button.callback(t.btn_lang, 'ACTION_CHANGE_LANG')]
  ]);
}

// نافذة اختيار اللغة
const langKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🇶🇦 العربية', 'SET_LANG_ar'), Markup.button.callback('🇬🇧 English', 'SET_LANG_en')]
]);

// ------------------- أوامر وتفاعل البوت -------------------

bot.action(/SET_LANG_(.+)/, (ctx) => {
  ctx.answerCbQuery();
  const lang = ctx.match[1];
  const users = getUsers();
  users[ctx.chat.id] = { lang };
  saveUsers(users);

  const t = i18n[lang];
  ctx.replyWithHTML(t.welcome(ctx.from.first_name || 'User'), getMenuKeyboard(lang));
});

bot.action('ACTION_CHANGE_LANG', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('اختر لغتك المفضلة / Choose your preferred language:', langKeyboard);
});

bot.action('ACTION_ADD', (ctx) => {
  ctx.answerCbQuery();
  const lang = getUserLang(ctx.chat.id);
  userState[ctx.chat.id] = { step: 'WAITING_KEYWORD' };
  ctx.reply(i18n[lang].ask_keyword);
});

bot.action('ACTION_LIST', (ctx) => {
  ctx.answerCbQuery();
  const lang = getUserLang(ctx.chat.id);
  const t = i18n[lang];
  const myAlerts = getAlerts().filter(a => a.chatId === ctx.chat.id);

  if (myAlerts.length === 0) {
    return ctx.reply(t.no_alerts, getMenuKeyboard(lang));
  }

  let msg = t.my_alerts_title;
  myAlerts.forEach((item, i) => {
    msg += `${i + 1}. 🎯 ${item.keyword} | 💰 ${item.maxPrice > 0 ? item.maxPrice.toLocaleString() + ' QAR' : (lang === 'ar' ? 'أي سعر' : 'Any')}\n`;
  });

  ctx.replyWithHTML(msg, getMenuKeyboard(lang));
});

bot.action('ACTION_CLEAR', (ctx) => {
  ctx.answerCbQuery();
  const lang = getUserLang(ctx.chat.id);
  const remaining = getAlerts().filter(a => a.chatId !== ctx.chat.id);
  saveAlerts(remaining);
  ctx.reply(i18n[lang].cleared, getMenuKeyboard(lang));
});

// أمر تشخيصي: فحص فوري لكل المنصات + تقرير مباشر على تيليجرام
bot.command('testscan', async (ctx) => {
  const lang = getUserLang(ctx.chat.id);
  const t = i18n[lang];
  try {
    await ctx.reply(t.testscan_running);
    const alerts = getAlerts();
    const results = await runRadarScan();

    const lines = results.map(r => {
      const statusIcon = r.error ? '❌' : '✅';
      const statusText = r.error ? `ERROR: ${r.error}` : `HTTP ${r.status}`;
      return `${statusIcon} <b>${r.platform}</b> — ${statusText} — ${r.count} items inspected`;
    }).join('\n');

    await ctx.replyWithHTML(t.testscan_report(alerts.length, lines));
  } catch (err) {
    console.error('❌ [/testscan] خطأ:', err.message);
    ctx.reply(`❌ /testscan failed: ${err.message}`).catch(() => {});
  }
});

bot.on('text', (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getUserLang(chatId);
  const t = i18n[lang];
  const state = userState[chatId];
  const text = ctx.message.text.trim();

  if (state && state.step === 'WAITING_KEYWORD') {
    state.keyword = text;
    state.step = 'WAITING_PRICE';
    return ctx.reply(t.ask_price(text));
  }

  if (state && state.step === 'WAITING_PRICE') {
    const rawPrice = parseInt(text.replace(/[^0-9]/g, '')) || 0;
    const allAlerts = getAlerts();

    const newAlert = {
      id: Date.now(),
      chatId: chatId,
      lang: lang,
      keyword: state.keyword.toLowerCase(),
      maxPrice: rawPrice,
      createdAt: new Date().toISOString()
    };

    allAlerts.push(newAlert);
    saveAlerts(allAlerts);
    delete userState[chatId];

    return ctx.replyWithHTML(t.alert_created(newAlert.keyword, rawPrice), getMenuKeyboard(lang));
  }

  // إذا لم يكن المستخدم قد اختار لغة بعد
  const users = getUsers();
  if (!users[chatId]) {
    return ctx.reply('مرحباً بك! اختر لغتك المفضلة:\nWelcome! Choose your language:', langKeyboard);
  }

  ctx.replyWithHTML(t.welcome(ctx.from.first_name || 'User'), getMenuKeyboard(lang));
});

// معالج أخطاء عام لتيليجراف - يمنع انهيار العملية بسبب خطأ في معالج تحديث واحد
bot.catch((err, ctx) => {
  console.error(`❌ [BOT ERROR] update ${ctx.updateType}:`, err.message);
});

// ------------------- محرك الفحص والمسح المطور -------------------

// عميل Axios مخصص بهيدرز متصفح حقيقية ومهلة صارمة 10 ثوانٍ
const httpClient = axios.create({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ar-QA,ar;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://www.google.com/',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'keep-alive'
  },
  // لا نرمي استثناء على أكواد الحالة غير الناجحة، نريد رؤيتها في التشخيص
  validateStatus: () => true
});

// يحاول عدة محددات CSS واقعية لبطاقات الإعلانات حتى يجد نتائج كافية
function extractListings($, baseUrl, cardSelectors) {
  for (const sel of cardSelectors) {
    const cards = $(sel);
    if (cards.length < 3) continue;

    const listings = [];
    cards.each((i, el) => {
      const $el = $(el);
      const rawLink = $el.is('a') ? $el.attr('href') : $el.find('a').first().attr('href');
      if (!rawLink) return;

      const titleEl = $el.find('h1, h2, h3, h4, h5, .title, .ad-title, .card-title, [class*="title"]').first();
      const priceEl = $el.find('.price, .ad-price, [class*="price"]').first();

      const title = (titleEl.text() || $el.text()).replace(/\s+/g, ' ').trim();
      const priceText = priceEl.text().replace(/\s+/g, ' ').trim();
      const text = priceText && !title.includes(priceText) ? `${title} ${priceText}` : title;

      if (!text || text.length < 5) return;
      const fullLink = rawLink.startsWith('http') ? rawLink : baseUrl + rawLink;
      listings.push({ text, link: fullLink });
    });

    if (listings.length) return listings;
  }
  return [];
}

// خطة احتياطية: مسح كل الروابط واستنتاج النص من أقرب حاوية أب
function extractListingsFallback($, baseUrl) {
  const listings = [];
  $('a').each((i, el) => {
    const $el = $(el);
    const rawLink = $el.attr('href') || '';
    const containerText = $el.closest('div, li, article').text().replace(/\s+/g, ' ').trim();
    const text = containerText.length > 10 ? containerText : $el.text().replace(/\s+/g, ' ').trim();

    if (!rawLink || text.length < 5) return;
    const fullLink = rawLink.startsWith('http') ? rawLink : baseUrl + rawLink;
    listings.push({ text, link: fullLink });
  });
  return listings;
}

async function scanPlatform({ label, logTag, url, baseUrl, cardSelectors, alerts }) {
  try {
    const response = await httpClient.get(url);
    const status = response.status;
    const $ = cheerio.load(response.data || '');

    let listings = extractListings($, baseUrl, cardSelectors);
    if (listings.length === 0) listings = extractListingsFallback($, baseUrl);

    console.log(`[${logTag}] Found ${listings.length} listings (HTTP ${status})`);

    for (const { text, link } of listings) {
      checkAndSendAlert(alerts, text, link, label);
    }

    return { platform: label, status, count: listings.length, error: null };
  } catch (err) {
    const status = err.response?.status || 0;
    console.log(`⚠️ [${logTag}] فحص فشل:`, err.message);
    return { platform: label, status, count: 0, error: err.message };
  }
}

async function runRadarScan() {
  const alerts = getAlerts();
  console.log(`🔍 [Radar] بدء جولة فحص المنصات لـ (${alerts.length}) رادار نشط...`);

  const platforms = [
    {
      // معروف: هذا الموقع محمي بـ Cloudflare/WAF حقيقي (يرجع HTTP 403 دائماً).
      // تغيير الهيدرز وحده غير كافٍ لتجاوزه — يحتاج متصفح حقيقي (Puppeteer) أو
      // خدمة Anti-bot مدفوعة. تم تأجيل هذا الحل عمداً لتبقى الخدمة خفيفة ومستقرة.
      label: 'Mzad Qatar | مزاد قطر',
      logTag: 'Mzad',
      url: 'https://mzadqatar.com/ar',
      baseUrl: 'https://mzadqatar.com',
      cardSelectors: ['.ad-card', '.listing-card', 'article', '.card', 'li.item', '[class*="listing"]']
    },
    {
      // معروف: صفحة الإعلانات هنا تطبيق SPA يحمّل الإعلانات الفعلية عبر
      // JavaScript بعد التحميل الأولي — غير موجودة في الـ HTML الذي يجلبه axios.
      // نفس قرار عدم إضافة متصفح حقيقي (Puppeteer) ينطبق هنا لنفس سبب الاستقرار.
      label: 'Qatar Living | قطر ليفنج',
      logTag: 'QatarLiving',
      url: 'https://www.qatarliving.com/classifieds',
      baseUrl: 'https://www.qatarliving.com',
      cardSelectors: ['.view-content .views-row', '.classified-item', 'article', '.card', '[class*="teaser"]']
    },
    {
      label: 'OpenSooq | السوق المفتوح',
      logTag: 'OpenSooq',
      url: 'https://qa.opensooq.com/ar',
      baseUrl: 'https://qa.opensooq.com',
      cardSelectors: ['.postListItemData', '.item', 'article', '.card', 'li.item']
    },
    {
      // معروف: نفس وضع مزاد قطر — حماية Cloudflare/WAF حقيقية (HTTP 403).
      label: 'Qatar Sale | قطر سيل',
      logTag: 'QatarSale',
      url: 'https://qatarsale.com',
      baseUrl: 'https://qatarsale.com',
      cardSelectors: ['.product', '.item', 'article', '.card', 'tr']
    }
    // Sooum (sooum.com) مُعطّلة عمداً: الدومين لا يستجيب فعلياً ويشير إلى
    // عنوان IP غير متعلق بقطر إطلاقاً (يبدو منتهي الصلاحية أو مسجّل لجهة أخرى)،
    // وليست مجرد حماية بوتات. أعد تفعيلها هنا فقط لو توفر رابط صحيح للمنصة.
  ];

  const settled = await Promise.allSettled(
    platforms.map(p => scanPlatform({ ...p, alerts }))
  );

  return settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { platform: platforms[i].label, status: 0, count: 0, error: r.reason?.message || 'unknown error' }
  );
}

function checkAndSendAlert(alerts, text, fullLink, platformName) {
  if (alerts.length === 0) return;
  if (seenAds.has(fullLink)) return;
  const lowerText = text.toLowerCase();

  // استخراج الأرقام المعبرة عن السعر إن وجدت
  const priceMatch = text.match(/([\d,]+)\s*(ر\.ق|QAR|QR|ريال)/i);
  let adPrice = 0;
  if (priceMatch) {
    adPrice = parseInt(priceMatch[1].replace(/,/g, '')) || 0;
  }

  for (const alert of alerts) {
    if (lowerText.includes(alert.keyword)) {
      // مطابقة السعر: إذا كان الرادار لأي سعر (0) أو السعر ضمن الحد أو لم يتم التقاط رقم سعر صريح
      const isPriceMatch = (alert.maxPrice === 0) || (adPrice > 0 && adPrice <= alert.maxPrice) || (adPrice === 0);

      if (isPriceMatch) {
        seenAds.add(fullLink);

        const lang = alert.lang || 'ar';
        const cleanTitle = text.slice(0, 90);
        const msg = i18n[lang].alert_msg(platformName, alert.keyword, cleanTitle, adPrice, fullLink);

        bot.telegram.sendMessage(alert.chatId, msg, { parse_mode: 'HTML' }).catch(() => {});
        console.log(`🎯 [صيدة ناجحة] المنصة: ${platformName} | الطلب: (${alert.keyword}) للمستخدم: ${alert.chatId}`);
        break;
      }
    }
  }
}

// ------------------- بدء التشغيل والجدولة المستقلة -------------------

// 1. تشغيل محرك الفحص فوراً وبشكل دوري كل دقيقة (مستقل تماماً عن تيليجرام)
console.log('⚡ [SYSTEM] جاري بدء تشغيل محرك رادار قطر...');
setInterval(() => {
  console.log(`[HEARTBEAT] Scanning started at ${new Date().toISOString()}`);
  runRadarScan().catch(err => console.error('❌ خطأ في دورة الفحص:', err.message));
}, 60000);

// تشغيل أول فحص فوراً بعد 3 ثوانٍ من الإقلاع
setTimeout(() => {
  console.log(`[HEARTBEAT] Scanning started at ${new Date().toISOString()} (initial run)`);
  runRadarScan().catch(err => console.error('❌ خطأ في أول جولة:', err.message));
}, 3000);

// 2. تشغيل استماع التيليجرام (منفصل تماماً - لا يوقف الفحص أو الخادم إن تعطل)
bot.launch({
  dropPendingUpdates: true
}).then(() => {
  console.log('🤖 [TELEGRAM] البوت متصل ومستعد لاستقبال الأوامر!');
}).catch((err) => {
  console.error('⚠️ تحذير اتصال تليجرام (409 أو انقطاع شبكة على الأرجح):', err.message);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
