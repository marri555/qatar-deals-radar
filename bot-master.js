import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

const BOT_TOKEN = '8858663547:AAFDhBpmaTUolGKMBfjZYhK8kcPoGhSWMm8';
const bot = new Telegraf(BOT_TOKEN);

const DB_FILE = './user_alerts.json';
const seenAds = new Set();
const userState = {};

// دوال قاعدة البيانات
function getAlerts() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveAlerts(alerts) {
  fs.writeFileSync(DB_FILE, JSON.stringify(alerts, null, 2));
}

// لوحة الأزرار الرئيسية التفاعلية
const mainKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('➕ تشغيل رادار جديد', 'ACTION_ADD')],
  [Markup.button.callback('📋 راداراتي النشطة', 'ACTION_LIST'), Markup.button.callback('🗑️ مسح الرادارات', 'ACTION_CLEAR')],
  [Markup.button.callback('ℹ️ كيف يعمل الرادار؟', 'ACTION_HELP')]
]);

// نص الرسالة الترحيبية الشاملة
function getWelcomeMessage(name) {
  return `
مرحباً بك يا <b>${name}</b> في <b>رادار قطر الذكي 🇶🇦</b>

نظام آلي متكامل يرصد لك أحدث الإعلانات في كل المنصات القطرية (سيارات، لوحات، ساعات، عقارات، أجهزة، وغيرها) ويرسلها لك فوراً بمجرد نشرها.

<b>كيف تستفيد من البوت؟</b>
1️⃣ اضغط على زر <b>[➕ تشغيل رادار جديد]</b>.
2️⃣ اكتب اسم السلعة التي تريد اقتناصها.
3️⃣ حدد السعر الأقصى الذي يناسبك.
4️⃣ دع البوت يراقب السوق نيابة عنك 24/7 دون أي تدخل منك!

اختر ما تريد من الأزرار التفاعلية أدناه 👇
  `;
}

// دالة عرض طلبات المشترك
function showUserAlerts(ctx, chatId) {
  const myAlerts = getAlerts().filter(a => a.chatId === chatId);

  if (myAlerts.length === 0) {
    const emptyMsg = '⚠️ ليس لديك أي رادارات نشطة حالياً.\nاضغط على الزر أدناه لبدء الرصد فوراً:';
    const btn = Markup.inlineKeyboard([[Markup.button.callback('➕ تشغيل رادار الآن', 'ACTION_ADD')]]);
    return ctx.replyWithHTML(emptyMsg, btn);
  }

  let msg = '📋 <b>قائمة راداراتك الشغالة حالياً:</b>\n\n';
  myAlerts.forEach((item, i) => {
    msg += `${i + 1}. 🎯 <b>السلعة:</b> ${item.keyword}\n   💰 <b>الحد الأقصى:</b> ${item.maxPrice > 0 ? item.maxPrice.toLocaleString() + ' ر.ق' : 'أي سعر'}\n\n`;
  });

  const actionBtns = Markup.inlineKeyboard([
    [Markup.button.callback('➕ إضافة رادار آخر', 'ACTION_ADD')],
    [Markup.button.callback('🗑️ مسح الكل', 'ACTION_CLEAR')]
  ]);

  ctx.replyWithHTML(msg, actionBtns);
}

// ------------------- التعامل مع الأزرار (Actions) -------------------

bot.action('ACTION_ADD', (ctx) => {
  ctx.answerCbQuery();
  userState[ctx.chat.id] = { step: 'WAITING_KEYWORD' };
  ctx.reply('🔎 اكتب الآن اسم السلعة التي تبحث عنها:\n(مثال: لاندكروزر، لوحة سيارة، رولكس، شقة في لوسيل، بلايستيشن 5)');
});

bot.action('ACTION_LIST', (ctx) => {
  ctx.answerCbQuery();
  showUserAlerts(ctx, ctx.chat.id);
});

bot.action('ACTION_CLEAR', (ctx) => {
  ctx.answerCbQuery();
  const remaining = getAlerts().filter(a => a.chatId !== ctx.chat.id);
  saveAlerts(remaining);
  ctx.reply('🗑️ تم مسح جميع راداراتك بنجاح.', mainKeyboard);
});

bot.action('ACTION_HELP', (ctx) => {
  ctx.answerCbQuery();
  const helpText = `
💡 <b>طريقة عمل النظام:</b>

• المحرك يفحص منصات البيع دورياً وبسرعة فائقة.
• بمجرد مطابقة أي إعلان جديد لكلمتك المفتاحية وسقفك السعري، يصلك تنبيه يتضمن رابط الإعلان المباشر للتواصل السريع مع البائع.
• يمكنك إضافة أكثر من سلعة في نفس الوقت لمراقبتها جميعاً.
  `;
  ctx.replyWithHTML(helpText, mainKeyboard);
});

// ------------------- استقبال أي رسالة أو كلمة -------------------

bot.on('text', (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text.trim();
  const state = userState[chatId];
  const userName = ctx.from.first_name || 'عزيزي المشترك';

  // إذا كان المستخدم في مسار إدخال بيانات رادار
  if (state && state.step === 'WAITING_KEYWORD') {
    state.keyword = text;
    state.step = 'WAITING_PRICE';
    return ctx.reply(`ممتاز! سنبحث عن: "${text}".\n\n💰 اكتب الحد الأقصى للسعر بالريال (أو أرسل 0 إذا كان السعر لا يهمك):`);
  }

  if (state && state.step === 'WAITING_PRICE') {
    const rawPrice = parseInt(text.replace(/[^0-9]/g, '')) || 0;
    const allAlerts = getAlerts();

    const newAlert = {
      id: Date.now(),
      chatId: chatId,
      keyword: state.keyword.toLowerCase(),
      maxPrice: rawPrice,
      createdAt: new Date().toISOString()
    };

    allAlerts.push(newAlert);
    saveAlerts(allAlerts);
    delete userState[chatId];

    const successKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('➕ إضافة سلعة ثانية', 'ACTION_ADD')],
      [Markup.button.callback('📋 استعراض طلباتي', 'ACTION_LIST')]
    ]);

    return ctx.replyWithHTML(`
✅ <b>تم ضبط الرادار بنجاح!</b>

🎯 <b>السلعة:</b> ${newAlert.keyword}
💰 <b>السعر الأقصى:</b> ${rawPrice === 0 ? 'بدون حد (أي سعر)' : rawPrice.toLocaleString() + ' ر.ق'}

نحن نراقب السوق الآن وسنرسل لك إشعاراً فورياً عند رصد أي صيدة! 🚀
    `, successKeyboard);
  }

  // إذا أرسل سلام أو أي رسالة عادية أو كلمة تشغيل/فتح/start
  ctx.replyWithHTML(getWelcomeMessage(userName), mainKeyboard);
});

// ------------------- محرك الرادار الآلي -------------------

async function runRadarScan() {
  const alerts = getAlerts();
  if (alerts.length === 0) return;

  try {
    const { data: html } = await axios.get('https://mzadqatar.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(html);

    $('a').each((i, el) => {
      const link = $(el).attr('href') || '';
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      const lowerText = text.toLowerCase();

      if (!link || text.length < 5) return;

      const fullLink = link.startsWith('http') ? link : 'https://mzadqatar.com' + link;
      if (seenAds.has(fullLink)) return;

      const priceMatch = text.match(/([\d,]+)\s*ر\.ق/);
      let adPrice = 0;
      if (priceMatch) {
        adPrice = parseInt(priceMatch[1].replace(/,/g, '')) || 0;
      }

      for (const alert of alerts) {
        if (lowerText.includes(alert.keyword)) {
          if (alert.maxPrice === 0 || (adPrice > 0 && adPrice <= alert.maxPrice)) {
            seenAds.add(fullLink);

            const alertMsg = `
🚨 <b>صيدة جديدة تطابق رادارك!</b>

🎯 <b>السلعة المرصودة:</b> ${alert.keyword}
📝 <b>الإعلان:</b> ${text.slice(0, 85)}
💰 <b>السعر:</b> ${adPrice > 0 ? adPrice.toLocaleString() + ' ر.ق' : 'غير محدد / راجع الإعلان'}

🔗 <a href="${fullLink}">اضغط هنا لفتح الإعلان والتواصل مع البائع فوراً</a>
            `;

            bot.telegram.sendMessage(alert.chatId, alertMsg, { parse_mode: 'HTML' });
            console.log(`🎯 تم إرسال صيدة تطابق (${alert.keyword}) إلى المشترك!`);
            break;
          }
        }
      }
    });

  } catch (err) {
    console.error('تنبيه فحص الرادار:', err.message);
  }
}

// ------------------- تشغيل البوت -------------------

bot.launch().then(() => {
  console.log('🤖 البوت التفاعلي بالأزرار يعمل الآن بنجاح...');
  setInterval(runRadarScan, 60000);
  runRadarScan();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));