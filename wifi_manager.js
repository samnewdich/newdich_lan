// ────────────────────────────────────────────────
// THIS SOFTWARE IS DEVELOPED AND MAINTAINED BY NEWDICH TECHNOLOGY
// FIRM: NEWDICH TECHNOLOGY
// SECTOR: SOFTWARE ENGINEERING FIRM
// WEBSITE: WWW.NEWDICH.TECH
// EMAIL: SUPPORT@NEWDICH.TECH
// WHATSAPP/CALL: +2347032095559
// ALL RIGHT RESERVED: NOBODY IS PERMITTED TO USE THIS SOFTWARE WITHOUT GETTING APPROPRITAE LICENCE FROM NEWDICH TECHNOLOGY
// ────────────────────────────────────────────────
const { exec } = require('child_process');
const express = require('express');
const axios = require('axios');
const app = express();
require('dotenv').config();

//SET ROUTER'S INTERFACE
const DOWNSTREAM_IFACE = process.env.DOWNSTREAM_IFACE;          // Your USB WiFi adapter (hotspot side)
const UPSTREAM_IFACE   = process.env.UPSTREAM_IFACE;           // Connection to your modem/router (upstream internet)
const GATEWAY_IP       = process.env.GATEWAY_IP;  // Local gateway IP – choose non-conflicting subnet

//const PUBLIC_PAYMENT_URL = 'https://yourdomain.com/paid-hotspot/index.php'; // Namecheap URL
//const CHECK_PAID_API     = 'https://yourdomain.com/paid-hotspot/api/check-paid.php';
const PUBLIC_PAYMENT_URL = process.env.PUBLIC_PAYMENT_URL;
const CHECK_PAID_API     = process.env.CHECK_PAID_API;

//software port
const PORT = process.env.PORT;


/*
//function that blocks device from the network
function blockDevice(ip) {
  exec(`iptables -A FORWARD -s ${ip} -j DROP`);
  exec(`iptables -t nat -A PREROUTING -s ${ip} -p tcp --dport 80  -j DNAT --to ${GATEWAY_IP}:80`);
  exec(`iptables -t nat -A PREROUTING -s ${ip} -p tcp --dport 443 -j DNAT --to ${GATEWAY_IP}:80`);
}


//function that unblocks device from the network
function unblockDevice(ip) {
  exec(`iptables -D FORWARD -s ${ip} -j DROP || true`);
  exec(`iptables -t nat -D PREROUTING -s ${ip} -p tcp --dport 80  -j DNAT --to ${GATEWAY_IP}:80 || true`);
  exec(`iptables -t nat -D PREROUTING -s ${ip} -p tcp --dport 443 -j DNAT --to ${GATEWAY_IP}:80 || true`);
}
*/
//function that blocks device from the network
function blockDevice(ip) {
  exec(`iptables -A FORWARD -s ${ip} -j DROP`);
  exec(`iptables -t nat -A PREROUTING -s ${ip} -p tcp --dport ${PORT}  -j DNAT --to ${GATEWAY_IP}:${PORT}`);
  exec(`iptables -t nat -A PREROUTING -s ${ip} -p tcp --dport 443 -j DNAT --to ${GATEWAY_IP}:${PORT}`);
}


//function that unblocks device from the network
function unblockDevice(ip) {
  exec(`iptables -D FORWARD -s ${ip} -j DROP || true`);
  exec(`iptables -t nat -D PREROUTING -s ${ip} -p tcp --dport ${PORT}  -j DNAT --to ${GATEWAY_IP}:${PORT} || true`);
  exec(`iptables -t nat -D PREROUTING -s ${ip} -p tcp --dport 443 -j DNAT --to ${GATEWAY_IP}:${PORT} || true`);
}


//Scan devices & check paid status via API
setInterval(async () => {
  exec(`arp -i ${DOWNSTREAM_IFACE} -a`, async (err, stdout) => {
    if (err) return console.error('ARP error:', err);

    const lines = stdout.split('\n');
    for (const line of lines) {
      const match = line.match(/\(([\d.]+)\)\sat\s([0-9A-Fa-f:]+)\s/);
      if (!match) continue;

      const ip = match[1];
      const mac = match[2].toUpperCase();

      if (ip === GATEWAY_IP) continue;

      try {
        const res = await axios.get(`${CHECK_PAID_API}?mac=${encodeURIComponent(mac)}&current_time=${Math.floor(Date.now() / 1000)}`);
        const { paid } = res.data;

        if(paid || paid ==="yes" || paid === true) {
          unblockDevice(ip);
        } else {
          blockDevice(ip);
        }
      } catch (err) {
        console.error(`Failed to check ${mac}:`, err.message);
        blockDevice(ip); // Safe default
      }
    }
  });
}, 10000); // Check every 10 seconds


// Redirect all HTTP to public payment page (minimal local server)
app.use((req, res) => {
  const ip = req.connection.remoteAddress.replace('::ffff:', '');
  const redirectUrl = `${PUBLIC_PAYMENT_URL}?mac=${encodeURIComponent('DEVICE_MAC')}&ip=${encodeURIComponent(ip)}&current_time=${Math.floor(Date.now() / 1000)}`;
  res.redirect(302, redirectUrl);
});

app.listen(PORT, GATEWAY_IP, () => {
  console.log(`Redirect server running on ${GATEWAY_IP}:${PORT}`);
});