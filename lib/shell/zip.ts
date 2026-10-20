/** Small uncompressed ZIP writer: bounded evidence copies, standard CRC-32 and central directory. */
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let b = 0; b < 8; b++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(data: Buffer) {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function zipFiles(files: Array<{ name: string; body: Buffer }>) {
  if (files.length > 65535) throw new Error("Too many files for this ZIP.");
  for (const file of files)
    if (
      !file.name ||
      file.name.startsWith("/") ||
      file.name.includes("\\") ||
      file.name.split("/").includes("..")
    )
      throw new Error("Invalid ZIP filename.");
  const chunks: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name),
      checksum = crc(f.body),
      head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6);
    head.writeUInt32LE(checksum, 14);
    head.writeUInt32LE(f.body.length, 18);
    head.writeUInt32LE(f.body.length, 22);
    head.writeUInt16LE(33, 12);
    head.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x800, 8);
    dir.writeUInt32LE(checksum, 16);
    dir.writeUInt32LE(f.body.length, 20);
    dir.writeUInt32LE(f.body.length, 24);
    dir.writeUInt16LE(33, 14);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    chunks.push(head, name, f.body);
    central.push(dir, name);
    offset += head.length + name.length + f.body.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}

/** Existing workspace export remains one UTF-8 JSON member. */
export function jsonZip(json: string) {
  return zipFiles([{ name: "workspace.json", body: Buffer.from(json) }]);
}
