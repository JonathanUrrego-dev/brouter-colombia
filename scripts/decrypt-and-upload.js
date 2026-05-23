// scripts/decrypt-and-upload.js
// Decrypt tiles (OpenSSL-compatible AES-256-CBC) and upload to Cloudflare Worker.
import { readdirSync, statSync, createReadStream } from 'fs';
import { mkdir } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { spawn } from 'child_process';
import path from 'path';

const WORKER_URL    = process.env.WORKER_URL;
const UPLOAD_SECRET = process.env.UPLOAD_SECRET;
const DECRYPT_METHOD = process.env.DECRYPT_METHOD || 'openssl'; // 'openssl' or 'node'
const DECRYPT_PASS  = process.env.DECRYPT_PASS || ''; // used by openssl -pass pass:...
const DECRYPT_KEY_HEX = process.env.DECRYPT_KEY_HEX || ''; // hex key for node method
const DECRYPT_IV_HEX  = process.env.DECRYPT_IV_HEX || '';  // hex iv for node method

const INPUT_DIR  = process.env.TILES_DIR || './tiles-temp';
const OUT_DIR    = process.env.OUTPUT_DIR || './tiles-decrypted';

if (!WORKER_URL || !UPLOAD_SECRET) {
  console.error('Faltan WORKER_URL o UPLOAD_SECRET');
  process.exit(1);
}

function isTileFile(name) {
  return name.endsWith('.rd5') || name.endsWith('.rd5.enc') || name.endsWith('.enc');
}

async function decryptWithOpenSSL(inPath, outPath) {
  if (!DECRYPT_PASS) throw new Error('DECRYPT_PASS requerida para openssl');
  await mkdir(path.dirname(outPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const args = ['enc', '-d', '-aes-256-cbc', '-in', inPath, '-out', outPath, '-pass', `pass:${DECRYPT_PASS}`];
    const p = spawn('openssl', args, { stdio: 'inherit' });
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error('openssl exit ' + code))));
    p.on('error', reject);
  });
}

import crypto from 'crypto';
async function decryptWithNode(inPath, outPath) {
  if (!DECRYPT_KEY_HEX || !DECRYPT_IV_HEX) throw new Error('DECRYPT_KEY_HEX y DECRYPT_IV_HEX requeridos para node');
  await mkdir(path.dirname(outPath), { recursive: true });
  const key = Buffer.from(DECRYPT_KEY_HEX, 'hex');
  const iv  = Buffer.from(DECRYPT_IV_HEX, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const inp = createReadStream(inPath);
  const out = (await import('fs')).createWriteStream(outPath);
  await pipeline(inp, decipher, out);
}

async function uploadFile(filename, localPath) {
  const fileBuffer = await (await import('fs/promises')).readFile(localPath);
  const res = await fetch(`${WORKER_URL}/${filename}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Secret': UPLOAD_SECRET },
    body: fileBuffer,
  });
  if (!res.ok) throw new Error(`Worker respondió ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const files = readdirSync(INPUT_DIR).filter(isTileFile);
  if (files.length === 0) {
    console.log('No se encontraron tiles para procesar en', INPUT_DIR);
    return;
  }

  for (const f of files) {
    try {
      const inPath = path.join(INPUT_DIR, f);
      const stat = statSync(inPath);
      if (!stat.isFile()) continue;

      const baseName = f.replace(/\.enc$/,'').replace(/\.rd5$/,'') + '.rd5';
      const outPath = path.join(OUT_DIR, baseName);

      console.log(`Procesando ${f} → ${baseName}`);

      if (DECRYPT_METHOD === 'openssl') {
        await decryptWithOpenSSL(inPath, outPath);
      } else {
        await decryptWithNode(inPath, outPath);
      }

      const json = await uploadFile(baseName, outPath);
      if (json.skipped) console.log(`⏭️  ${baseName} ya estaba en R2`);
      else console.log(`✅ ${baseName} subido (${(json.bytes/1024/1024).toFixed(1)} MB)`);

    } catch (err) {
      console.error('Error procesando', f, err.message);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
