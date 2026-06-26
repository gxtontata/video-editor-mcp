import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as editor from './ffmpeg-utils.js';

const server = new McpServer({
  name: 'video-editor-mcp',
  version: '1.0.0'
});

function wrap(fn) {
  return async (args) => {
    try {
      const result = await fn(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  };
}

const pathDesc = (what) => `${what}. Relative paths resolve against MEDIA_DIR (defaults to the server's working directory); absolute paths are used as-is.`;

server.tool(
  'get_media_info',
  'Inspect a video or audio file: duration, resolution, codecs, fps, bitrate, file size.',
  { input_path: z.string().describe(pathDesc('Path to the media file')) },
  wrap(editor.getMediaInfo)
);

server.tool(
  'trim_video',
  'Cut a clip out of a video between a start time and either an end time or a duration (seconds).',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    output_path: z.string().describe(pathDesc('Destination path for the trimmed clip')),
    start_time: z.number().describe('Start time in seconds').optional(),
    end_time: z.number().describe('End time in seconds (use this or duration, not both)').optional(),
    duration: z.number().describe('Duration of the clip in seconds (use this or end_time, not both)').optional()
  },
  wrap(editor.trimVideo)
);

server.tool(
  'merge_videos',
  'Concatenate two or more video files into one, in the given order. Clips are auto-scaled to match so different resolutions/codecs can be joined.',
  {
    input_paths: z.array(z.string()).min(2).describe(pathDesc('Ordered list of video paths to join')),
    output_path: z.string().describe(pathDesc('Destination path for the merged video'))
  },
  wrap(editor.mergeVideos)
);

server.tool(
  'convert_format',
  'Convert a video/audio file to a different container/codec. The output format is inferred from the output_path extension (e.g. .mp4, .mov, .webm, .avi, .mp3).',
  {
    input_path: z.string().describe(pathDesc('Source media path')),
    output_path: z.string().describe(pathDesc('Destination path with the desired extension'))
  },
  wrap(editor.convertFormat)
);

server.tool(
  'extract_audio',
  'Extract the audio track from a video file and save it as an MP3.',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    output_path: z.string().describe(pathDesc('Destination .mp3 path'))
  },
  wrap(editor.extractAudio)
);

server.tool(
  'resize_video',
  'Resize/scale a video. Provide width, height, or both (aspect ratio is preserved if only one is given).',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    output_path: z.string().describe(pathDesc('Destination path')),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional()
  },
  wrap(editor.resizeVideo)
);

server.tool(
  'crop_video',
  'Crop a video to a rectangular region.',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    output_path: z.string().describe(pathDesc('Destination path')),
    width: z.number().int().positive().describe('Crop width in pixels'),
    height: z.number().int().positive().describe('Crop height in pixels'),
    x: z.number().int().min(0).default(0).describe('Left offset of the crop region in pixels'),
    y: z.number().int().min(0).default(0).describe('Top offset of the crop region in pixels')
  },
  wrap(editor.cropVideo)
);

server.tool(
  'rotate_video',
  'Rotate and/or flip a video.',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    output_path: z.string().describe(pathDesc('Destination path')),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    flip: z.enum(['none', 'horizontal', 'vertical']).default('none')
  },
  wrap(editor.rotateVideo)
);

server.tool(
  'change_speed',
  'Speed up or slow down a video (audio pitch is preserved). speed_factor > 1 speeds up, < 1 slows down (e.g. 2 = 2x faster, 0.5 = half speed).',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    output_path: z.string().describe(pathDesc('Destination path')),
    speed_factor: z.number().positive()
  },
  wrap(editor.changeSpeed)
);

server.tool(
  'adjust_volume',
  'Change the audio volume of a video, or mute it entirely.',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    output_path: z.string().describe(pathDesc('Destination path')),
    volume_factor: z.number().min(0).optional().describe('1 = unchanged, 1.5 = 50% louder, 0.5 = 50% quieter'),
    mute: z.boolean().optional().describe('Set true to remove audio entirely (ignores volume_factor)')
  },
  wrap(editor.adjustVolume)
);

server.tool(
  'extract_frame',
  'Grab a single still frame from a video at a given timestamp and save it as an image.',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    output_path: z.string().describe(pathDesc('Destination image path, e.g. .jpg or .png')),
    timestamp: z.number().min(0).default(0).describe('Time in seconds to capture the frame')
  },
  wrap(editor.extractFrame)
);

server.tool(
  'add_text_overlay',
  'Burn text (e.g. a caption or title) onto a video, optionally only during a time range.',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    output_path: z.string().describe(pathDesc('Destination path')),
    text: z.string(),
    start_time: z.number().min(0).optional().describe('Seconds when the text should appear (omit to show for the whole video)'),
    end_time: z.number().min(0).optional().describe('Seconds when the text should disappear'),
    position: z.enum(['top', 'bottom', 'center']).default('bottom'),
    font_size: z.number().int().positive().default(36),
    font_color: z.string().default('white').describe('Any ffmpeg color name or hex, e.g. "white" or "0xFF0000"')
  },
  wrap(editor.addTextOverlay)
);

server.tool(
  'add_watermark',
  'Overlay a logo/watermark image onto a video at a chosen corner or the center.',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    watermark_path: z.string().describe(pathDesc('Path to the watermark/logo image')),
    output_path: z.string().describe(pathDesc('Destination path')),
    position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']).default('bottom-right'),
    opacity: z.number().min(0).max(1).default(0.8),
    scale_width: z.number().int().positive().optional().describe('Resize the watermark to this width in pixels before overlaying')
  },
  wrap(editor.addWatermark)
);

server.tool(
  'add_fade',
  'Add a fade-in and/or fade-out to a video, audio, or both.',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    output_path: z.string().describe(pathDesc('Destination path')),
    fade_in_duration: z.number().min(0).default(0).describe('Fade-in length in seconds'),
    fade_out_duration: z.number().min(0).default(0).describe('Fade-out length in seconds'),
    target: z.enum(['video', 'audio', 'both']).default('both')
  },
  wrap(editor.addFade)
);

server.tool(
  'compress_video',
  'Reduce a video file size by re-encoding it with a given quality level (CRF). Lower CRF = higher quality/larger file; higher CRF = smaller file/lower quality. 28 is a reasonable default.',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    output_path: z.string().describe(pathDesc('Destination path')),
    crf: z.number().int().min(0).max(51).default(28),
    preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']).default('medium')
  },
  wrap(editor.compressVideo)
);

server.tool(
  'generate_gif',
  'Convert a segment of a video into an animated GIF.',
  {
    input_path: z.string().describe(pathDesc('Source video path')),
    output_path: z.string().describe(pathDesc('Destination .gif path')),
    start_time: z.number().min(0).default(0),
    duration: z.number().positive().default(3),
    fps: z.number().int().positive().default(12),
    width: z.number().int().positive().default(480)
  },
  wrap(editor.generateGif)
);

const transport = new StdioServerTransport();
await server.connect(transport);
