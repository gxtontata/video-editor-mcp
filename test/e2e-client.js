import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

const MEDIA_DIR = path.resolve('./test/tmp');

const transport = new StdioClientTransport({
  command: 'node',
  args: ['src/index.js'],
  env: { ...process.env, MEDIA_DIR }
});

const client = new Client({ name: 'e2e-test-client', version: '1.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log(`Server exposes ${tools.tools.length} tools:`);
for (const t of tools.tools) console.log(` - ${t.name}`);

console.log('\nCalling get_media_info on v1.mp4 (relative path, resolved via MEDIA_DIR)...');
const infoResult = await client.callTool({
  name: 'get_media_info',
  arguments: { input_path: 'v1.mp4' }
});
console.log(JSON.stringify(infoResult, null, 2));

console.log('\nCalling trim_video via the protocol...');
const trimResult = await client.callTool({
  name: 'trim_video',
  arguments: { input_path: 'v1.mp4', output_path: 'e2e_trim.mp4', start_time: 0.5, duration: 1.5 }
});
console.log(JSON.stringify(trimResult, null, 2));

console.log('\nCalling an invalid op to confirm error handling...');
const errResult = await client.callTool({
  name: 'get_media_info',
  arguments: { input_path: 'does_not_exist.mp4' }
});
console.log(JSON.stringify(errResult, null, 2));

await client.close();
console.log('\nE2E test complete.');
