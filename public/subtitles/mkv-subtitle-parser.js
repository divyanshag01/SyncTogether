/**
 * mkv-subtitle-parser.js  ·  v1.0
 *
 * Client-side MKV subtitle extractor.
 *
 * FEATURES
 *  - Zero dependencies
 *  - Never loads the full file into memory (1 MB sliding window)
 *  - skip() jumps over large video/audio blocks without reading them
 *  - Supported codecs: S_TEXT/UTF8 (SRT), S_TEXT/ASS, S_TEXT/SSA, S_TEXT/WEBVTT
 *  - Outputs ready-to-use WebVTT strings for <track> elements
 *
 * USAGE
 *  import { extractSubtitles } from './mkv-subtitle-parser.js';
 *
 *  const tracks = await extractSubtitles(file, pct => showProgress(pct));
 *  // tracks → [{ label, language, codecId, cueCount, vtt }]
 *
 *  // Attach to a <video> player:
 *  for (const track of tracks) {
 *    const blob = new Blob([track.vtt], { type: 'text/vtt' });
 *    const url  = URL.createObjectURL(blob);
 *    const el   = Object.assign(document.createElement('track'), {
 *      kind: 'subtitles', label: track.label,
 *      srclang: track.language, src: url,
 *    });
 *    videoElement.appendChild(el);
 *  }
 *
 * ASSUMPTIONS
 *  MKV spec guarantees Info + Tracks appear before any Cluster in a
 *  well-formed file (Matroska §3.4).  All real-world encoders follow this.
 *  Unknown-size Segments and Clusters (live-stream MKVs) are also handled.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  EBML Element IDs  (4-byte IDs are Level-1 / top-of-Segment elements)
// ─────────────────────────────────────────────────────────────────────────────

const ID = {
  // Top-level
  EBML:          0x1A45DFA3,
  Segment:       0x18538067,
  // Level 1 (direct children of Segment)
  Info:          0x1549A966,
  Tracks:        0x1654AE6B,
  Cluster:       0x1F43B675,
  // Info children
  TimecodeScale: 0x2AD7B1,   // nanoseconds per timecode tick (default 1 000 000 = 1 ms)
  // Track children
  TrackEntry:    0xAE,
  TrackNumber:   0xD7,
  TrackType:     0x83,
  CodecID:       0x86,
  CodecPrivate:  0x63A2,
  Language:      0x22B59C,
  TrackName:     0x536E,
  // Cluster children
  Timecode:      0xE7,       // cluster base timecode (ticks)
  SimpleBlock:   0xA3,
  BlockGroup:    0xA0,
  Block:         0xA1,
  BlockDuration: 0x9B,       // ticks
};

const SUBTITLE_TRACK_TYPE = 0x11;

// IDs of Level-1 elements (4-byte EBML IDs, first nibble = 0x1_)
// Used to detect end of an unknown-size Cluster.
const LEVEL1_IDS = new Set([
  0x1549A966, 0x1654AE6B, 0x1F43B675, 0x1043A770, 0x1941A469,
  0x1C53BB6B, 0x1254C367, 0x1941A469, 0x114D9B74,
]);

// ─────────────────────────────────────────────────────────────────────────────
//  Streaming File Reader
//  Reads a browser File object in 1 MB sliding windows.
//  skip(n) advances the cursor WITHOUT loading data — key to performance.
// ─────────────────────────────────────────────────────────────────────────────

class StreamReader {
  constructor(file, chunkSize = 1024 * 1024) {
    this.file      = file;
    this.fileSize  = file.size;
    this.pos       = 0;          // absolute file cursor
    this._buf      = null;       // Uint8Array of the current loaded window
    this._bufBase  = -1;         // file offset of _buf[0]
    this._chunkSz  = chunkSize;
  }

  /** Ensure [this.pos, this.pos+n) is inside _buf, loading if needed. */
  async _ensure(n) {
    const need = this.pos + n;
    if (
      this._buf !== null &&
      this.pos  >= this._bufBase &&
      need      <= this._bufBase + this._buf.length
    ) return;  // already in buffer

    const start = this.pos;
    const end   = Math.min(start + Math.max(n, this._chunkSz), this.fileSize);
    this._buf     = new Uint8Array(await this.file.slice(start, end).arrayBuffer());
    this._bufBase = start;
  }

  /** Read n bytes and advance cursor. */
  async readBytes(n) {
    if (n <= 0) return new Uint8Array(0);
    await this._ensure(n);
    const local = this.pos - this._bufBase;
    const out   = this._buf.slice(local, local + n);
    this.pos   += n;
    return out;
  }

  /** Advance cursor by n bytes WITHOUT reading.
   *  The buffer will be reloaded lazily on next readBytes(). */
  skip(n) { this.pos += n; }

  /** Seek to an absolute file position. */
  seek(pos) { this.pos = pos; }

  get remaining() { return this.fileSize - this.pos; }
  get eof()       { return this.pos >= this.fileSize; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Low-level EBML Parsing  (operates on a Uint8Array slice, synchronous)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse an EBML Element ID (VINT with marker bit KEPT).
 * Returns { value, width }.
 */
function _parseId(buf, p) {
  const b = buf[p];
  let w = 1, mask = 0x80;
  while (w <= 4 && !(b & mask)) { w++; mask >>= 1; }
  let v = b;
  for (let i = 1; i < w; i++) v = v * 256 + buf[p + i];
  return { value: v, width: w };
}

/**
 * Parse an EBML data size (VINT with marker bit STRIPPED).
 * Returns { value, width }.  value === -1 means "unknown / streaming".
 */
function _parseSize(buf, p) {
  const b = buf[p];
  let w = 1, mask = 0x80;
  while (w <= 8 && !(b & mask)) { w++; mask >>= 1; }
  let v    = b & (mask - 1);
  let allFF = (v === mask - 1);
  for (let i = 1; i < w; i++) {
    const byte = buf[p + i];
    if (byte !== 0xFF) allFF = false;
    v = v * 256 + byte;
  }
  return { value: allFF ? -1 : v, width: w };
}

/** Read a big-endian unsigned integer from buf[offset..offset+n). */
function _uInt(buf, offset, n) {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + buf[offset + i];
  return v;
}

/** Decode UTF-8 bytes from buf[offset..offset+n), trimming null bytes. */
function _utf8(buf, offset, n) {
  return new TextDecoder().decode(buf.slice(offset, offset + n)).replace(/\0+$/, '');
}

/**
 * Read the next EBML element header from the StreamReader.
 * Leaves the cursor at the start of the element's data payload.
 * Returns { id, size } or null at EOF / parse error.
 */
async function readElemHeader(reader) {
  if (reader.remaining < 2) return null;

  const saved  = reader.pos;
  const toRead = Math.min(12, reader.remaining); // max EBML header is 4+8=12 bytes

  let buf;
  try { buf = await reader.readBytes(toRead); }
  catch { return null; }

  let p = 0;
  let id, idW, size, sizeW;
  try {
    ({ value: id,   width: idW   } = _parseId(buf, p));   p += idW;
    ({ value: size, width: sizeW } = _parseSize(buf, p)); p += sizeW;
  } catch {
    reader.seek(saved);
    return null;
  }

  // Rewind to exactly after the header bytes (we over-read up to 12)
  reader.seek(saved + p);
  return { id, size };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tracks Parsing  (operates on a pre-loaded byte slice)
// ─────────────────────────────────────────────────────────────────────────────

function _parseTracks(buf) {
  const tracks = [];
  let p = 0;

  while (p < buf.length) {
    const { value: id,   width: idW   } = _parseId(buf, p);   p += idW;
    const { value: size, width: sizeW } = _parseSize(buf, p); p += sizeW;
    if (size < 0) break;

    if (id === ID.TrackEntry) {
      const entry = _parseTrackEntry(buf, p, p + size);
      if (entry && entry.type === SUBTITLE_TRACK_TYPE) tracks.push(entry);
    }
    p += size;
  }
  return tracks;
}

function _parseTrackEntry(buf, start, end) {
  const t = { number: 0, type: 0, codecId: '', language: 'und', name: '', codecPrivate: '' };
  let p = start;

  while (p < end && p < buf.length) {
    const { value: id,   width: idW   } = _parseId(buf, p);   p += idW;
    const { value: size, width: sizeW } = _parseSize(buf, p); p += sizeW;
    if (size < 0) break;

    switch (id) {
      case ID.TrackNumber:   t.number       = _uInt(buf, p, size);  break;
      case ID.TrackType:     t.type         = _uInt(buf, p, size);  break;
      case ID.CodecID:       t.codecId      = _utf8(buf, p, size);  break;
      case ID.Language:      t.language     = _utf8(buf, p, size);  break;
      case ID.TrackName:     t.name         = _utf8(buf, p, size);  break;
      case ID.CodecPrivate:  t.codecPrivate = _utf8(buf, p, size);  break;
    }
    p += size;
  }
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Block Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a Block or SimpleBlock byte payload.
 * Returns { trackNum, relTimecode, payload } or null if not a subtitle track.
 *
 * Block wire format:
 *   TrackNumber  VINT  (1-8 bytes)
 *   Timecode     Int16BE  (relative to cluster timecode)
 *   Flags        uint8
 *   Data         ...
 */
function _parseBlock(buf, subtitleSet) {
  let p = 0;

  // Track number (VINT, marker bit stripped)
  const first = buf[p];
  let w = 1, mask = 0x80;
  while (w <= 8 && !(first & mask)) { w++; mask >>= 1; }
  let trackNum = first & (mask - 1);
  p++;
  for (let i = 1; i < w; i++) trackNum = trackNum * 256 + buf[p++];

  if (!subtitleSet.has(trackNum)) return null;  // not a subtitle track — skip

  // Relative timecode: signed Int16 big-endian
  const raw16 = (buf[p] << 8) | buf[p + 1];
  const relTimecode = raw16 > 32767 ? raw16 - 65536 : raw16;
  p += 2;

  p++;  // flags byte (lacing etc.) — we don't use it for text subtitles

  return { trackNum, relTimecode, payload: buf.slice(p) };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cluster Scanner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan one Cluster element, extracting subtitle cues into cuesByTrack.
 * clusterSizeHint is -1 for unknown-size clusters (live MKV).
 */
async function _scanCluster(reader, clusterSizeHint, segEnd, subtitleSet, tickToMs, cuesByTrack) {
  let clusterTimecode = 0;
  const clusterDataStart = reader.pos;
  const clusterEnd = clusterSizeHint >= 0
    ? clusterDataStart + clusterSizeHint
    : segEnd;

  while (!reader.eof && reader.pos < clusterEnd) {
    const elemPos = reader.pos;
    const elem = await readElemHeader(reader);
    if (!elem) break;

    // Detect a Level-1 element — signals end of unknown-size cluster
    if (LEVEL1_IDS.has(elem.id)) {
      reader.seek(elemPos);  // put it back; caller will parse it
      break;
    }

    const dataStart = reader.pos;

    switch (elem.id) {

      case ID.Timecode: {
        // Cluster's base timecode in ticks
        const buf = await reader.readBytes(elem.size);
        clusterTimecode = _uInt(buf, 0, elem.size);
        break;
      }

      case ID.SimpleBlock: {
        // Read the full block (text subtitles are small, ~10-200 bytes)
        const buf = await reader.readBytes(elem.size);
        const block = _parseBlock(buf, subtitleSet);
        if (block) {
          const startMs = Math.round((clusterTimecode + block.relTimecode) * tickToMs);
          cuesByTrack[block.trackNum].push({
            startMs,
            endMs: startMs + 2000,                       // default; refined in BlockGroup
            text: new TextDecoder().decode(block.payload),
          });
        }
        break;
      }

      case ID.BlockGroup: {
        // Contains a Block + optional BlockDuration
        if (elem.size < 0) break;
        const bgEnd = dataStart + elem.size;
        let blockBuf = null;
        let duration = 0;

        while (reader.pos < bgEnd) {
          const be = await readElemHeader(reader);
          if (!be) break;

          if (be.id === ID.Block) {
            blockBuf = await reader.readBytes(be.size);
          } else if (be.id === ID.BlockDuration) {
            const db = await reader.readBytes(be.size);
            duration = _uInt(db, 0, be.size);
          } else {
            if (be.size > 0) reader.skip(be.size);
            else reader.seek(bgEnd);  // bail on unknown-size inner element
          }
        }
        reader.seek(bgEnd);  // ensure we're at the right position

        if (blockBuf) {
          const block = _parseBlock(blockBuf, subtitleSet);
          if (block) {
            const startMs = Math.round((clusterTimecode + block.relTimecode) * tickToMs);
            const endMs   = duration > 0
              ? Math.round(startMs + duration * tickToMs)
              : startMs + 2000;
            cuesByTrack[block.trackNum].push({
              startMs, endMs,
              text: new TextDecoder().decode(block.payload),
            });
          }
        }
        break;
      }

      default: {
        // Skip everything else (video frames, audio blocks, etc.)
        // skip() does NOT load the data — this is the bandwidth win.
        if (elem.size > 0)      reader.skip(elem.size);
        else if (elem.size < 0) { reader.seek(clusterEnd); break; }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  WebVTT Output Formatters
// ─────────────────────────────────────────────────────────────────────────────

function _msToVTT(ms) {
  if (ms < 0) ms = 0;
  const h   = Math.floor(ms / 3600000);
  const m   = Math.floor((ms % 3600000) / 60000);
  const s   = Math.floor((ms % 60000) / 1000);
  const ms3 = Math.floor(ms % 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms3)}`;
}

const pad2 = n => String(n).padStart(2, '0');
const pad3 = n => String(n).padStart(3, '0');

/** Strip ASS/SSA override tags: {..}, \N, \n, \h */
function _stripAss(text){

    if(!text){
        return "";
    }

    // remove ASS override tags
    text = text.replace(/\{.*?\}/g, "");

    // remove drawing/vector commands
    if(
        /^m\s[\d\s.\-bclm]+$/i.test(
            text.trim()
        )
    ){
        return "";
    }

    // remove lines with excessive numeric/vector junk
    const numericCount =
        (text.match(/[0-9]/g) || []).length;

    if(numericCount > 40){
        return "";
    }

    // remove ASS drawing mode markers
    if(
        text.includes("\\p1") ||
        text.includes("\\p2") ||
        text.includes("\\p3")
    ){
        return "";
    }

    // remove excessive coordinate-heavy lines
    const coordinatePattern =
        /(\d+\.\d+\s+){10,}/;

    if(
        coordinatePattern.test(text)
    ){
        return "";
    }

    // cleanup whitespace
    text = text.trim();

    return text;
}

/** Strip SRT-style tags except <b>, <i>, <u> which VTT supports */
function _stripSrt(text) {
  return text
    .replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '')
    .replace(/<[^>]+>/g, tag => /^<\/?[biu]>$/i.test(tag) ? tag : '')
    .trim();
}

/**
 * Build a WebVTT string from an array of { startMs, endMs, text } cues.
 * transformFn converts raw block text to display text.
 */
function _buildVTT(cues, transformFn) {
  if (!cues.length) return 'WEBVTT\n\n(no subtitle cues found)';

  const out     = ['WEBVTT', ''];
  const sorted  = [...cues].sort((a, b) => a.startMs - b.startMs);
  let   cueNum  = 1;

  for (const cue of sorted) {
    const text = transformFn(cue.text);
    if (!text) continue;
    out.push(
      String(cueNum++),
      `${_msToVTT(cue.startMs)} --> ${_msToVTT(cue.endMs)}`,
      text,
      '',
    );
  }
  return out.join('\n');
}

/** Convert ASS/SSA block cues to VTT.
 *  Each block text = "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text" */
function _assToVTT(cues) {
  return _buildVTT(cues, raw => {
    const parts = raw.split(',');
    const text  = parts.length >= 9 ? parts.slice(8).join(',') : raw;
    return _stripAss(text);
  });
}

/** Convert S_TEXT/UTF8 (SRT-like) block cues to VTT. */
function _srtToVTT(cues) {
  return _buildVTT(cues, raw => _stripSrt(raw));
}

/** Pass-through for S_TEXT/WEBVTT blocks. */
function _vttPassthrough(cues) {
  return _buildVTT(cues, raw => raw.trim());
}

// ─────────────────────────────────────────────────────────────────────────────
//  Language Code → Display Name  (ISO 639-2/B)
// ─────────────────────────────────────────────────────────────────────────────

const LANG_NAMES = {
  eng: 'English',   hin: 'Hindi',       tam: 'Tamil',       tel: 'Telugu',
  mal: 'Malayalam', kan: 'Kannada',     mar: 'Marathi',     ben: 'Bengali',
  pan: 'Punjabi',   guj: 'Gujarati',    urd: 'Urdu',        ori: 'Odia',
  fra: 'French',    spa: 'Spanish',     deu: 'German',      jpn: 'Japanese',
  chi: 'Chinese',   zho: 'Chinese',     kor: 'Korean',      por: 'Portuguese',
  rus: 'Russian',   ara: 'Arabic',      ita: 'Italian',     tur: 'Turkish',
  und: 'Unknown',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract subtitle tracks from an MKV file, entirely client-side.
 *
 * @param {File}                file        - The .mkv File object from an <input type="file">
 * @param {(pct:number)=>void} [onProgress] - Called with 0–100 as parsing advances
 *
 * @returns {Promise<Array<{
 *   label:    string,   // display name (track name → language name → "Track N")
 *   language: string,   // ISO 639-2/B code, e.g. "eng"
 *   codecId:  string,   // e.g. "S_TEXT/ASS"
 *   cueCount: number,
 *   vtt:      string,   // ready-to-use WebVTT string
 * }>>}
 */
export async function extractSubtitles(file, onProgress) {
  const reader = new StreamReader(file);

  // ── Verify EBML header ────────────────────────────────────────────────────
  const ebmlHdr = await readElemHeader(reader);
  if (!ebmlHdr || ebmlHdr.id !== ID.EBML) throw new Error('Not a valid EBML/MKV file');
  reader.skip(ebmlHdr.size);

  // ── Find Segment ──────────────────────────────────────────────────────────
  const segHdr = await readElemHeader(reader);
  if (!segHdr || segHdr.id !== ID.Segment) throw new Error('MKV Segment element not found');
  const segStart = reader.pos;
  const segEnd   = segHdr.size >= 0 ? segStart + segHdr.size : file.size;

  // ── Scan Segment for Info, Tracks, Clusters ───────────────────────────────
  let timecodeScale   = 1_000_000;  // ns/tick → default makes 1 tick = 1 ms
  let subtitleTracks  = [];
  let tracksFound     = false;
  let infoFound       = false;
  const cuesByTrack   = {};

  // Progress tracking: estimate by file position
  const reportProgress = () => {
    if (onProgress) onProgress(Math.min(99, Math.round((reader.pos / file.size) * 100)));
  };

  while (!reader.eof && reader.pos < segEnd) {
    const elemPos = reader.pos;
    const elem    = await readElemHeader(reader);
    if (!elem) break;

    const dataStart = reader.pos;

    // ── Info: read TimecodeScale ──────────────────────────────────────────
    if (elem.id === ID.Info && !infoFound) {
      if (elem.size < 0) { reader.seek(dataStart); break; }
      const buf = await reader.readBytes(elem.size);
      let p = 0;
      while (p < buf.length) {
        const { value: id,   width: idW   } = _parseId(buf, p);   p += idW;
        const { value: size, width: sizeW } = _parseSize(buf, p); p += sizeW;
        if (size < 0) break;
        if (id === ID.TimecodeScale) timecodeScale = _uInt(buf, p, size);
        p += size;
      }
      infoFound = true;

    // ── Tracks: find subtitle streams ─────────────────────────────────────
    } else if (elem.id === ID.Tracks && !tracksFound) {
      if (elem.size < 0) { reader.seek(dataStart); break; }
      const buf = await reader.readBytes(elem.size);
      subtitleTracks = _parseTracks(buf);
      subtitleTracks.forEach(t => { cuesByTrack[t.number] = []; });
      tracksFound = true;

    // ── Cluster: extract subtitle cues ────────────────────────────────────
    } else if (elem.id === ID.Cluster) {
      if (!tracksFound) {
        // Rare: Tracks after Clusters — skip this cluster
        if (elem.size >= 0) reader.skip(elem.size);
        else { reader.seek(segEnd); break; }
        continue;
      }

      const subtitleSet = new Set(subtitleTracks.map(t => t.number));
      const tickToMs    = timecodeScale / 1_000_000;

      await _scanCluster(reader, elem.size, segEnd, subtitleSet, tickToMs, cuesByTrack);

      // After unknown-size cluster, cursor may already be at next elem
      if (elem.size >= 0) reader.seek(dataStart + elem.size);

      reportProgress();

    // ── Everything else: skip ─────────────────────────────────────────────
    } else {
      if (elem.size >= 0) reader.skip(elem.size);
      else { reader.seek(segEnd); break; }
    }
  }

  if (onProgress) onProgress(100);

  if (!subtitleTracks.length) return [];

  // ── Build VTT output for each track ──────────────────────────────────────
  const tickToMs = timecodeScale / 1_000_000;  // kept for reference; already used above

  return subtitleTracks.map(track => {
    const cues  = cuesByTrack[track.number];
    const codec = track.codecId;

    let vtt;
    if      (codec === 'S_TEXT/ASS' || codec === 'S_TEXT/SSA') vtt = _assToVTT(cues);
    else if (codec === 'S_TEXT/WEBVTT')                         vtt = _vttPassthrough(cues);
    else                                                        vtt = _srtToVTT(cues);

    const displayLang = LANG_NAMES[track.language] || track.language;
    const label       = track.name || displayLang || `Track ${track.number}`;

    return {
      label,
      language: track.language || 'und',
      codecId:  codec,
      cueCount: cues.length,
      vtt,
    };
  });
}
