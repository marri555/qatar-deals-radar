import fetch from 'node-fetch';

// ضع التوكن ورقم حسابك هنا
const BOT_TOKEN = '8858663547:AAFDhBpmaTUolGKMBfjZYhK8kcPoGhSWMm8';
const CHAT_ID = '8021254237';

async function sendAlert(message) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    })
  });

  const data = await response.json();
  if (data.ok) {
    console.log('✅ تم إرسال التنبيه إلى تليجرام بنجاح!');
  } else {
    console.error('❌ خطأ في الإرسال:', data.description);
  }
}

// نص التنبيه التجريبي
const sampleAlert = `
🚨 <b>صيدة جديدة من الرادار!</b>

🚗 <b>النوع:</b> لاندكروزر VXR
💰 <b>السعر:</b> 210,000 ريال (أقل من السوق)
📍 <b>المصدر:</b> فحص تجريبي

🔗 <a href="https://example.com">اضغط هنا لمعاينة الإعلان</a>
`;

sendAlert(sampleAlert);