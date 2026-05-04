const express = require('express');
const twilio  = require('twilio');
const cron    = require('node-cron');

const app = express();
app.use(express.json());

const TWILIO_SID    = process.env.TWILIO_SID;
const TWILIO_TOKEN  = process.env.TWILIO_TOKEN;
const TWILIO_WA_NUM = process.env.TWILIO_WA_NUM || '+14155238886';
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY;
const PORTAL_URL    = process.env.PORTAL_URL || 'https://portal.bhabendeori.com';
const PORT          = process.env.PORT || 3000;

const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);

async function sb(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  return res.json().catch(() => null);
}

async function wa(to, message) {
  try {
    const num = to.startsWith('+') ? to : `+${to}`;
    await twilioClient.messages.create({
      from: `whatsapp:${TWILIO_WA_NUM}`,
      to:   `whatsapp:${num}`,
      body: message,
    });
    console.log(`Sent to ${num}`);
    return true;
  } catch (e) {
    console.error(`Failed to ${to}:`, e.message);
    return false;
  }
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'PE WhatsApp Server Online', time: new Date().toISOString() });
});

// Send access code to new client
app.post('/send-access-code', async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const data = await sb(`clients?id=eq.${clientId}&select=*`);
  const c = data?.[0];
  if (!c) return res.status(404).json({ error: 'Client not found' });
  if (!c.whatsapp) return res.status(400).json({ error: 'No WhatsApp number' });

  const msg = `Hi ${c.name},

Your Performance Engineering portal is ready.

Portal: ${PORTAL_URL}
Your Access Code: ${c.access_code}

Next steps:
1. Open the portal link
2. Enter your email and access code
3. Complete the Vital Index assessment (7-8 mins)
4. Fill in your measurements, food preferences and goals

I will review everything and build your personalised plan.

Any questions - reply here directly.

Bhaben
Performance Engineering`;

  const sent = await wa(c.whatsapp, msg);
  if (sent) await sb(`clients?id=eq.${clientId}`, 'PATCH', { access_code_sent_at: new Date().toISOString() });
  res.json({ success: sent });
});

// Notify client their plan is ready
app.post('/send-plan-ready', async (req, res) => {
  const { clientId } = req.body;
  const data = await sb(`clients?id=eq.${clientId}&select=*`);
  const c = data?.[0];
  if (!c?.whatsapp) return res.status(404).json({ error: 'Client not found' });

  const msg = `${c.name}, your plan is ready.

I have reviewed your Vital Index results, measurements, blood work, food preferences and goals.

Your personalised protocol is now live in your portal.

${PORTAL_URL}

Log in and go to the Today tab. Your first morning protocol starts tomorrow.

Reply here with any questions.

Bhaben
Performance Engineering`;

  const sent = await wa(c.whatsapp, msg);
  if (sent) {
    await sb(`clients?id=eq.${clientId}`, 'PATCH', {
      state: 'active',
      plan_released_at: new Date().toISOString(),
    });
  }
  res.json({ success: sent });
});

// Send custom reminder to one client
app.post('/send-reminder', async (req, res) => {
  const { clientId, message } = req.body;
  const data = await sb(`clients?id=eq.${clientId}&select=name,whatsapp`);
  const c = data?.[0];
  if (!c?.whatsapp) return res.status(404).json({ error: 'Client not found' });
  const sent = await wa(c.whatsapp, message);
  res.json({ success: sent });
});

// Morning protocol - 1am UTC daily (6:30am IST)
cron.schedule('0 1 * * *', async () => {
  const clients = await sb('clients?state=eq.active&select=id,name,whatsapp');
  if (!clients?.length) return;
  for (const c of clients) {
    if (!c.whatsapp) continue;
    await wa(c.whatsapp, `Good morning ${c.name},

Morning Protocol:
- 10 min outdoor sunlight now
- 500ml water before anything else
- No caffeine for 90 minutes
- Take your morning supplements

Log your HRV, weight and sleep in the portal:
${PORTAL_URL}

Bhaben`);
    await new Promise(r => setTimeout(r, 1000));
  }
});

// Wind-down - 3:30pm UTC (9pm IST)
cron.schedule('30 15 * * *', async () => {
  const clients = await sb('clients?state=eq.active&select=id,name,whatsapp');
  if (!clients?.length) return;
  for (const c of clients) {
    if (!c.whatsapp) continue;
    await wa(c.whatsapp, `Wind-down time ${c.name},

90 minutes to lights out:
- Dim all lights now
- No screens after 9:30pm
- Take Magnesium 400mg + Apigenin 50mg
- Room temperature 19C
- Lights out by 10:30pm

Bhaben`);
    await new Promise(r => setTimeout(r, 1000));
  }
});

// Weekly check-in - Sunday 3am UTC (8:30am IST)
cron.schedule('0 3 * * 0', async () => {
  const clients = await sb('clients?state=eq.active&select=id,name,whatsapp');
  if (!clients?.length) return;
  for (const c of clients) {
    if (!c.whatsapp) continue;
    await wa(c.whatsapp, `Weekly Check-In ${c.name},

Log this week in your portal:
- Weight (kg)
- Waist measurement (cm)
- Energy average this week 1-10
- One honest sentence about the week

${PORTAL_URL}

Bhaben`);
    await new Promise(r => setTimeout(r, 1000));
  }
});

app.listen(PORT, () => {
  console.log(`PE WhatsApp Server running on port ${PORT}`);
});
