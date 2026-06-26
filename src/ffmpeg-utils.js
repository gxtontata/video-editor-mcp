import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Base directory media operations are confined to, unless the caller passes
 * an absolute path explicitly. Set MEDIA_DIR when launching the server to
 * point it at the folder containing your video files.
 */
const MEDIA_DIR = process.env.MEDIA_DIR || process.cwd();

/**
 * Resolves a user-supplied path against MEDIA_DIR (relative paths) while
 * still allowing absolute paths. Throws if the file is required to exist
 * but doesn't.
 */
export function resolvePath(p, { mustExist = false } = {}) {
  if (!p || typeof p !== 'string') {
    throw new Error('A file path is required.');
  }
  const resolved = path.isAbsolute(p) ? p : path.resolve(MEDIA_DIR, p);
  if (mustExist && !fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  return resolved;
}

export function ensureParentDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function runProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => {
      reject(new Error(`Failed to start ${cmd}: ${err.message}`));
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const tail = stderr.split('\n').filter(Boolean).slice(-15).join('\n');
        reject(new Error(`${cmd} exited with code ${code}\n${tail}`));
      }
    });
  });
}

export function runFFmpeg(args) {
  // -y overwrite, -hide_banner / -loglevel for cleaner stderr
  return runProcess('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
}

export function runFFprobe(args) {
  return runProcess('ffprobe', args);
}

function fileInfo(outPath) {
  try {
    const stat = fs.statSync(outPath);
    return { path: outPath, size_bytes: stat.size };
  } catch {
    return { path: outPath };
  }
}

// ---------------------------------------------------------------------------
// Media inspection
// ---------------------------------------------------------------------------

export async function getMediaInfo({ input_path }) {
  const input = resolvePath(input_path, { mustExist: true });
  const { stdout } = await runFFprobe([
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    input
  ]);
  const data = JSON.parse(stdout);
  const videoStream = (data.streams || []).find((s) => s.codec_type === 'video');
  const audioStream = (data.streams || []).find((s) => s.codec_type === 'audio');

  return {
    path: input,
    format: data.format?.format_name,
    duration_seconds: data.format?.duration ? parseFloat(data.format.duration) : null,
    size_bytes: data.format?.size ? parseInt(data.format.size, 10) : null,
    bit_rate: data.format?.bit_rate ? parseInt(data.format.bit_rate, 10) : null,
    video: videoStream
      ? {
          codec: videoStream.codec_name,
          width: videoStream.width,
          height: videoStream.height,
          fps: videoStream.r_frame_rate,
          pixel_format: videoStream.pix_fmt
        }
      : null,
    audio: audioStream
      ? {
          codec: audioStream.codec_name,
          sample_rate: audioStream.sample_rate,
          channels: audioStream.channels
        }
      : null
  };
}

// ---------------------------------------------------------------------------
// Trim / cut
// ---------------------------------------------------------------------------

export async function trimVideo({ input_path, output_path, start_time, end_time, duration }) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);

  const args = [];
  if (start_time !== undefined && start_time !== null) args.push('-ss', String(start_time));
  args.push('-i', input);
  if (duration !== undefined && duration !== null) {
    args.push('-t', String(duration));
  } else if (end_time !== undefined && end_time !== null) {
    args.push('-to', String(Math.max(0, end_time - (start_time || 0))));
  }
  // Re-encode for frame-accurate cuts (copy can land on the wrong keyframe).
  args.push('-c:v', 'libx264', '-c:a', 'aac', output);

  await runFFmpeg(args);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Merge / concatenate
// ---------------------------------------------------------------------------

export async function mergeVideos({ input_paths, output_path }) {
  if (!Array.isArray(input_paths) || input_paths.length < 2) {
    throw new Error('input_paths must be an array of at least 2 file paths.');
  }
  const inputs = input_paths.map((p) => resolvePath(p, { mustExist: true }));
  const output = resolvePath(output_path);
  ensureParentDir(output);

  // Re-encode each input to a common format before concatenation so clips
  // with different codecs/resolutions/frame rates can still be joined.
  const args = [];
  inputs.forEach((i) => args.push('-i', i));

  const filterParts = inputs.map((_, idx) => `[${idx}:v]scale=1280:720,setsar=1[v${idx}];[${idx}:a]aresample=44100[a${idx}]`);
  const concatInputs = inputs.map((_, idx) => `[v${idx}][a${idx}]`).join('');
  const filter = `${filterParts.join(';')};${concatInputs}concat=n=${inputs.length}:v=1:a=1[outv][outa]`;

  args.push(
    '-filter_complex', filter,
    '-map', '[outv]', '-map', '[outa]',
    '-c:v', 'libx264', '-c:a', 'aac',
    output
  );

  await runFFmpeg(args);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Format conversion
// ---------------------------------------------------------------------------

export async function convertFormat({ input_path, output_path }) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);
  await runFFmpeg(['-i', input, output]);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Audio extraction
// ---------------------------------------------------------------------------

export async function extractAudio({ input_path, output_path }) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);
  await runFFmpeg(['-i', input, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', output]);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Resize / scale
// ---------------------------------------------------------------------------

export async function resizeVideo({ input_path, output_path, width, height }) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);

  let scale;
  if (width && height) scale = `scale=${width}:${height}`;
  else if (width) scale = `scale=${width}:-2`;
  else if (height) scale = `scale=-2:${height}`;
  else throw new Error('Provide at least width or height.');

  await runFFmpeg(['-i', input, '-vf', scale, '-c:a', 'copy', output]);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Crop
// ---------------------------------------------------------------------------

export async function cropVideo({ input_path, output_path, width, height, x = 0, y = 0 }) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);
  if (!width || !height) throw new Error('width and height are required.');
  await runFFmpeg(['-i', input, '-vf', `crop=${width}:${height}:${x}:${y}`, '-c:a', 'copy', output]);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Rotate / flip
// ---------------------------------------------------------------------------

export async function rotateVideo({ input_path, output_path, rotation = 0, flip = 'none' }) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);

  const filters = [];
  const rotMap = { 90: 'transpose=1', 180: 'transpose=1,transpose=1', 270: 'transpose=2', '-90': 'transpose=2' };
  if (rotation && rotMap[rotation]) filters.push(rotMap[rotation]);
  if (flip === 'horizontal') filters.push('hflip');
  if (flip === 'vertical') filters.push('vflip');
  if (filters.length === 0) throw new Error('Provide a rotation (90/180/270) and/or flip (horizontal/vertical).');

  await runFFmpeg(['-i', input, '-vf', filters.join(','), '-c:a', 'copy', output]);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Speed change
// ---------------------------------------------------------------------------

export async function changeSpeed({ input_path, output_path, speed_factor }) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);
  if (!speed_factor || speed_factor <= 0) throw new Error('speed_factor must be a positive number (e.g. 2 = 2x faster, 0.5 = half speed).');

  const videoFilter = `setpts=${1 / speed_factor}*PTS`;
  // atempo only supports 0.5-2.0 per instance; chain instances to cover wider ranges.
  let remaining = speed_factor;
  const atempoChain = [];
  while (remaining > 2.0) {
    atempoChain.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    atempoChain.push('atempo=0.5');
    remaining /= 0.5;
  }
  atempoChain.push(`atempo=${remaining}`);

  await runFFmpeg([
    '-i', input,
    '-filter:v', videoFilter,
    '-filter:a', atempoChain.join(','),
    output
  ]);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Volume / mute
// ---------------------------------------------------------------------------

export async function adjustVolume({ input_path, output_path, volume_factor, mute }) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);

  if (mute) {
    await runFFmpeg(['-i', input, '-c:v', 'copy', '-an', output]);
  } else {
    if (volume_factor === undefined || volume_factor === null) {
      throw new Error('Provide volume_factor (e.g. 1.5 = louder, 0.5 = quieter) or mute=true.');
    }
    await runFFmpeg(['-i', input, '-c:v', 'copy', '-filter:a', `volume=${volume_factor}`, output]);
  }
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Frame / thumbnail extraction
// ---------------------------------------------------------------------------

export async function extractFrame({ input_path, output_path, timestamp = 0 }) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);
  await runFFmpeg(['-ss', String(timestamp), '-i', input, '-frames:v', '1', '-q:v', '2', output]);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Text overlay / captions
// ---------------------------------------------------------------------------

function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

export async function addTextOverlay({
  input_path,
  output_path,
  text,
  start_time,
  end_time,
  position = 'bottom',
  font_size = 36,
  font_color = 'white'
}) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);
  if (!text) throw new Error('text is required.');

  const posMap = {
    top: 'x=(w-text_w)/2:y=h*0.08',
    bottom: 'x=(w-text_w)/2:y=h*0.85',
    center: 'x=(w-text_w)/2:y=(h-text_h)/2'
  };
  const xy = posMap[position] || posMap.bottom;

  let drawtext = `drawtext=text='${escapeDrawtext(text)}':fontcolor=${font_color}:fontsize=${font_size}:box=1:boxcolor=black@0.5:boxborderw=8:${xy}`;
  if (start_time !== undefined && end_time !== undefined) {
    drawtext += `:enable='between(t,${start_time},${end_time})'`;
  }

  await runFFmpeg(['-i', input, '-vf', drawtext, '-c:a', 'copy', output]);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Watermark / logo overlay
// ---------------------------------------------------------------------------

export async function addWatermark({
  input_path,
  watermark_path,
  output_path,
  position = 'bottom-right',
  opacity = 0.8,
  scale_width
}) {
  const input = resolvePath(input_path, { mustExist: true });
  const watermark = resolvePath(watermark_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);

  const posMap = {
    'top-left': '10:10',
    'top-right': 'W-w-10:10',
    'bottom-left': '10:H-h-10',
    'bottom-right': 'W-w-10:H-h-10',
    center: '(W-w)/2:(H-h)/2'
  };
  const overlayXY = posMap[position] || posMap['bottom-right'];

  const scaleFilter = scale_width ? `scale=${scale_width}:-1,` : '';
  const filter = `[1:v]${scaleFilter}format=rgba,colorchannelmixer=aa=${opacity}[wm];[0:v][wm]overlay=${overlayXY}`;

  await runFFmpeg(['-i', input, '-i', watermark, '-filter_complex', filter, '-c:a', 'copy', output]);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Fade in/out
// ---------------------------------------------------------------------------

export async function addFade({
  input_path,
  output_path,
  fade_in_duration = 0,
  fade_out_duration = 0,
  target = 'both'
}) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);

  const info = await getMediaInfo({ input_path });
  const total = info.duration_seconds || 0;
  const fadeOutStart = Math.max(0, total - fade_out_duration);

  const vFilters = [];
  const aFilters = [];
  if (target === 'video' || target === 'both') {
    if (fade_in_duration > 0) vFilters.push(`fade=t=in:st=0:d=${fade_in_duration}`);
    if (fade_out_duration > 0) vFilters.push(`fade=t=out:st=${fadeOutStart}:d=${fade_out_duration}`);
  }
  if (target === 'audio' || target === 'both') {
    if (fade_in_duration > 0) aFilters.push(`afade=t=in:st=0:d=${fade_in_duration}`);
    if (fade_out_duration > 0) aFilters.push(`afade=t=out:st=${fadeOutStart}:d=${fade_out_duration}`);
  }

  const args = ['-i', input];
  if (vFilters.length) args.push('-vf', vFilters.join(','));
  if (aFilters.length) args.push('-af', aFilters.join(','));
  if (!vFilters.length) args.push('-c:v', 'copy');
  args.push(output);

  await runFFmpeg(args);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

export async function compressVideo({ input_path, output_path, crf = 28, preset = 'medium' }) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);
  await runFFmpeg(['-i', input, '-c:v', 'libx264', '-crf', String(crf), '-preset', preset, '-c:a', 'aac', '-b:a', '128k', output]);
  return fileInfo(output);
}

// ---------------------------------------------------------------------------
// GIF generation
// ---------------------------------------------------------------------------

export async function generateGif({ input_path, output_path, start_time = 0, duration = 3, fps = 12, width = 480 }) {
  const input = resolvePath(input_path, { mustExist: true });
  const output = resolvePath(output_path);
  ensureParentDir(output);
  await runFFmpeg([
    '-ss', String(start_time),
    '-t', String(duration),
    '-i', input,
    '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`,
    '-loop', '0',
    output
  ]);
  return fileInfo(output);
}
