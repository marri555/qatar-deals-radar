import axios from 'axios';
import * as cheerio from 'cheerio';

const BOT_TOKEN = '8858663547:AAFDhBpmaTUolGKMBfjZYhK8kcPoGhSWMm8';
const CHAT_ID = '8021254237';

// ذاكرة مؤقتة لمنع تكرار الإعلانات التي تم إرسالها مسبقاً
const sentAlerts = new Set();

async function sendTelegramAlert(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML'
    });
    console.log('🚀 تم إرسال التنبيه إلى تليجرام!');
  } catch (error) {
    console.error('خطأ في إرسال التنبيه:', error.message);
  }
}

// خوارزمية تمييز اللوحات (ثنائية، ثلاثية، رباعية، أو أرقام مكررة)
function analyzePlate(plateStr) {
  const num = plateStr.trim();
  const len = num.length;
  
  // تجاهل الأرقام غير المنطقية للوحات
  if (len < 2 || len > 6) return null;

  // 1. لوحات نادرة وفائقة التميز (2 إلى 4 أرقام)
  if (len <= 4) {
    return { type: 'لوحة ملكية قصيرة (نادرة)', score: 'VIP' };
  }

  // 2. لوحات 5 أو 6 أرقام تتكون من رقمين مختلفين فقط (مثل: 557755 أو 606606)
  const uniqueDigits = new Set(num.split(''));
  if (uniqueDigits.size <= 2) {
    return { type: 'لوحة ثنائية التركيب (متناسقة جداً)', score: 'مميز' };
  }

  // 3. أرقام متسلسلة أو ثلاثية متكررة (مثل: 444 أو 555)
  if (/(\d)\1\1/.test(num)) {
    return { type: 'تحتوي على ثلاثي مكرر', score: 'متناسق' };
  }

  return null;
}

async function huntPlates() {
  console.log('🔍 الرادار يبحث الآن بفلترة ذكية ومخصصة للوحات فقط...');
  try {
    const targetUrl = 'https://mzadqatar.com';
    const { data: html } = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'ar,en;q=0.9'
      },
      timeout: 15000
    });

    const $ = cheerio.load(html);
    let platesChecked = 0;

    $('a').each(async (i, el) => {
      const link = $(el).attr('href') || '';
      const text = $(el).text().replace(/\s+/g, ' ').trim();

      // شرط حاسم: فحص إعلانات لوحات السيارات فقط وتجاهل الساعات والموديلات
      if (!text.includes('لوحة سيارة') && !text.includes('لوحة مميزة')) {
        return;
      }

      // استخراج رقم اللوحة بدقة بعد كلمة "لوحة سيارة"
      const match = text.match(/لوحة سيارة\s*(\d+)/);
      if (!match) return;

      const plateNumber = match[1];
      const fullLink = link.startsWith('http') ? link : 'https://mzadqatar.com' + link;

      // التأكد من عدم إرسال نفس الإعلان مرتين
      if (sentAlerts.has(plateNumber)) return;

      // فحص مدى تميز اللوحة
      const plateEvaluation = analyzePlate(plateNumber);

      if (plateEvaluation) {
        sentAlerts.add(plateNumber);
        platesChecked++;

        // استخراج السعر إن وُجد في النص
        const priceMatch = text.match(/([\d,]+)\s*ر\.ق/);
        const price = priceMatch ? priceMatch[0] : 'على السوم / راجع الإعلان';

        const alertMessage = `
🚨 <b>صيدة لوحة مرصودة!</b>

🔢 <b>الرقم:</b> <code>${plateNumber}</code>
⭐ <b>التصنيف:</b> ${plateEvaluation.type}
💰 <b>السعر:</b> ${price}

🔗 <a href="${fullLink}">اضغط هنا للانتقال للبائع فوراً</a>
        `;

        await sendTelegramAlert(alertMessage);
      }
    });

    console.log(`✅ اكتمل الفحص. إجمالي اللوحات المميزة المرسلة: ${platesChecked}`);

  } catch (error) {
    console.error('خطأ أثناء الفحص:', error.message);
  }
}

// تشغيل الفحص
huntPlates();