
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

import pino from 'pino';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const rl = readline.createInterface({ input: stdin, output: stdout });
const AUTH_DIR = './auth_info_baileys';

let sock;
let connected = false;
let stopping = false;
let reconnecting = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connectWhatsApp() {
  if (reconnecting || stopping) return;
  reconnecting = true;

  try {
    const { state, saveCreds } =
      await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      markOnlineOnConnect: false
    });

    sock.ev.on('creds.update', saveCreds);

    let pairingRequested = false;

    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting') {
        console.log('\n[•] Menghubungkan ke WhatsApp...');
      }

      if (connection === 'open') {
        connected = true;
        reconnecting = false;
        console.log('[✓] WhatsApp berhasil terhubung.');
      }

      if (connection === 'close') {
        connected = false;

        const statusCode =
          lastDisconnect?.error?.output?.statusCode;

        console.log('[!] Koneksi terputus:', statusCode ?? 'unknown');

        if (statusCode === DisconnectReason.loggedOut) {
          console.log(
            '[!] Sesi keluar. Hapus sesi hanya jika ingin menautkan ulang.'
          );
          reconnecting = false;
          return;
        }

        reconnecting = false;
        if (!stopping) {
          console.log('[•] Mencoba menghubungkan ulang dalam 3 detik...');
          await sleep(3000);
          connectWhatsApp();
        }
      }
    });

    if (!state.creds.registered && !pairingRequested) {
      pairingRequested = true;

      const number = await rl.question(
        '\nMasukkan nomor WhatsApp (contoh 628123456789): '
      );

      const cleanNumber = number.replace(/\D/g, '');

      if (!/^62\d{8,13}$/.test(cleanNumber)) {
        console.log(
          '[!] Format nomor tidak valid. Gunakan kode negara, misalnya 62.'
        );
        stopping = true;
        sock.end(undefined);
        reconnecting = false;
        return;
      }

      try {
        const code = await sock.requestPairingCode(cleanNumber);
        console.log('\n================================');
        console.log(' PAIRING CODE:', code);
        console.log('================================');
        console.log(
          'Buka WhatsApp > Perangkat tertaut > Tautkan perangkat.'
        );
        console.log('Pilih opsi menautkan dengan nomor telepon.');
      } catch (error) {
        console.error('[!] Gagal meminta pairing code:', error.message);
      }
    }
  } catch (error) {
    reconnecting = false;
    console.error('[!] Gagal memulai koneksi:', error.message);

    if (!stopping) {
      await sleep(3000);
      connectWhatsApp();
    }
  }
}

async function sendText() {
  if (!connected || !sock) {
    console.log('[!] WhatsApp belum terhubung.');
    return;
  }

  const inputNumber = await rl.question(
    'Nomor penerima (contoh 628123456789): '
  );
  const number = inputNumber.replace(/\D/g, '');

  if (!/^62\d{8,13}$/.test(number)) {
    console.log('[!] Format nomor tidak valid.');
    return;
  }

  const message = await rl.question('Pesan: ');

  if (!message.trim()) {
    console.log('[!] Pesan tidak boleh kosong.');
    return;
  }

  try {
    await sock.sendMessage(`${number}@s.whatsapp.net`, {
      text: message.trim()
    });
    console.log('[✓] Pesan dikirim.');
  } catch (error) {
    console.error('[!] Gagal mengirim:', error.message);
  }
}

async function menu() {
  while (!stopping) {
    console.log('\n===== BAILEYS SENDER =====');
    console.log('1. Status koneksi');
    console.log('2. Kirim pesan teks');
    console.log('3. Keluar');

    const choice = await rl.question('Pilih menu: ');

    if (choice === '1') {
      console.log(
        connected ? '[✓] TERHUBUNG' : '[!] BELUM TERHUBUNG'
      );
    } else if (choice === '2') {
      await sendText();
    } else if (choice === '3') {
      stopping = true;
      connected = false;
      try {
        sock?.end(undefined);
      } catch {}
      rl.close();
      console.log('Aplikasi dihentikan.');
      process.exit(0);
    } else {
      console.log('Pilihan tidak tersedia.');
    }
  }
}

process.on('SIGINT', () => {
  stopping = true;
  try {
    sock?.end(undefined);
  } catch {}
  rl.close();
  process.exit(0);
});

await connectWhatsApp();
await menu();
