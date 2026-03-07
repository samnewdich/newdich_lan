const { exec } = require('child_process');
const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ────────────────────────────────────────────────
// CONFIG – ADJUST THESE
// ────────────────────────────────────────────────
const DOWNSTREAM_IFACE = 'wlan1';      // USB WiFi adapter connected to AX55 (AP mode)
const UPSTREAM_IFACE   = 'eth0';       // Interface to Starlink (Ethernet or second WiFi)
const GATEWAY_IP       = '192.168.100.1';
const PORT             = 80;
const DB_CONFIG = {
  host: 'localhost',
  user: 'root',
  password: '',                    // ← set your MySQL root password
  database: 'hotspot'
};
// Paystack secret key (test or live)
const PAYSTACK_SECRET = 'sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
// Your public domain or ngrok URL for Paystack webhook
const WEBHOOK_URL = 'https://your-domain.com/paystack-webhook';

// ────────────────────────────────────────────────
// Database connection pool
// ────────────────────────────────────────────────
const pool = mysql.createPool(DB_CONFIG);

// ────────────────────────────────────────────────
// Helper: Get MAC from IP using arp
// ────────────────────────────────────────────────
async function getMacFromIp(ip) {
  return new Promise((resolve) => {
    exec(`arp -i ${DOWNSTREAM_IFACE} -a | grep ${ip}`, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const match = stdout.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/);
      resolve(match ? match[0].toUpperCase() : null);
    });
  });
}

// ────────────────────────────────────────────────
// Block / Unblock helpers
// ────────────────────────────────────────────────
function blockDevice(ip) {
  exec(`iptables -A FORWARD -s ${ip} -j DROP`);
  exec(`iptables -t nat -A PREROUTING -s ${ip} -p tcp --dport 80  -j DNAT --to ${GATEWAY_IP}:${PORT}`);
  exec(`iptables -t nat -A PREROUTING -s ${ip} -p tcp --dport 443 -j DNAT --to ${GATEWAY_IP}:${PORT}`);
  console.log(`Blocked ${ip}`);
}

function unblockDevice(ip) {
  exec(`iptables -D FORWARD -s ${ip} -j DROP || true`);
  exec(`iptables -t nat -D PREROUTING -s ${ip} -p tcp --dport 80  -j DNAT --to ${GATEWAY_IP}:${PORT} || true`);
  exec(`iptables -t nat -D PREROUTING -s ${ip} -p tcp --dport 443 -j DNAT --to ${GATEWAY_IP}:${PORT} || true`);
  console.log(`Unblocked ${ip}`);
}

// ────────────────────────────────────────────────
// Background scanner – detect new devices every 8 seconds
// ────────────────────────────────────────────────
setInterval(async () => {
  exec(`arp -i ${DOWNSTREAM_IFACE} -a`, async (err, stdout) => {
    if (err) return;
    const lines = stdout.split('\n');
    for (const line of lines) {
      const match = line.match(/\(([\d.]+)\)\sat\s([0-9A-Fa-f:]+)\s/);
      if (!match) continue;
      const [_, ip, mac] = match;
      if (ip === GATEWAY_IP) continue;

      const conn = await pool.getConnection();
      try {
        const [rows] = await conn.execute(
          'SELECT * FROM paid_devices WHERE mac = ? AND active = 1 AND expires_at > NOW()',
          [mac.toUpperCase()]
        );

        if (rows.length === 0) {
          blockDevice(ip);
        } else {
          unblockDevice(ip);
        }
      } catch (e) {
        console.error(e);
      } finally {
        conn.release();
      }
    }
  });
}, 8000);

// ────────────────────────────────────────────────
// Payment portal (Express)
// ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Subscribe to Internet</title></head>
    <body style="font-family:sans-serif;text-align:center;padding:50px;">
      <h1>Welcome – Internet Access Requires Subscription</h1>
      <form action="/subscribe" method="POST">
        <input type="email" name="email" placeholder="Your email" required style="padding:12px;width:300px;margin:10px;"><br>
        <select name="plan" required style="padding:12px;width:300px;margin:10px;">
          <option value="">Choose plan</option>
          <option value="daily">Daily – ₦500</option>
          <option value="weekly">Weekly – ₦2,500</option>
          <option value="monthly">Monthly – ₦8,000</option>
        </select><br>
        <button type="submit" style="padding:15px 40px;background:#28a745;color:white;border:none;font-size:18px;cursor:pointer;">
          Pay with Paystack
        </button>
      </form>
    </body>
    </html>
  `);
});

app.post('/subscribe', async (req, res) => {
  const { email, plan } = req.body;
  const ip = req.connection.remoteAddress.replace('::ffff:', '');
  const mac = await getMacFromIp(ip);

  if (!mac) return res.send('Could not detect device MAC. Try reconnecting.');

  // Calculate price & expiry (example)
  let amount, durationDays;
  if (plan === 'daily')    { amount = 50000; durationDays = 1;   } // kobo
  else if (plan === 'weekly')  { amount = 250000; durationDays = 7;   }
  else if (plan === 'monthly') { amount = 800000; durationDays = 30;  }
  else return res.send('Invalid plan');

  try {
    // Initialize Paystack transaction (replace with real secret)
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount,
        callback_url: 'https://your-domain.com/payment-success', // optional
        metadata: { mac, plan, ip }
      },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );

    const { authorization_url } = response.data.data;
    res.redirect(authorization_url);
  } catch (err) {
    console.error(err);
    res.send('Payment initialization failed. Please try again.');
  }
});

// Paystack webhook (must be public URL – use ngrok for testing)
app.post('/paystack-webhook', express.raw({type: 'application/json'}), async (req, res) => {
  // Verify signature (production code should check header)
  const event = req.body;

  if (event.event === 'charge.success') {
    const { mac, plan, ip } = event.data.metadata;
    const durationDays = { daily:1, weekly:7, monthly:30 }[plan] || 1;

    const conn = await pool.getConnection();
    try {
      await conn.execute(
        `INSERT INTO paid_devices (mac, ip, email, plan, expires_at, active)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), 1)
         ON DUPLICATE KEY UPDATE
           ip = ?, expires_at = DATE_ADD(NOW(), INTERVAL ? DAY), active = 1`,
        [mac, ip, event.data.customer.email, plan, durationDays, ip, durationDays]
      );
      unblockDevice(ip);
      console.log(`Access granted for MAC ${mac}`);
    } catch (e) {
      console.error(e);
    } finally {
      conn.release();
    }
  }

  res.sendStatus(200);
});

app.listen(PORT, GATEWAY_IP, () => {
  console.log(`Payment portal running on http://${GATEWAY_IP}:${PORT}`);
});