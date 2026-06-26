import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  getMediaInfo,
  trimVideo,
  mergeVideos,
  convertFormat,
  extractAudio,
  resizeVideo,
  cropVideo,
  rotateVideo,
  changeSpeed,
  adjustVolume,
  extractFrame,
  addTextOverlay,
  addWatermark,
  addFade,
  compressVideo,
  generateGif
} from '../src/ffmpeg-utils.js';

const WORK_DIR = path.resolve('./test/tmp');
fs.rmSync(WORK_DIR, { recursive: true, force: true });
fs.mkdirSync(WORK_DIR, { recursive: true });

function makeTestVideo(file, color = 'red', duration = 5) {
  const out = path.join(WORK_DIR, file);
  const r = spawnSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:d=${duration}:r=24`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`,
    '-shortest', out
  ]);
  if (r.status !== 0) throw new Error('Failed to generate test video: ' + r.stderr.toString());
  return out;
}

function makeTestImage(file) {
  const out = path.join(WORK_DIR, file);
  const r = spawnSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=blue:s=80x40:d=1',
    '-frames:v', '1', out
  ]);
  if (r.status !== 0) throw new Error('Failed to generate test image: ' + r.stderr.toString());
  return out;
}

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    const result = await fn();
    if (result && result.path && fs.existsSync(result.path) && fs.statSync(result.path).size > 0) {
      console.log(`OK   ${name} -> ${path.basename(result.path)} (${fs.statSync(result.path).size} bytes)`);
      passed++;
    } else if (result && !result.path) {
      console.log(`OK   ${name} -> ${JSON.stringify(result).slice(0, 120)}`);
      passed++;
    } else {
      console.log(`FAIL ${name} -> output file missing or empty`);
      failed++;
    }
  } catch (err) {
    console.log(`FAIL ${name} -> ${err.message.split('\n')[0]}`);
    failed++;
  }
}

const v1 = makeTestVideo('v1.mp4', 'red', 5);
const v2 = makeTestVideo('v2.mp4', 'green', 5);
const img = makeTestImage('logo.png');

await check('getMediaInfo', async () => {
  const info = await getMediaInfo({ input_path: v1 });
  if (!info.video || !info.audio) throw new Error('missing stream info');
  return { result: info };
});

await check('trimVideo', () => trimVideo({ input_path: v1, output_path: path.join(WORK_DIR, 'trim.mp4'), start_time: 1, duration: 2 }));

await check('mergeVideos', () => mergeVideos({ input_paths: [v1, v2], output_path: path.join(WORK_DIR, 'merged.mp4') }));

await check('convertFormat', () => convertFormat({ input_path: v1, output_path: path.join(WORK_DIR, 'converted.mov') }));

await check('extractAudio', () => extractAudio({ input_path: v1, output_path: path.join(WORK_DIR, 'audio.mp3') }));

await check('resizeVideo', () => resizeVideo({ input_path: v1, output_path: path.join(WORK_DIR, 'resized.mp4'), width: 160 }));

await check('cropVideo', () => cropVideo({ input_path: v1, output_path: path.join(WORK_DIR, 'cropped.mp4'), width: 160, height: 120, x: 10, y: 10 }));

await check('rotateVideo', () => rotateVideo({ input_path: v1, output_path: path.join(WORK_DIR, 'rotated.mp4'), rotation: 90 }));

await check('changeSpeed (2x)', () => changeSpeed({ input_path: v1, output_path: path.join(WORK_DIR, 'fast.mp4'), speed_factor: 2 }));

await check('changeSpeed (0.25x)', () => changeSpeed({ input_path: v1, output_path: path.join(WORK_DIR, 'slow.mp4'), speed_factor: 0.25 }));

await check('adjustVolume', () => adjustVolume({ input_path: v1, output_path: path.join(WORK_DIR, 'loud.mp4'), volume_factor: 1.5 }));

await check('adjustVolume (mute)', () => adjustVolume({ input_path: v1, output_path: path.join(WORK_DIR, 'muted.mp4'), mute: true }));

await check('extractFrame', () => extractFrame({ input_path: v1, output_path: path.join(WORK_DIR, 'frame.jpg'), timestamp: 1 }));

await check('addTextOverlay', () => addTextOverlay({ input_path: v1, output_path: path.join(WORK_DIR, 'captioned.mp4'), text: "Hello: it's a test", position: 'bottom' }));

await check('addWatermark', () => addWatermark({ input_path: v1, watermark_path: img, output_path: path.join(WORK_DIR, 'watermarked.mp4'), position: 'top-right' }));

await check('addFade', () => addFade({ input_path: v1, output_path: path.join(WORK_DIR, 'faded.mp4'), fade_in_duration: 0.5, fade_out_duration: 0.5, target: 'both' }));

await check('compressVideo', () => compressVideo({ input_path: v1, output_path: path.join(WORK_DIR, 'compressed.mp4'), crf: 30 }));

await check('generateGif', () => generateGif({ input_path: v1, output_path: path.join(WORK_DIR, 'clip.gif'), start_time: 0, duration: 1.5, fps: 10, width: 160 }));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
