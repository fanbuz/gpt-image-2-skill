type ZipEntry = {
  name: string;
  data: Blob;
};

const textEncoder = new TextEncoder();
const CRC_TABLE = makeCrcTable();

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeU16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeU32(target: number[], value: number) {
  target.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

async function entryBytes(entry: ZipEntry) {
  return new Uint8Array(await entry.data.arrayBuffer());
}

export async function createStoredZip(entries: ZipEntry[]) {
  const chunks: BlobPart[] = [];
  const central: BlobPart[] = [];
  const { dosDate, dosTime } = dosDateTime();
  let offset = 0;

  for (const entry of entries) {
    const data = await entryBytes(entry);
    const nameBytes = textEncoder.encode(entry.name.replace(/^\/+/, ""));
    const crc = crc32(data);

    const local: number[] = [];
    writeU32(local, 0x04034b50);
    writeU16(local, 20);
    writeU16(local, 0x0800);
    writeU16(local, 0);
    writeU16(local, dosTime);
    writeU16(local, dosDate);
    writeU32(local, crc);
    writeU32(local, data.length);
    writeU32(local, data.length);
    writeU16(local, nameBytes.length);
    writeU16(local, 0);
    chunks.push(new Uint8Array(local), nameBytes, data);

    const header: number[] = [];
    writeU32(header, 0x02014b50);
    writeU16(header, 20);
    writeU16(header, 20);
    writeU16(header, 0x0800);
    writeU16(header, 0);
    writeU16(header, dosTime);
    writeU16(header, dosDate);
    writeU32(header, crc);
    writeU32(header, data.length);
    writeU32(header, data.length);
    writeU16(header, nameBytes.length);
    writeU16(header, 0);
    writeU16(header, 0);
    writeU16(header, 0);
    writeU16(header, 0);
    writeU32(header, 0);
    writeU32(header, offset);
    central.push(new Uint8Array(header), nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => {
    if (part instanceof Uint8Array) return sum + part.length;
    if (typeof part === "string") return sum + textEncoder.encode(part).length;
    return sum;
  }, 0);
  const centralOffset = offset;
  const end: number[] = [];
  writeU32(end, 0x06054b50);
  writeU16(end, 0);
  writeU16(end, 0);
  writeU16(end, entries.length);
  writeU16(end, entries.length);
  writeU32(end, centralSize);
  writeU32(end, centralOffset);
  writeU16(end, 0);

  return new Blob([...chunks, ...central, new Uint8Array(end)], {
    type: "application/zip",
  });
}
