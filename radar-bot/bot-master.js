import http from 'http';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

// ------------------- خادم الويب للحفاظ على نشاط الخدمة على Render -------------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🤖 رادار صفقات قطر يعمل بنجاح في السحابة!');
}).listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ------------------- إعداد البوت والملفات -------------------
const BOT_TOKEN = process.env.BOT_TOKEN || '8858663547:AAFprfXgaKdt8jftll79aHK0pyNkgO6SKt8';
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
    alert_msg: (platform, kw, text, price, link) => `🚨 <b>صيدة جديدة تطابق رادارك!</b>\n\n📍 <b>المنصة:</b> ${platform}\n🎯 <b>طلبك:</b> ${kw}\n📝 <b>الإعلان:</b> ${text}\n💰 <b>السعر:</b> ${price > 0 ? price.toLocaleString() + ' ر.ق' : 'راجع الإعلان'}\n\n🔗 <a href="${link}">اضغط هنا لفتح الإعلان فوراً</a>`
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
    alert_msg: (platform, kw, text, price, link) => `🚨 <b>New Deal Found!</b>\n\n📍 <b>Platform:</b> ${platform}\n🎯 <b>Keyword:</b> ${kw}\n📝 <b>Title:</b> ${text}\n💰 <b>Price:</b> ${price > 0 ? price.toLocaleString() + ' QAR' : 'Check Listing'}\n\n🔗 <a href="${link}">Click here to view deal</a>`
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

// ------------------- محرك الفحص والمسح المطور -------------------

async function runRadarScan() {
  const alerts = getAlerts();
  if (alerts.length === 0) return;

  console.log(`🔍 [Radar] بدء جولة فحص المنصات لـ (${alerts.length}) رادار نشط...`);

  await Promise.allSettled([
    scanMzadQatar(alerts),
    scanQatarLiving(alerts),
    scanOpenSooq(alerts),
    scanQatarSale(alerts),
    scanSooum(alerts)
  ]);
}

async function scanMzadQatar(alerts) {
  try {
    const { data: html } = await axios.get('https://mzadqatar.com/ar', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 12000
    });
    const $ = cheerio.load(html);

    $('a').each((i, el) => {
      const link = $(el).attr('href') || '';
      const containerText = $(el).closest('div, li, article').text().replace(/\s+/g, ' ').trim();
      const text = containerText.length > 10 ? containerText : $(el).text().replace(/\s+/g, ' ').trim();

      if (!link || text.length < 5) return;
      const fullLink = link.startsWith('http') ? link : 'https://mzadqatar.com' + link;
      checkAndSendAlert(alerts, text, fullLink, 'Mzad Qatar | مزاد قطر');
    });
  } catch (err) {
    console.log('⚠️ فحص مزاد قطر:', err.message);
  }
}

async function scanQatarLiving(alerts) {
  try {
    const { data: html } = await axios.get('https://www.qatarliving.com/classifieds', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 12000
    });
    const $ = cheerio.load(html);

    $('a').each((i, el) => {
      const link = $(el).attr('href') || '';
      const containerText = $(el).closest('div, article').text().replace(/\s+/g, ' ').trim();
      const text = containerText.length > 10 ? containerText : $(el).text().replace(/\s+/g, ' ').trim();

      if (!link || text.length < 5) return;
      const fullLink = link.startsWith('http') ? link : 'https://www.qatarliving.com' + link;
      checkAndSendAlert(alerts, text, fullLink, 'Qatar Living | قطر ليفنج');
    });
  } catch (err) {
    console.log('⚠️ فحص قطر ليفنج:', err.message);
  }
}

async function scanOpenSooq(alerts) {
  try {
    const { data: html } = await axios.get('https://qa.opensooq.com/ar', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 12000
    });
    const $ = cheerio.load(html);

    $('a').each((i, el) => {
      const link = $(el).attr('href') || '';
      const containerText = $(el).closest('div, li').text().replace(/\s+/g, ' ').trim();
      const text = containerText.length > 10 ? containerText : $(el).text().replace(/\s+/g, ' ').trim();

      if (!link || text.length < 5) return;
      const fullLink = link.startsWith('http') ? link : 'https://qa.opensooq.com' + link;
      checkAndSendAlert(alerts, text, fullLink, 'OpenSooq | السوق المفتوح');
    });
  } catch (err) {
    console.log('⚠️ فحص السوق المفتوح:', err.message);
  }
}

async function scanQatarSale(alerts) {
  try {
    const { data: html } = await axios.get('https://qatarsale.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 12000
    });
    const $ = cheerio.load(html);

    $('a').each((i, el) => {
      const link = $(el).attr('href') || '';
      const containerText = $(el).closest('div, tr, li').text().replace(/\s+/g, ' ').trim();
      const text = containerText.length > 10 ? containerText : $(el).text().replace(/\s+/g, ' ').trim();

      if (!link || text.length < 5) return;
      const fullLink = link.startsWith('http') ? link : 'https://qatarsale.com' + link;
      checkAndSendAlert(alerts, text, fullLink, 'Qatar Sale | قطر سيل');
    });
  } catch (err) {
    console.log('⚠️ فحص قطر سيل:', err.message);
  }
}

async function scanSooum(alerts) {
  try {
    const { data: html } = await axios.get('https://sooum.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 12000
    });
    const $ = cheerio.load(html);

    $('a').each((i, el) => {
      const link = $(el).attr('href') || '';
      const containerText = $(el).closest('div, article').text().replace(/\s+/g, ' ').trim();
      const text = containerText.length > 10 ? containerText : $(el).text().replace(/\s+/g, ' ').trim();

      if (!link || text.length < 5) return;
      const fullLink = link.startsWith('http') ? link : 'https://sooum.com' + link;
      checkAndSendAlert(alerts, text, fullLink, 'Sooum | منصة سوم');
    });
  } catch (err) {
    console.log('⚠️ فحص منصة سوم:', err.message);
  }
}

function checkAndSendAlert(alerts, text, fullLink, platformName) {
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

// 1. تشغيل محرك الفحص فوراً وبشكل دوري كل دقيقة (مستقل تماماً)
console.log('⚡ [SYSTEM] جاري بدء تشغيل محرك رادار قطر...');
setInterval(() => {
  console.log('⏰ [Heartbeat] دقيقة مرت - جاري فحص المنصات الآن...');
  runRadarScan().catch(err => console.error('❌ خطأ في دورة الفحص:', err.message));
}, 60000);

// تشغيل أول فحص فوراً بعد 3 ثوانٍ من الإقلاع
setTimeout(() => {
  console.log('🚀 [RADAR] انطلاق أول جولة فحص...');
  runRadarScan().catch(err => console.error('❌ خطأ في أول جولة:', err.message));
}, 3000);

// 2. تشغيل استماع التيليجرام
bot.launch({
  dropPendingUpdates: true
}).then(() => {
  console.log('🤖 [TELEGRAM] البوت متصل ومستعد لاستقبال الأوامر!');
}).catch((err) => {
  console.error('⚠️ تحذير اتصال تليجرام:', err.message);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));