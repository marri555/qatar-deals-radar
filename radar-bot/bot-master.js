import 'dotenv/config';
import http from 'http';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

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
    ask_keyword: '🔎 اكتب اسم السلعة التي تبحث عنها:\n(مثال: لاندكروزر، لوحة سيارة، رولكس، شقة، بلايستيشن)\n\n💡 تقدر تكتب أكثر من صيغة للكلمة نفسها مفصولة بفاصلة، عشان ما تفوتك إعلانات بصيغة مختلفة:\nمثال: كرسي مكتب, كراسي مكتب',
    ask_price: (kw) => `ممتاز! المطلوب: "${kw}".\n\n💰 اكتب الحد الأقصى للسعر بالريال (أو أرسل 0 لأي سعر):`,
    alert_created: (kw, price) => `✅ <b>تم تفعيل الرادار!</b>\n\n🎯 <b>السلعة:</b> ${kw}\n💰 <b>السعر الأقصى:</b> ${price === 0 ? 'أي سعر' : price.toLocaleString() + ' ر.ق'}\n\nسننبهك فور نزول أي إعلان مطابق! 🚀`,
    no_alerts: '⚠️ ليس لديك أي رادارات نشطة حالياً.',
    my_alerts_title: '📋 <b>راداراتك الشغالة حالياً:</b>\n\n',
    cleared: '🗑️ تم مسح جميع راداراتك بنجاح.',
    alerts_digest: (platform, items) => {
      let msg = `🚨 <b>${items.length} صفقة جديدة على ${platform}!</b>\n`;
      items.forEach((item, i) => {
        msg += `\n${i + 1}. 🎯 <b>${item.keyword}</b>\n📝 ${item.text}\n💰 ${item.price > 0 ? item.price.toLocaleString() + ' ر.ق' : 'راجع الإعلان'}\n🔗 <a href="${item.link}">فتح الإعلان</a>`;
      });
      return msg;
    },
    testscan_running: '🔍 جارٍ تشغيل فحص تشخيصي فوري...',
    testscan_report: (alertsCount, lines) => `🧪 <b>تقرير الفحص التشخيصي</b>\n\n📋 <b>عدد الرادارات النشطة:</b> ${alertsCount}\n\n${lines}`
  },
  en: {
    welcome: (name) => `Welcome <b>${name}</b> to <b>Qatar Smart Radar 🇶🇦</b>\n\nAutomated bot tracking the latest listings across all Qatari platforms in real time.\n\nChoose an option below 👇`,
    btn_add: '➕ Add New Radar',
    btn_list: '📋 My Active Radars',
    btn_clear: '🗑️ Clear All',
    btn_lang: '🌐 تغيير اللغة / Change Language',
    ask_keyword: '🔎 Enter the item/keyword you want to track:\n(e.g., Land Cruiser, Plate number, Rolex, Villa, iPhone)\n\n💡 You can enter multiple spellings/forms of the same word separated by a comma, so you don\'t miss listings phrased differently:\ne.g.: office chair, office chairs',
    ask_price: (kw) => `Great! Tracking: "${kw}".\n\n💰 Enter max price in QAR (or send 0 for any price):`,
    alert_created: (kw, price) => `✅ <b>Radar Activated!</b>\n\n🎯 <b>Item:</b> ${kw}\n💰 <b>Max Price:</b> ${price === 0 ? 'Any price' : price.toLocaleString() + ' QAR'}\n\nYou will be notified instantly when a match is found! 🚀`,
    no_alerts: '⚠️ You have no active radars currently.',
    my_alerts_title: '📋 <b>Your Active Radars:</b>\n\n',
    cleared: '🗑️ All your radars have been cleared.',
    alerts_digest: (platform, items) => {
      let msg = `🚨 <b>${items.length} new deal${items.length > 1 ? 's' : ''} on ${platform}!</b>\n`;
      items.forEach((item, i) => {
        msg += `\n${i + 1}. 🎯 <b>${item.keyword}</b>\n📝 ${item.text}\n💰 ${item.price > 0 ? item.price.toLocaleString() + ' QAR' : 'Check listing'}\n🔗 <a href="${item.link}">Open listing</a>`;
      });
      return msg;
    },
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
    msg += `${i + 1}. 🎯 ${getAlertKeywords(item).join(' / ')} | 💰 ${item.maxPrice > 0 ? item.maxPrice.toLocaleString() + ' QAR' : (lang === 'ar' ? 'أي سعر' : 'Any')}\n`;
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
    // لو ما فيه رادارات نشطة، نستخدم كلمة اختبار عامة عشان نتحقق من وصول
    // المنصات فعلياً بدل ما نرجع تقرير فاضي.
    const results = await runRadarScan(alerts.length === 0 ? 'قطر' : null);

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
    // يدعم أكثر من صيغة لنفس الكلمة مفصولة بفاصلة (مثلاً: "كرسي مكتب, كراسي مكتب")
    const keywords = text.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
    state.keywords = keywords;
    state.step = 'WAITING_PRICE';
    return ctx.reply(t.ask_price(keywords.join(' / ')));
  }

  if (state && state.step === 'WAITING_PRICE') {
    const rawPrice = parseInt(text.replace(/[^0-9]/g, '')) || 0;
    const allAlerts = getAlerts();

    const newAlert = {
      id: Date.now(),
      chatId: chatId,
      lang: lang,
      keywords: state.keywords,
      maxPrice: rawPrice,
      createdAt: new Date().toISOString()
    };

    allAlerts.push(newAlert);
    saveAlerts(allAlerts);
    delete userState[chatId];

    return ctx.replyWithHTML(t.alert_created(newAlert.keywords.join(' / '), rawPrice), getMenuKeyboard(lang));
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

// ------------------- متصفح حقيقي (Puppeteer) للمنصات المحمية بـ JS/Cloudflare -------------------
// نستخدم نسخة واحدة مشتركة من المتصفح (بدل فتح متصفح جديد كل دورة فحص) لتقليل
// استهلاك الذاكرة على Render. لو فشل الإطلاق (مثلاً مكتبات نظام ناقصة) نسجل الخطأ
// وما نوقف بقية النظام.
let browserInstance = null;
async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  browserInstance = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  browserInstance.on('disconnected', () => { browserInstance = null; });
  return browserInstance;
}

async function fetchRenderedHtml(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ar-QA,ar;q=0.9,en-US;q=0.8,en;q=0.7' });
    await page.setViewport({ width: 1366, height: 900 });
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    const status = response ? response.status() : 0;
    // فرصة إضافية بسيطة لأي محتوى يتحمّل بعد حدث التحميل الأساسي
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const html = await page.content();
    return { html, status };
  } finally {
    await page.close().catch(() => {});
  }
}

// ------------------- بحث حقيقي لكل منصة (لا نمسح الصفحة الرئيسية أبداً) -------------------
// كل صفحة رئيسية لهذه المواقع هي قائمة تصنيفات/تنقّل فقط، بدون إعلانات فعلية.
// اكتشفنا آلية البحث الحقيقية لكل منصة (رابط بحث SSR أو API داخلي) بالفحص المباشر.

function buildListingText(title, priceText) {
  const t = (title || '').replace(/\s+/g, ' ').trim();
  const p = (priceText || '').replace(/\s+/g, ' ').trim();
  return p && !t.includes(p) ? `${t} ${p}` : t;
}

// Qatar Living: API بحث نظيف مستقل تماماً عن الموقع الرئيسي (Azure)، بدون أي
// حماية Cloudflare وبدون حاجة لمتصفح حقيقي.
async function searchQatarLiving(keyword, alertsForKeyword) {
  const logTag = 'QatarLiving';
  const label = 'Qatar Living | قطر ليفنج';
  try {
    const res = await axios.post('https://ql-global-search-api-prod.azurewebsites.net/v1/search', {
      q: keyword,
      filters: {},
      sort: 'relevance',
      page: 1,
      page_size: 20,
      mode: 'hybrid',
      semantic: true,
      vertical: 'classifieds'
    }, {
      timeout: 10000,
      headers: {
        'content-type': 'application/json',
        'x-qls-platform': 'web',
        'x-qls-device': 'radarbot-device',
        'x-qls-session': 'radarbot-session',
        'accept-language': 'ar',
        'origin': 'https://www.qatarliving.com',
        'referer': 'https://www.qatarliving.com/'
      },
      validateStatus: () => true
    });

    const results = res.data?.results || [];
    const listings = results.map((r) => ({
      text: buildListingText(r.title, r.price ? `${r.price} ${r.price_type || 'QAR'}` : ''),
      link: `https://www.qatarliving.com/en/classifieds/items/${r.slug}`
    }));

    console.log(`[${logTag}] "${keyword}": Found ${listings.length} listings (HTTP ${res.status})`);
    // نرسل التنبيه فوراً بمجرد جهوزية نتائج هذه المنصة، بدون انتظار بقية
    // المنصات (خصوصاً مزاد قطر الأبطأ بسبب المتصفح الحقيقي).
    dispatchMatches(alertsForKeyword, listings, label);
    return { listings, status: res.status, error: null };
  } catch (err) {
    console.log(`⚠️ [${logTag}] فحص فشل:`, err.message);
    return { listings: [], status: err.response?.status || 0, error: err.message };
  }
}

// Qatar Sale: نفس الفكرة — API بحث نظيف (production-api.yousale.com، منصة
// yousale التي تُشغّل قطر سيل) منفصل عن الموقع المحمي بـ Cloudflare.
async function searchQatarSale(keyword, alertsForKeyword) {
  const logTag = 'QatarSale';
  const label = 'Qatar Sale | قطر سيل';
  try {
    const res = await axios.post('https://production-api.yousale.com/api/v2/Products', {
      url: `/ar/products?key=${encodeURIComponent(keyword)}`,
      includeFavs: false,
      pageSize: 36
    }, {
      timeout: 10000,
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'ar',
        'x-tenant-id': 'Qatarsale',
        'version': '6.11.0',
        'platform': '0',
        'referer': 'https://qatarsale.com/',
        'origin': 'https://qatarsale.com'
      },
      validateStatus: () => true
    });

    const list = res.data?.list || [];
    // رابط صفحة نتائج البحث نفسها (وليس رابط إعلان مباشر — لم نتحقق من نمط
    // رابط الإعلان الفردي الحقيقي)، يوصل المستخدم لنفس النتيجة على الموقع الحقيقي.
    const searchPageLink = `https://qatarsale.com/ar/products?key=${encodeURIComponent(keyword)}`;
    const listings = list.map((p) => ({
      text: buildListingText(p.title, p.startingPrice ? `${p.startingPrice.toLocaleString()} QAR` : ''),
      link: searchPageLink
    }));

    console.log(`[${logTag}] "${keyword}": Found ${listings.length} listings (HTTP ${res.status})`);
    dispatchMatches(alertsForKeyword, listings, label);
    return { listings, status: res.status, error: null };
  } catch (err) {
    console.log(`⚠️ [${logTag}] فحص فشل:`, err.message);
    return { listings: [], status: err.response?.status || 0, error: err.message };
  }
}

// OpenSooq: صفحة نتائج البحث فعلياً SSR (Server-Side Rendered) — لا حاجة لمتصفح
// حقيقي ولا حماية Cloudflare تمنعها، axios+cheerio كافيان.
async function searchOpenSooq(keyword, alertsForKeyword) {
  const logTag = 'OpenSooq';
  const label = 'OpenSooq | السوق المفتوح';
  try {
    const url = `https://qa.opensooq.com/ar/find?term=${encodeURIComponent(keyword)}&search=true`;
    const res = await httpClient.get(url);
    const $ = cheerio.load(res.data || '');

    const listings = [];
    $('.postListItemData').each((i, el) => {
      const $el = $(el);
      const href = $el.attr('href') || $el.find('a').first().attr('href') || '';
      const title = $el.find('h2').first().text();
      const priceText = $el.find('[class*="redColor"]').first().text();
      const text = buildListingText(title, priceText);
      if (!href || !text) return;
      listings.push({ text, link: href.startsWith('http') ? href : 'https://qa.opensooq.com' + href });
    });

    console.log(`[${logTag}] "${keyword}": Found ${listings.length} listings (HTTP ${res.status})`);
    dispatchMatches(alertsForKeyword, listings, label);
    return { listings, status: res.status, error: null };
  } catch (err) {
    console.log(`⚠️ [${logTag}] فحص فشل:`, err.message);
    return { listings: [], status: err.response?.status || 0, error: err.message };
  }
}

// Mzad Qatar: المنصة الوحيدة التي احتاجت متصفح حقيقي (Puppeteer + Stealth) —
// محمية بـ Cloudflare حقيقي على صفحاتها، ونتائج البحث نفسها SPA (Vue). هذه
// المنصة هي الأبطأ دائماً (متصفح حقيقي) — لهذا كل منصة ترسل تنبيهها فوراً
// بمجرد جهوزيتها بدل انتظار مزاد قطر.
async function searchMzadQatar(keyword, alertsForKeyword) {
  const logTag = 'Mzad';
  const label = 'Mzad Qatar | مزاد قطر';
  try {
    const url = `https://mzadqatar.com/search_tags?productId=0&searchStr=${encodeURIComponent(keyword)}`;
    const { html, status } = await fetchRenderedHtml(url);
    const $ = cheerio.load(html);

    const listings = [];
    $('.product').each((i, el) => {
      const $el = $(el);
      const href = $el.find('a[href]').first().attr('href') || '';
      const title = $el.find('h3').first().text();
      const priceText = $el.find('.price').first().text();
      const text = buildListingText(title, priceText);
      if (!href || !text) return;
      listings.push({ text, link: href.startsWith('http') ? href : 'https://mzadqatar.com' + href });
    });

    console.log(`[${logTag}] "${keyword}": Found ${listings.length} listings (HTTP ${status}, rendered)`);
    if (status === 403 && listings.length === 0) {
      console.log(`⚠️ [${logTag}] محجوب حتى مع متصفح حقيقي (Cloudflare متقدم) — يحتاج خدمة Anti-bot مدفوعة لتجاوزه.`);
    }
    dispatchMatches(alertsForKeyword, listings, label);
    return { listings, status, error: null };
  } catch (err) {
    console.log(`⚠️ [${logTag}] فحص فشل:`, err.message);
    return { listings: [], status: err.response?.status || 0, error: err.message };
  }
}

const PLATFORM_SEARCHERS = [
  { label: 'Mzad Qatar | مزاد قطر', search: searchMzadQatar },
  { label: 'Qatar Living | قطر ليفنج', search: searchQatarLiving },
  { label: 'OpenSooq | السوق المفتوح', search: searchOpenSooq },
  { label: 'Qatar Sale | قطر سيل', search: searchQatarSale }
  // Sooum (sooum.com) مُعطّلة عمداً: الدومين لا يستجيب فعلياً ويشير إلى عنوان IP
  // غير متعلق بقطر إطلاقاً، وليست مجرد حماية بوتات. أعد تفعيلها لو توفر رابط صحيح.
];

// حماية بسيطة من تداخل دورتين فحص فوق بعض (المتصفح الحقيقي أبطأ من axios وقد
// تطول دورة الفحص أكثر من دقيقة الـ heartbeat).
let scanInProgress = false;

async function runRadarScan(forceKeyword = null) {
  if (scanInProgress) {
    console.log('⏭️ [Radar] تخطي هذه الدورة — دورة فحص سابقة لسا شغالة.');
    return [];
  }
  scanInProgress = true;

  try {
    const alerts = getAlerts();
    console.log(`🔍 [Radar] بدء جولة فحص لـ (${alerts.length}) رادار نشط...`);

    if (alerts.length === 0 && !forceKeyword) {
      console.log('ℹ️ [Radar] لا توجد رادارات نشطة حالياً — تخطي البحث في المنصات.');
      return [];
    }

    // نبحث لكل صيغة/كلمة فريدة مرة واحدة فقط (حتى لو عدة رادارات تشترك بنفس
    // الصيغة، أو رادار واحد له أكثر من صيغة)، ونطابق النتائج مع كل رادار يحمل
    // هذه الصيغة ضمن صيغه. لو ما فيه رادارات حقيقية (مثلاً استدعاء تشخيصي من
    // /testscan) نستخدم forceKeyword فقط للتحقق من وصول المنصات، بدون إرسال
    // أي تنبيه فعلي لأحد.
    const allKeywords = alerts.flatMap((a) => getAlertKeywords(a));
    const uniqueKeywords = alerts.length > 0 ? [...new Set(allKeywords)] : [forceKeyword];
    const aggregated = new Map(); // platformLabel -> { status, count, error }

    for (const keyword of uniqueKeywords) {
      const alertsForKeyword = alerts.filter((a) => getAlertKeywords(a).includes(keyword));

      // كل دالة بحث ترسل تنبيهاتها بنفسها فور جهوزية نتائجها (داخل الدالة
      // نفسها) — هنا فقط نجمع الأرقام للتشخيص/الـ testscan، وما ننتظر أبطأ
      // منصة (مزاد قطر) قبل ما نطابق نتائج البقية.
      const settled = await Promise.allSettled(
        PLATFORM_SEARCHERS.map((p) => p.search(keyword, alertsForKeyword))
      );

      settled.forEach((r, i) => {
        const label = PLATFORM_SEARCHERS[i].label;
        const prev = aggregated.get(label) || { status: 0, count: 0, error: null };

        if (r.status === 'fulfilled') {
          const { listings, status, error } = r.value;
          aggregated.set(label, { status, count: prev.count + listings.length, error: error || prev.error });
        } else {
          aggregated.set(label, { status: prev.status, count: prev.count, error: r.reason?.message || 'unknown error' });
        }
      });
    }

    return [...aggregated.entries()].map(([platform, v]) => ({ platform, ...v }));
  } finally {
    scanInProgress = false;
  }
}

// مطابقة الكلمة المفتاحية كوحدة كاملة، مو كجزء من كلمة أطول. مشكلة حقيقية
// واجهناها: "لوحة ثلاثي" (لوحة سيارة) طابقت خطأً "لوحة ثلاثية الأبعاد" (لوحة
// جدارية ديكور) لأن العربية ما تفصل الكلمة عن لاحقتها بمسافة — "ثلاثي" فعلياً
// جزء حرفي من "ثلاثية". نمنع ذلك برفض أي تطابق ملتصق بحرف عربي آخر قبله أو بعده.
function buildKeywordMatcher(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\u0600-\\u06FF])${escaped}(?![\\u0600-\\u06FF])`, 'i');
}

// رادار واحد ممكن يحمل أكثر من صيغة لنفس الكلمة (مثلاً "كرسي مكتب" و"كراسي
// مكتب") — يدعم التوافق مع الرادارات القديمة اللي مخزّنة بحقل keyword مفرد.
function getAlertKeywords(alert) {
  if (Array.isArray(alert.keywords) && alert.keywords.length) return alert.keywords;
  if (alert.keyword) return [alert.keyword];
  return [];
}

// يرجع كل الرادارات المطابقة لإعلان واحد (مو أول واحد بس) — عشان لو أكثر من
// مستخدم مشترك بنفس الكلمة، الكل يوصله تنبيهه، مو أول واحد بالقائمة فقط.
// كل رادار يُطابَق إذا كانت أي صيغة من صيغه موجودة بالنص.
function findMatchingAlerts(alerts, text) {
  const lowerText = text.toLowerCase();

  // استخراج الأرقام المعبرة عن السعر إن وجدت
  const priceMatch = text.match(/([\d,]+)\s*(ر\.ق|QAR|QR|ريال)/i);
  let adPrice = 0;
  if (priceMatch) {
    adPrice = parseInt(priceMatch[1].replace(/,/g, '')) || 0;
  }

  const matches = [];
  for (const alert of alerts) {
    const matchedKeyword = getAlertKeywords(alert).find((kw) => buildKeywordMatcher(kw).test(lowerText));
    if (!matchedKeyword) continue;
    // مطابقة السعر: إذا كان الرادار لأي سعر (0) أو السعر ضمن الحد أو لم يتم التقاط رقم سعر صريح
    const isPriceMatch = (alert.maxPrice === 0) || (adPrice > 0 && adPrice <= alert.maxPrice) || (adPrice === 0);
    if (isPriceMatch) matches.push({ alert, adPrice, matchedKeyword });
  }
  return matches;
}

const MAX_ITEMS_PER_DIGEST = 20; // حماية من تجاوز حد رسائل تيليجرام لو تراكمت مطابقات كثيرة

// يفحص كل إعلانات منصة واحدة دفعة وحدة، ويرسل رسالة واحدة مجمّعة لكل مستخدم
// تحتوي كل الصفقات الجديدة اللي طابقت راداراته على هذه المنصة بالذات، بدل
// إرسال رسالة منفصلة لكل إعلان.
function dispatchMatches(alerts, listings, platformName) {
  if (alerts.length === 0) return;

  const itemsByChat = new Map(); // chatId -> { lang, items: [] }

  for (const { text, link } of listings) {
    if (seenAds.has(link)) continue;
    const matches = findMatchingAlerts(alerts, text);
    if (matches.length === 0) continue;

    seenAds.add(link);
    const cleanTitle = text.slice(0, 90);

    for (const { alert, adPrice, matchedKeyword } of matches) {
      const lang = alert.lang || 'ar';
      if (!itemsByChat.has(alert.chatId)) itemsByChat.set(alert.chatId, { lang, items: [] });
      itemsByChat.get(alert.chatId).items.push({ keyword: matchedKeyword, text: cleanTitle, price: adPrice, link });
    }
  }

  for (const [chatId, { lang, items }] of itemsByChat) {
    const shown = items.slice(0, MAX_ITEMS_PER_DIGEST);
    const msg = i18n[lang].alerts_digest(platformName, shown);
    bot.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {});
    console.log(`🎯 [صفقات] ${platformName}: رسالة مجمّعة (${items.length} مطابقة) للمستخدم ${chatId}`);
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
// نعيد محاولة الاتصال تلقائياً لو فشلت المحاولة الأولى (409 عابر عند تداخل
// نشرتين، أو انقطاع شبكة لحظي) — بدون إعادة محاولة، أي فشل بالإقلاع كان يعني
// إن البوت ما يرد على أي رسالة تليجرام إلى الأبد، رغم إن محرك الفحص يشتغل عادي.
function launchBotWithRetry(retryDelayMs = 15000) {
  bot.launch({
    dropPendingUpdates: true
  }).then(() => {
    console.log('🤖 [TELEGRAM] البوت متصل ومستعد لاستقبال الأوامر!');
  }).catch((err) => {
    console.error('⚠️ تحذير اتصال تليجرام (409 أو انقطاع شبكة على الأرجح):', err.message);
    console.log(`🔁 [TELEGRAM] إعادة محاولة الاتصال خلال ${retryDelayMs / 1000} ثانية...`);
    setTimeout(() => launchBotWithRetry(retryDelayMs), retryDelayMs);
  });
}
launchBotWithRetry();

async function shutdown(signal) {
  bot.stop(signal);
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
  }
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
