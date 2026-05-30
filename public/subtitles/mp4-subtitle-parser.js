/**
 * mp4-subtitle-parser.js  ·  v1.0
 *
 * Client-side MP4 / MOV / M4V subtitle extractor.
 * ISO Base Media File Format (BMFF) + QuickTime container parser.
 *
 * FEATURES
 *  - Zero dependencies
 *  - Never reads video or audio bytes — seeks directly to subtitle samples
 *  - 1 MB sliding window; no full file load
 *  - Supported codecs: tx3g (3GPP), wvtt (WebVTT-in-MP4), stpp (TTML)
 *  - Outputs ready-to-use WebVTT strings for <track> elements
 *
 * BANDWIDTH STRATEGY
 *  1. Scan top-level box headers (8 bytes each) — skip mdat with seek()
 *  2. Load the moov box fully (pure metadata, usually 0.5–3 MB)
 *  3. Parse stts / stsc / stsz / stco sample tables from moov
 *  4. Seek directly to each subtitle sample — video/audio bytes never touched
 *
 * USAGE
 *  // ES Module
 *  import { extractSubtitles } from './mp4-subtitle-parser.js';
 *
 *  // Plain <script> tag  (exposes window.MP4SubtitleParser)
 *  <script src="mp4-subtitle-parser.js"></script>
 *  const { extractSubtitles } = window.MP4SubtitleParser;
 *
 *  const tracks = await extractSubtitles(file, (pct, msg) => console.log(pct, msg));
 *  // tracks → [{ label, language, codecId, cueCount, vtt }]
 *
 *  // Attach to a <video> element:
 *  for (const track of tracks) {
 *    const url = URL.createObjectURL(new Blob([track.vtt], { type: 'text/vtt' }));
 *    const el  = Object.assign(document.createElement('track'), {
 *      kind: 'subtitles', label: track.label,
 *      srclang: track.language, src: url,
 *    });
 *    videoElement.appendChild(el);
 *  }
 */

(function (root, factory) {
  // UMD wrapper — works as ES module, CommonJS (Node), or plain <script>
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MP4SubtitleParser = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ─── Stream Reader ──────────────────────────────────────────────────────────
  // Reads a browser File object in a 1 MB sliding window.
  // skip(n) advances the cursor WITHOUT loading data — the core bandwidth win.

  class StreamReader {
    constructor(file, chunkSize = 1024 * 1024) {
      this.file     = file;
      this.fileSize = file.size;
      this.pos      = 0;
      this._buf     = null;
      this._base    = -1;
      this._csz     = chunkSize;
    }

    async _ensure(n) {
      const end = this.pos + n;
      if (this._buf && this.pos >= this._base && end <= this._base + this._buf.length) return;
      const start = this.pos;
      const stop  = Math.min(start + Math.max(n, this._csz), this.fileSize);
      this._buf   = new Uint8Array(await this.file.slice(start, stop).arrayBuffer());
      this._base  = start;
    }

    async readBytes(n) {
      if (n <= 0) return new Uint8Array(0);
      await this._ensure(n);
      const off = this.pos - this._base;
      const out = this._buf.slice(off, off + n);
      this.pos += n;
      return out;
    }

    async readU32() {
      const b = await this.readBytes(4);
      return (b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]) >>> 0;
    }

    /** Advance cursor without loading any data */
    skip(n)   { this.pos = Math.min(this.pos + n, this.fileSize); }
    seek(pos) { this.pos = Math.max(0, Math.min(pos, this.fileSize)); }

    get eof()       { return this.pos >= this.fileSize; }
    get remaining() { return this.fileSize - this.pos; }
  }

  // ─── Binary Helpers ─────────────────────────────────────────────────────────

  const _dec = new TextDecoder();
  const u8   = (b, o)    => b[o];
  const u16  = (b, o)    => (b[o] << 8 | b[o + 1]) >>> 0;
  const u32  = (b, o)    => (b[o] << 24 | b[o+1] << 16 | b[o+2] << 8 | b[o+3]) >>> 0;
  const u64  = (b, o)    => u32(b, o) * 4294967296 + u32(b, o + 4); // safe up to 2^53 (~8PB)
  const str4 = (b, o)    => _dec.decode(b.slice(o, o + 4));

  // ISO 639-2/T packed language: 3 × 5-bit chars, each offset by 0x60
  function _parseLang(val) {
    const s = String.fromCharCode(
      ((val >> 10) & 0x1F) + 0x60,
      ((val >>  5) & 0x1F) + 0x60,
      ((val      ) & 0x1F) + 0x60,
    );
    return (s === '\0\0\0') ? 'und' : s;
  }

  // ─── Box Iterator ────────────────────────────────────────────────────────────

  /**
   * Iterate immediate child boxes inside buf[offset .. offset+length).
   * cb(type: string, dataOffset: number, dataSize: number, buf: Uint8Array)
   */
  function eachBox(buf, offset, length, cb) {
    const end = offset + length;
    let   p   = offset;
    while (p + 8 <= end) {
      let size = u32(buf, p);
      const type = str4(buf, p + 4);
      let   hdr  = 8;

      if (size === 1) {
        if (p + 16 > end) break;
        size = u64(buf, p + 8);
        hdr  = 16;
      } else if (size === 0) {
        size = end - p;
      }

      if (size < hdr || p + size > end) break;
      cb(type, p + hdr, size - hdr, buf);
      p += size;
    }
  }

  /** Find first child box of `target` type, return its data slice or null. */
  function findBox(buf, offset, length, target) {
    let result = null;
    eachBox(buf, offset, length, (type, doff, dlen, b) => {
      if (!result && type === target) result = b.slice(doff, doff + dlen);
    });
    return result;
  }

  /** Recursively find the first box matching a path, e.g. ['mdia','mdhd']. */
  function findPath(buf, offset, length, path) {
    if (!path.length) return buf.slice(offset, offset + length);
    let found = null;
    eachBox(buf, offset, length, (type, doff, dlen, b) => {
      if (found) return;
      if (type === path[0]) {
        found = path.length === 1
          ? b.slice(doff, doff + dlen)
          : findPath(b, doff, dlen, path.slice(1));
      }
    });
    return found;
  }

  // ─── Sample Table Parsers ────────────────────────────────────────────────────

  /** stts — Time-to-Sample: [{count, delta}] in timescale ticks */
  function _parseSTTS(buf) {
    const n = u32(buf, 4);
    const e = [];
    for (let i = 0; i < n; i++) e.push({ count: u32(buf, 8 + i*8), delta: u32(buf, 12 + i*8) });
    return e;
  }

  /** ctts — Composition Time Offset (optional): [{count, offset}] */
  function _parseCTTS(buf) {
    if (!buf) return [];
    const n = u32(buf, 4);
    const e = [];
    for (let i = 0; i < n; i++) e.push({ count: u32(buf, 8 + i*8), offset: u32(buf, 12 + i*8) });
    return e;
  }

  /** stsz — Sample Sizes: Uint32Array, one entry per sample */
  function _parseSTSZ(buf) {
    const fixed = u32(buf, 4);
    const n     = u32(buf, 8);
    const arr   = new Uint32Array(n);
    if (fixed > 0) { arr.fill(fixed); return arr; }
    for (let i = 0; i < n; i++) arr[i] = u32(buf, 12 + i*4);
    return arr;
  }

  /** stsc — Sample-to-Chunk: [{firstChunk, samplesPerChunk, sampleDescIdx}] */
  function _parseSTSC(buf) {
    const n = u32(buf, 4);
    const e = [];
    for (let i = 0; i < n; i++) e.push({
      firstChunk:      u32(buf,  8 + i*12),
      samplesPerChunk: u32(buf, 12 + i*12),
      sampleDescIdx:   u32(buf, 16 + i*12),
    });
    return e;
  }

  /** stco / co64 — Chunk Offsets: Float64Array of absolute file positions */
  function _parseSTCO(buf, is64) {
    const n   = u32(buf, 4);
    const arr = new Float64Array(n);
    if (is64) { for (let i = 0; i < n; i++) arr[i] = u64(buf,  8 + i*8); }
    else       { for (let i = 0; i < n; i++) arr[i] = u32(buf,  8 + i*4); }
    return arr;
  }

  /**
   * Combine stts + ctts + stsc + stsz + stco into a flat sample list.
   * Returns Array<{ fileOffset: number, size: number, pts: number }>
   * where pts is in timescale ticks.
   */
  function _buildSampleTable(stts, ctts, stsc, stsz, chunkOffsets) {
    const samples    = [];
    const chunkCount = chunkOffsets.length;

    // Expand stsc into per-chunk sample counts
    const chunkSPC = new Uint32Array(chunkCount);
    for (let i = 0; i < stsc.length; i++) {
      const nextFirst = i + 1 < stsc.length ? stsc[i+1].firstChunk : chunkCount + 1;
      for (let c = stsc[i].firstChunk; c < nextFirst && c <= chunkCount; c++) {
        chunkSPC[c - 1] = stsc[i].samplesPerChunk;
      }
    }

    // Flatten: chunk → sample, recording file offsets
    let si = 0;
    for (let c = 0; c < chunkCount; c++) {
      let off = chunkOffsets[c];
      for (let s = 0; s < chunkSPC[c] && si < stsz.length; s++, si++) {
        samples.push({ fileOffset: off, size: stsz[si], dts: 0, pts: 0 });
        off += stsz[si];
      }
    }

    // Assign DTS from stts run-length encoding
    let idx = 0, dts = 0;
    for (const { count, delta } of stts) {
      for (let i = 0; i < count && idx < samples.length; i++, idx++) {
        samples[idx].dts = dts;
        dts += delta;
      }
    }

    // Apply ctts composition offsets (rare for subtitle tracks)
    if (ctts.length) {
      let ci = 0, rem = ctts[0]?.count ?? 0;
      for (let i = 0; i < samples.length; i++) {
        samples[i].pts = samples[i].dts + (ci < ctts.length ? ctts[ci].offset : 0);
        if (--rem === 0 && ++ci < ctts.length) rem = ctts[ci].count;
      }
    } else {
      for (const s of samples) s.pts = s.dts;
    }

    return samples;
  }

  // ─── Subtitle Decoders ───────────────────────────────────────────────────────

  /**
   * tx3g / QuickTime text sample:
   *   uint16  textLength
   *   char[]  UTF-8 text
   *   [optional styling boxes — ignored]
   */
  function _decodeTX3G(buf) {
    if (buf.length < 2) return '';
    const len = u16(buf, 0);
    if (!len || len > buf.length - 2) return '';
    return _dec.decode(buf.slice(2, 2 + len)).trim();
  }

  /**
   * wvtt (WebVTT-in-MP4):
   *   vttc box → payl box → cue payload text
   *   vtte box → empty cue marker (skip)
   */
  function _decodeWVTT(buf) {
    let text = '';
    eachBox(buf, 0, buf.length, (type, doff, dlen, b) => {
      if (type === 'vttc') {
        eachBox(b, doff, dlen, (t2, d2, l2, b2) => {
          if (t2 === 'payl') text += _dec.decode(b2.slice(d2, d2 + l2)).trim();
        });
      }
    });
    return text;
  }

  /**
   * stpp (TTML / SMPTE-TT) — strip XML tags, decode entities.
   * Full TTML timing is embedded in the XML; we use the MP4 sample timing instead.
   */
  function _decodeSTTP(buf) {
    return _dec.decode(buf)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ─── WebVTT Output ───────────────────────────────────────────────────────────

  const _p2 = n => String(n).padStart(2, '0');
  const _p3 = n => String(n).padStart(3, '0');

  function _msToVTT(ms) {
    if (ms < 0) ms = 0;
    const h   = Math.floor(ms / 3_600_000);
    const m   = Math.floor((ms % 3_600_000) / 60_000);
    const s   = Math.floor((ms % 60_000) / 1_000);
    const ms3 = ms % 1000;
    return `${_p2(h)}:${_p2(m)}:${_p2(s)}.${_p3(ms3)}`;
  }

  function _buildVTT(cues) {
    if (!cues.length) return 'WEBVTT\n\n(no subtitle cues found)';
    const lines = ['WEBVTT', ''];
    let n = 1;
    for (const c of cues) {
      if (!c.text) continue;
      lines.push(String(n++), `${_msToVTT(c.startMs)} --> ${_msToVTT(c.endMs)}`, c.text, '');
    }
    return lines.join('\n');
  }

  // ─── Language Map (ISO 639-2/B) ──────────────────────────────────────────────

  const LANG_NAMES = {
    eng:'English',  hin:'Hindi',      tam:'Tamil',     tel:'Telugu',
    mal:'Malayalam',kan:'Kannada',    mar:'Marathi',   ben:'Bengali',
    pan:'Punjabi',  guj:'Gujarati',   urd:'Urdu',      ori:'Odia',
    fra:'French',   spa:'Spanish',    deu:'German',    jpn:'Japanese',
    chi:'Chinese',  zho:'Chinese',    kor:'Korean',    por:'Portuguese',
    rus:'Russian',  ara:'Arabic',     ita:'Italian',   tur:'Turkish',
    und:'Unknown',
  };

  // Track handler types that signal a subtitle track
  const SUB_HANDLERS = new Set(['text', 'sbtl', 'subt', 'subp']);

  // Sample entry (codec) types we can decode
  const TEXT_CODECS  = new Set(['tx3g', 'text', 'wvtt', 'stpp']);

  // ─── trak Parser ─────────────────────────────────────────────────────────────

  function _parseTrak(moov, trakOff, trakLen) {
    // ── 1. Handler type ──
    const hdlr = findPath(moov, trakOff, trakLen, ['mdia', 'hdlr']);
    if (!hdlr) return null;
    // hdlr layout: version(1) flags(3) pre_defined(4) handler_type(4) ...
    const handlerType = str4(hdlr, 8).trim().toLowerCase();
    if (!SUB_HANDLERS.has(handlerType)) return null;

    // ── 2. mdhd: timescale + language ──
    const mdhd = findPath(moov, trakOff, trakLen, ['mdia', 'mdhd']);
    if (!mdhd) return null;
    const ver = u8(mdhd, 0);
    const timescale = u32(mdhd, ver === 1 ? 20 : 12);
    const language  = _parseLang(u16(mdhd, ver === 1 ? 28 : 20));

    // ── 3. Codec from stsd ──
    const stsd = findPath(moov, trakOff, trakLen, ['mdia', 'minf', 'stbl', 'stsd']);
    if (!stsd || u32(stsd, 4) === 0) return null;
    // stsd: version(1) flags(3) entry_count(4) [size(4) type(4) ...]*
    const codecId = str4(stsd, 12).trim().toLowerCase();
    if (!TEXT_CODECS.has(codecId)) return null;

    // ── 4. Sample table ──
    const stbl = findPath(moov, trakOff, trakLen, ['mdia', 'minf', 'stbl']);
    if (!stbl) return null;

    const sttsBuf = findBox(stbl, 0, stbl.length, 'stts');
    const cttsBuf = findBox(stbl, 0, stbl.length, 'ctts');
    const stscBuf = findBox(stbl, 0, stbl.length, 'stsc');
    const stszBuf = findBox(stbl, 0, stbl.length, 'stsz');
    const stcoBuf = findBox(stbl, 0, stbl.length, 'stco');
    const co64Buf = findBox(stbl, 0, stbl.length, 'co64');

    if (!sttsBuf || !stscBuf || !stszBuf || (!stcoBuf && !co64Buf)) return null;

    const samples = _buildSampleTable(
      _parseSTTS(sttsBuf),
      _parseCTTS(cttsBuf),
      _parseSTSC(stscBuf),
      _parseSTSZ(stszBuf),
      stcoBuf ? _parseSTCO(stcoBuf, false) : _parseSTCO(co64Buf, true),
    );

    return { language, codecId, timescale, samples };
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  /**
   * Extract subtitle tracks from an MP4 / MOV / M4V file, entirely client-side.
   *
   * @param {File}                          file
   * @param {(pct:number, msg:string)=>void} [onProgress]  pct = 0–100, msg = status string
   *
   * @returns {Promise<Array<{
   *   label:    string,   // display label (language name, or "Track N")
   *   language: string,   // ISO 639-2/B code e.g. "eng"
   *   codecId:  string,   // "tx3g" | "wvtt" | "stpp"
   *   cueCount: number,
   *   vtt:      string,   // ready-to-use WebVTT string
   * }>>}
   */
  async function extractSubtitles(file, onProgress) {
    const reader = new StreamReader(file);
    const log    = (pct, msg) => onProgress && onProgress(pct, msg);

    // ── Step 1: scan top-level boxes for moov ─────────────────────────────────
    // Each iteration reads only the 8-byte box header.
    // mdat (which holds all the video/audio, often gigabytes) is skipped via seek().

    log(2, 'Scanning top-level boxes…');

    let moovOffset = -1, moovSize = -1;

    while (!reader.eof) {
      const boxStart = reader.pos;
      if (reader.remaining < 8) break;

      let size   = await reader.readU32();
      const type = _dec.decode(await reader.readBytes(4));
      let   hdr  = 8;

      if (size === 1) {
        const hi = await reader.readU32();
        const lo = await reader.readU32();
        size = hi * 4294967296 + lo;
        hdr  = 16;
      } else if (size === 0) {
        size = reader.fileSize - boxStart;
      }

      const dataSize = size - hdr;

      if (type === 'moov') {
        moovOffset = reader.pos;
        moovSize   = dataSize;
        break;
      }

      // Skip ftyp, free, mdat, etc. — no data loaded
      reader.skip(dataSize);
    }

    if (moovOffset < 0) throw new Error('moov box not found — is this a valid MP4/MOV?');

    log(10, `Found moov (${(moovSize / 1024).toFixed(0)} KB). Parsing tracks…`);

    // ── Step 2: load moov fully ───────────────────────────────────────────────
    // Pure metadata — no A/V data here. One contiguous read.

    reader.seek(moovOffset);
    const moov = await reader.readBytes(moovSize);

    // ── Step 3: parse trak boxes ─────────────────────────────────────────────

    const subtitleTracks = [];
    eachBox(moov, 0, moov.length, (type, doff, dlen) => {
      if (type !== 'trak') return;
      const t = _parseTrak(moov, doff, dlen);
      if (t) subtitleTracks.push(t);
    });

    if (!subtitleTracks.length) {
      log(100, 'No subtitle tracks found.');
      return [];
    }

    log(20, `Found ${subtitleTracks.length} subtitle track(s). Reading samples…`);

    // ── Step 4: read subtitle sample payloads ─────────────────────────────────
    // seek() jumps over all video/audio data. Only subtitle sample bytes are read.

    const results = [];

    for (let ti = 0; ti < subtitleTracks.length; ti++) {
      const track = subtitleTracks[ti];
      log(20 + Math.round((ti / subtitleTracks.length) * 75),
          `Reading track ${ti + 1} (${track.codecId})…`);

      const cues = [];

      for (let si = 0; si < track.samples.length; si++) {
        const s = track.samples[si];
        if (s.size === 0) continue;

        reader.seek(s.fileOffset);
        const buf = await reader.readBytes(s.size);

        let text = '';
        if      (track.codecId === 'tx3g' || track.codecId === 'text') text = _decodeTX3G(buf);
        else if (track.codecId === 'wvtt')                              text = _decodeWVTT(buf);
        else if (track.codecId === 'stpp')                              text = _decodeSTTP(buf);
        if (!text) continue;

        const startMs = Math.round((s.pts / track.timescale) * 1000);
        const nextPts = si + 1 < track.samples.length
          ? track.samples[si + 1].pts
          : s.pts + track.timescale * 2;
        const endMs   = Math.max(Math.round((nextPts / track.timescale) * 1000), startMs + 500);

        cues.push({ startMs, endMs, text });
      }

      const langCode = track.language || 'und';
      const label    = LANG_NAMES[langCode] || langCode || `Track ${ti + 1}`;

      results.push({
        label,
        language: langCode,
        codecId:  track.codecId,
        cueCount: cues.length,
        vtt:      _buildVTT(cues),
      });
    }

    log(100, 'Done.');
    return results;
  }

  // Public surface
  return { extractSubtitles };

}));
