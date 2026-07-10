// Minimal ZIP writer (store method, no compression). A .docx is just a
// ZIP of XML parts, so this lets us build Word documents with zero
// dependencies and fully offline. Stored (uncompressed) entries are valid
// per the ZIP/OOXML spec and open in Word, Pages and Google Docs.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

function concat(arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

// entries: [{ name, text }]. Returns a Blob of the given mime type.
export function zipStore(entries, mime = 'application/octet-stream') {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const push = (arr) => {
    chunks.push(arr);
    offset += arr.length;
  };

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = enc.encode(e.text);
    const crc = crc32(data);
    const size = data.length;

    const localHeader = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0),
    ]);
    const localOffset = offset;
    push(localHeader);
    push(nameBytes);
    push(data);

    const centralHeader = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(localOffset),
    ]);
    central.push(concat([centralHeader, nameBytes]));
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    push(c);
    cdSize += c.length;
  }

  push(
    concat([
      u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
      u32(cdSize), u32(cdStart), u16(0),
    ])
  );

  return new Blob(chunks, { type: mime });
}
