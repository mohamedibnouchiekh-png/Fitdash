// Where the Apple Health export lives: a .zip (as produced by the Health app), an unzipped folder, or a bare export.xml.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import yauzl from "yauzl";

export interface ExportSource {
  describe: string;
  /** Fresh utf-8 stream of export.xml (called once per pass). */
  openXml(): Promise<Readable>;
  /** Text of a file referenced from the XML (e.g. "/workout-routes/route_….gpx"), or null when it is not in the export. */
  readText(refPath: string): Promise<string | null>;
  hasRoutes: boolean;
  close(): void;
}

const isMainXml = (name: string) => /(^|\/)export\.xml$/i.test(name);

class XmlOnlySource implements ExportSource {
  hasRoutes = false;
  private file: string;
  constructor(file: string) { this.file = file; }
  get describe() { return `XML file ${path.basename(this.file)}`; }
  async openXml() { return fs.createReadStream(this.file, { encoding: "utf8", highWaterMark: 1 << 20 }); }
  async readText() { return null; }
  close() {}
}

class DirSource implements ExportSource {
  hasRoutes: boolean;
  private xml: string;
  private root: string;
  constructor(root: string, xml: string) {
    this.root = root;
    this.xml = xml;
    this.hasRoutes = fs.existsSync(path.join(path.dirname(xml), "workout-routes"));
  }
  get describe() { return `folder ${path.basename(this.root)}`; }
  async openXml() { return fs.createReadStream(this.xml, { encoding: "utf8", highWaterMark: 1 << 20 }); }
  async readText(ref: string) {
    const base = path.dirname(this.xml);
    const target = path.resolve(base, "." + (ref.startsWith("/") ? ref : "/" + ref));
    if (!target.startsWith(path.resolve(base) + path.sep)) return null; // never read outside the export folder
    try { return await fs.promises.readFile(target, "utf8"); } catch { return null; }
  }
  close() {}
}

class ZipSource implements ExportSource {
  hasRoutes = false;
  private zip: yauzl.ZipFile;
  private file: string;
  private entries: Map<string, yauzl.Entry>;
  private xmlName: string;
  constructor(zip: yauzl.ZipFile, file: string, entries: Map<string, yauzl.Entry>, xmlName: string) {
    this.zip = zip; this.file = file; this.entries = entries; this.xmlName = xmlName;
    this.hasRoutes = [...entries.keys()].some((n) => /workout-routes\/.+\.gpx$/i.test(n));
  }
  get describe() { return `zip ${path.basename(this.file)}`; }
  private stream(entry: yauzl.Entry): Promise<Readable> {
    return new Promise((resolve, reject) => this.zip.openReadStream(entry, (err, s) => (err || !s ? reject(err ?? new Error("empty stream")) : resolve(s))));
  }
  async openXml() {
    const s = await this.stream(this.entries.get(this.xmlName)!);
    s.setEncoding("utf8");
    return s;
  }
  async readText(ref: string) {
    const want = ref.replace(/^\/+/, "");
    let entry: yauzl.Entry | undefined;
    for (const [name, e] of this.entries) if (name === want || name.endsWith("/" + want)) { entry = e; break; }
    if (!entry) return null;
    const s = await this.stream(entry);
    const chunks: Buffer[] = [];
    for await (const c of s) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks).toString("utf8");
  }
  close() { try { this.zip.close(); } catch { /* already closed */ } }
}

function openZip(file: string): Promise<ExportSource> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false, decodeStrings: true }, (err, zip) => {
      if (err || !zip) return reject(new Error(`Could not open the zip file: ${err?.message ?? "unknown error"}`));
      const entries = new Map<string, yauzl.Entry>();
      zip.on("entry", (e: yauzl.Entry) => { if (!e.fileName.endsWith("/")) entries.set(e.fileName, e); zip.readEntry(); });
      zip.on("end", () => {
        const xmlName = [...entries.keys()].find(isMainXml);
        if (!xmlName) { zip.close(); return reject(new Error("This zip does not contain export.xml. In the Health app choose profile picture → Export All Health Data and use the zip it creates.")); }
        resolve(new ZipSource(zip, file, entries, xmlName));
      });
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

export async function openExport(input: string): Promise<ExportSource> {
  const st = await fs.promises.stat(input).catch(() => null);
  if (!st) throw new Error(`File not found: ${input}`);
  if (st.isDirectory()) {
    for (const cand of [path.join(input, "export.xml"), path.join(input, "apple_health_export", "export.xml")]) {
      if (fs.existsSync(cand)) return new DirSource(input, cand);
    }
    throw new Error("No export.xml found in that folder.");
  }
  if (/\.zip$/i.test(input)) return openZip(input);
  if (/\.xml$/i.test(input)) return new XmlOnlySource(input);
  throw new Error("Unsupported file. Use the export.zip (or export.xml) created by the Health app.");
}
