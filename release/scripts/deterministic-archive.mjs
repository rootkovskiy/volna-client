import { createHash } from 'node:crypto';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const crc32Table = new Uint32Array(256);
for (let index = 0; index < crc32Table.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crc32Table[index] = value >>> 0;
}

function deterministicGzip(content) {
  const parts = [Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff])];
  for (let offset = 0; offset < content.length; offset += 65_535) {
    const block = content.subarray(offset, Math.min(content.length, offset + 65_535));
    const header = Buffer.alloc(5);
    header[0] = offset + block.length === content.length ? 0x01 : 0x00;
    header.writeUInt16LE(block.length, 1);
    header.writeUInt16LE((~block.length) & 0xffff, 3);
    parts.push(header, block);
  }
  let crc = 0xffffffff;
  for (const byte of content) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 0);
  trailer.writeUInt32LE(content.length >>> 0, 4);
  parts.push(trailer);
  return Buffer.concat(parts);
}

function writeAscii(target, offset, length, value) {
  const bytes = Buffer.from(value, 'ascii');
  if (bytes.length > length) throw new Error(`tar field exceeds ${length} bytes`);
  bytes.copy(target, offset);
}

function writeOctal(target, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, '0');
  if (encoded.length > length - 1) throw new Error(`tar number exceeds ${length} bytes`);
  writeAscii(target, offset, length, `${encoded}\0`);
}

function splitTarPath(value) {
  if (Buffer.byteLength(value, 'utf8') <= 100) return { name: value, prefix: '' };
  for (let index = value.lastIndexOf('/'); index > 0; index = value.lastIndexOf('/', index - 1)) {
    const prefix = value.slice(0, index);
    const name = value.slice(index + 1);
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(name, 'utf8') <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`tar path is too long: ${value}`);
}

function tarEntry(pathValue, content) {
  const { name, prefix } = splitTarPath(pathValue);
  const header = Buffer.alloc(512);
  writeAscii(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, content.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeAscii(header, 156, 1, '0');
  writeAscii(header, 257, 6, 'ustar\0');
  writeAscii(header, 263, 2, '00');
  writeAscii(header, 265, 32, 'volna');
  writeAscii(header, 297, 32, 'volna');
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeAscii(header, 345, 155, prefix);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeAscii(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding]);
}

export function createDeterministicTarGzip(rootName, entries) {
  const parts = entries.map(({ path, content }) => tarEntry(`${rootName}/${path}`, content));
  parts.push(Buffer.alloc(1024));
  const tar = Buffer.concat(parts);
  const archive = deterministicGzip(tar);
  tar.fill(0);
  return archive;
}
